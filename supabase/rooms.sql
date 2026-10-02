-- Group rooms. Phase 1 of docs/group-rooms-design.md.
-- Apply after supabase/mcp-tokens.sql.
--
-- The server stores ciphertext it cannot read. A guest has no Supabase account, so
-- these tables cannot use the `auth.uid() = user_id` pattern every other table here
-- uses. Access is granted instead by a member token presented in a request header,
-- which the API route attaches. A function resolves that token to a role, and every
-- policy consults it.
--
-- What the server does learn: which room exists, who opened it, when it ends, and how
-- many members it has. What it never learns: what anyone wrote, what anyone is called,
-- and the room key. An account that reaches these tables sees ciphertext.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.rooms (
  -- Matches the alphabet in src/lib/rooms/access.ts: no vowels, and none of
  -- 0/O, 1/I/L, 5/S, so a mistyped id is rejected rather than resolving elsewhere.
  room_id text primary key check (room_id ~ '^[BCDFGHJKMNPQRTWXYZ2346789]{6}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,

  -- Hashes only. The invite and host codes are never stored, so a leaked table
  -- cannot be replayed against the join endpoint.
  invite_code_hash text not null check (invite_code_hash ~ '^[0-9a-f]{64}$'),
  host_code_hash text not null check (host_code_hash ~ '^[0-9a-f]{64}$'),

  -- The room key sealed under the invite code. Useless without the code, and the
  -- code is useless without the room key, which never leaves the host's device.
  wrap_salt text not null,
  wrapped_room_key text not null,

  -- Title, topic, phase, and mode all live in here rather than in named columns,
  -- so a feature does not need a migration to add one.
  settings_ciphertext text,

  -- Provider and model are not credentials, and the server needs them to pick a
  -- model without asking the host's device for anything.
  ai_provider text,
  ai_model text,

  key_mode text not null default 'browser' check (key_mode in ('browser', 'server')),
  -- No 'forever'. A server-side credential with no end date is refused at the API
  -- boundary and disallowed here.
  key_expires_at timestamptz,
  check (key_mode = 'browser' or key_expires_at is not null),

  allow_guest_write boolean not null default true,
  require_display_name boolean not null default true,
  room_quota integer not null default 2 check (room_quota > 0),
  ai_audience text not null default 'trusted' check (ai_audience in ('trusted', 'all')),

  -- Required. An open-ended room would be a permanent record of who said what.
  expires_at timestamptz not null,

  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check (expires_at > created_at)
);

-- The Realtime channel this room announces itself on.
--
-- Deliberately not the room id. A room id is six characters from an alphabet chosen so
-- it can be read aloud over a phone, which means it is guessable in a way a 128-bit
-- value is not, and a guessed id would hand an outsider a subscription to a channel
-- they have no business being on. This is separate from every credential in the row:
-- knowing it grants nothing on its own, because the only thing ever sent on the channel
-- is "something changed" with no room, no author, and no content.
--
-- `create table if not exists` does not add a column to a table that already exists, so
-- the additive statements below are what actually migrate a room created before this
-- ran. Existing rooms get a fresh id, which is harmless: their subscribers re-read the
-- transcript on their next poll and continue from there.
alter table public.rooms
  add column if not exists feed_id uuid not null default gen_random_uuid();
create unique index if not exists rooms_feed_id_idx on public.rooms(feed_id);

create table if not exists public.room_members (
  room_id text not null references public.rooms(room_id) on delete cascade,
  -- Hash of the member token, never the token. Revoking a member is deleting a row.
  member_token_hash text not null check (member_token_hash ~ '^[0-9a-f]{64}$'),
  role text not null check (role in ('host', 'trusted', 'guest')),
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz,
  primary key (room_id, member_token_hash),
  -- One host per room, and that host owns it. Enforced here so a second owner row
  -- cannot be written by a bug in the join path.
  check (role <> 'host' or invited_by is null)
);

create unique index if not exists room_members_single_host
  on public.room_members(room_id) where role = 'host';

create index if not exists room_members_recent_idx
  on public.room_members(room_id, last_seen_at desc);

create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(room_id) on delete cascade,
  -- `created_at` is not a total order: two messages in the same millisecond would
  -- sort unpredictably between clients, and every member must see the same
  -- transcript. This identity column is that order, and it is the index the
  -- transcript page reads.
  seq bigint generated always as identity,
  author_token_hash text not null,
  ciphertext text not null,
  ciphertext_bytes integer not null check (ciphertext_bytes > 0 and ciphertext_bytes <= 65536),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  kind text not null default 'human' check (kind in ('human', 'ai', 'system')),
  phase int check (phase is null or phase between 0 and 9),
  pinned_at timestamptz,
  -- Reply and thread targets stay in cleartext columns: they are structural, and
  -- the client needs them to render a thread without decrypting every message.
  -- They reveal shape, never content.
  reply_to_id uuid references public.room_messages(id) on delete set null,
  thread_root_id uuid references public.room_messages(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists room_messages_room_seq_idx
  on public.room_messages(room_id, seq);

-- ---------------------------------------------------------------------------
-- host_ai_keys — a host's provider key, kept so a room can answer without them
-- ---------------------------------------------------------------------------

-- Option B from the design document. Nothing here is readable by anyone but the owner:
-- this is a credential belonging to an account, not to a room, so it uses the same
-- `auth.uid() = user_id` shape as every other table in this project and none of the
-- member-token machinery.
--
-- The two text columns hold ciphertext only. `sealed_dek` is the data key sealed under a
-- key derived from ROOM_KEY_MASTER_SECRET, which lives in the environment and is never
-- written here. That split is the whole point: a dump of this table cannot produce a
-- provider key even with unlimited compute, because the half needed to open it was never
-- stored alongside it. Anything less would make "stored encrypted" a description of a
-- protection that does not exist.
--
-- `expires_at` is not null for the same reason `rooms.expires_at` is: a credential that
-- cannot be revoked by time is the failure this option exists to avoid. The application
-- also sweeps on read, because a constraint records that a date was chosen and says
-- nothing about whether anything acted on it.
create table if not exists public.host_ai_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  key_version integer not null default 1 check (key_version > 0),
  sealed_dek text not null,
  sealed_key text not null,
  -- Mandatory. There is no 'forever', here or at the API boundary.
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.room_ideas (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(room_id) on delete cascade,
  ciphertext text not null,
  author_token_hash text not null,
  status text not null default 'open' check (status in ('open', 'accepted', 'dropped')),
  -- Set when the host converts the idea to a task on their own device. The task
  -- itself never leaves the host's browser.
  task_id text,
  created_at timestamptz not null default now()
);

create index if not exists room_ideas_room_status_idx
  on public.room_ideas(room_id, status, created_at desc);

create table if not exists public.room_votes (
  room_id text not null references public.rooms(room_id) on delete cascade,
  idea_id uuid not null references public.room_ideas(id) on delete cascade,
  voter_token_hash text not null check (voter_token_hash ~ '^[0-9a-f]{64}$'),
  vote smallint not null check (vote in (-1, 1)),
  updated_at timestamptz not null default now(),
  -- This primary key is what makes one vote per person per idea a database
  -- guarantee rather than something the UI is trusted to enforce.
  primary key (room_id, idea_id, voter_token_hash)
);

create index if not exists room_votes_idea_idx
  on public.room_votes(idea_id);

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------
--
-- A member token arrives in the `x-room-member` header, set by the API route. The client
-- never calls Supabase directly, which is what keeps the room key off the wire and
-- gives one place to verify the invite code.
--
-- The token is read out of the request headers setting rather than passed as an
-- argument, so it cannot be logged inside a policy or surfaced in pg_stat_activity.

create or replace function public.room_token_hash()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.headers', true)::jsonb ->> 'x-room-member', '')
    where nullif(current_setting('request.headers', true)::jsonb ->> 'x-room-member', '')
            ~ '^[0-9a-f]{64}$';
$$;

-- Resolves the caller's role in a room, or null when they are not a member.
--
-- security definer because the caller has no table access; search_path is pinned so a
-- hostile schema cannot shadow these names. The token is only ever compared as a hash,
-- so the stored column is never readable by a guest.
create or replace function public.room_role(p_room_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.room_members as m
  where m.room_id = p_room_id
    and m.member_token_hash = public.room_token_hash()
  limit 1;
$$;

-- A room is usable only inside its window, so an expired room stops being readable
-- before the sweep deletes it. Without this, an expiry would be a promise rather than
-- a control.
create or replace function public.room_is_open(p_room_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.rooms as r
    where r.room_id = p_room_id
      and r.closed_at is null
      and r.expires_at > now()
  );
$$;

revoke all on function public.room_token_hash() from public, anon, authenticated;
grant execute on function public.room_role(text) to anon, authenticated, service_role;
grant execute on function public.room_is_open(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- No policy is written as "owner only" or "members only" without spelling out the
-- member check, because a policy that forgets the token silently reads as permissive
-- to a reviewer and denies everything at runtime.

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_messages enable row level security;
alter table public.room_ideas enable row level security;
alter table public.room_votes enable row level security;
-- Not a room table, so it is not on the member-token path: an account's own credential is
-- governed by the account, the same as every other table in this project.
alter table public.host_ai_keys enable row level security;

-- Everything below is reached through the API route, which uses the service role and
-- has already checked the member token. These grants exist so a direct client call
-- with the anon key is possible, and the policies are what stop it.
grant select, insert, update, delete on public.rooms to authenticated, service_role;
grant select, insert, update, delete on public.room_members to authenticated, service_role;
grant select, insert, update, delete on public.room_messages to authenticated, service_role;
grant select, insert, update, delete on public.room_ideas to authenticated, service_role;
grant select, insert, update, delete on public.room_votes to authenticated, service_role;

-- rooms ---------------------------------------------------------------
-- A member reads the room row so the client can render its settings. A non-member
-- reads nothing, which is what stops enumeration from revealing whether an id is real.
drop policy if exists "members read room" on public.rooms;
create policy "members read room"
  on public.rooms for select
  using (public.room_is_open(room_id) and public.room_role(room_id) is not null);

drop policy if exists "owner creates room" on public.rooms;
create policy "owner creates room"
  on public.rooms for insert
  with check (auth.uid() = owner_id);

-- Settings and the room window are the host's to change.
drop policy if exists "host updates room" on public.rooms;
create policy "host updates room"
  on public.rooms for update
  using (public.room_role(room_id) = 'host')
  with check (public.room_role(room_id) = 'host');

-- Closing a room deletes it, so this policy is the last thing between a host and
-- their own transcript.
drop policy if exists "host deletes room" on public.rooms;
create policy "host deletes room"
  on public.rooms for delete
  using (public.room_role(room_id) = 'host');

-- room_members --------------------------------------------------------
-- The member list is gated on the room being open as well. Without that, a room past
-- its expiry would still reveal who was in it, which is the one thing the expiry is
-- meant to erase before the sweep runs.
drop policy if exists "members read members" on public.room_members;
create policy "members read members"
  on public.room_members for select
  using (public.room_is_open(room_id) and public.room_role(room_id) is not null);

-- Joining is an insert, and the only thing a self-insert may choose is a non-admin
-- role. Without the role check, a guest could insert itself as host.
drop policy if exists "joiners add themselves" on public.room_members;
create policy "joiners add themselves"
  on public.room_members for insert
  with check (role in ('guest', 'trusted'));

-- Promotion, demotion, and removal are the host's alone.
drop policy if exists "host manages members" on public.room_members;
create policy "host manages members"
  on public.room_members for update
  using (public.room_role(room_id) = 'host')
  with check (public.room_role(room_id) = 'host');

drop policy if exists "host removes members" on public.room_members;
create policy "host removes members"
  on public.room_members for delete
  using (public.room_role(room_id) = 'host');

-- room_messages --------------------------------------------------------
drop policy if exists "members read messages" on public.room_messages;
create policy "members read messages"
  on public.room_messages for select
  using (public.room_is_open(room_id) and public.room_role(room_id) is not null);

-- Writing needs more than membership. A read-only room refuses everyone but the
-- host, and a guest's insert is governed by the room's own allow_guest_write flag.
drop policy if exists "members post messages" on public.room_messages;
create policy "members post messages"
  on public.room_messages for insert
  with check (
    public.room_is_open(room_id)
    and (
      public.room_role(room_id) in ('host', 'trusted')
      or (public.room_role(room_id) = 'guest' and exists (
            select 1
            from public.rooms as r
            where r.room_id = room_messages.room_id
              and r.allow_guest_write
              and r.closed_at is null
          ))
    )
  );

-- Pinning is host-only, so a member cannot rewrite history after the fact. Messages
-- are otherwise immutable, which is what makes the seq ordering final.
drop policy if exists "host pins messages" on public.room_messages;
create policy "host pins messages"
  on public.room_messages for update
  using (public.room_role(room_id) = 'host')
  with check (public.room_role(room_id) = 'host');

-- room_ideas and room_votes -------------------------------------------
drop policy if exists "members read ideas" on public.room_ideas;
create policy "members read ideas"
  on public.room_ideas for select
  using (public.room_is_open(room_id) and public.room_role(room_id) is not null);

drop policy if exists "members add ideas" on public.room_ideas;
create policy "members add ideas"
  on public.room_ideas for insert
  with check (public.room_role(room_id) is not null);

-- Accepting, dropping, and linking an idea to a task writes to the host's own
-- device, so only the host records the outcome.
drop policy if exists "host updates ideas" on public.room_ideas;
create policy "host updates ideas"
  on public.room_ideas for update
  using (public.room_role(room_id) = 'host')
  with check (public.room_role(room_id) = 'host');

drop policy if exists "members read votes" on public.room_votes;
create policy "members read votes"
  on public.room_votes for select
  using (public.room_is_open(room_id) and public.room_role(room_id) is not null);

-- One row per voter per idea, enforced by the primary key. A voter may change their own
-- vote, which is an update, and cannot vote twice.
drop policy if exists "members vote" on public.room_votes;
create policy "members vote"
  on public.room_votes for insert
  with check (public.room_role(room_id) is not null);

-- A voter may only ever change their own vote, compared by hash so the stored value
-- is never exposed to a policy expression.
drop policy if exists "members change own vote" on public.room_votes;
create policy "members change own vote"
  on public.room_votes for update
  using (voter_token_hash = public.room_token_hash())
  with check (voter_token_hash = public.room_token_hash());

drop policy if exists "members withdraw vote" on public.room_votes;
create policy "members withdraw vote"
  on public.room_votes for delete
  using (voter_token_hash = public.room_token_hash());

-- host_ai_keys ------------------------------------------------------------

-- Owner-only, on every verb. There is deliberately no policy that lets a room member, a
-- host of somebody else's room, or a service that merely knows a room id read this: the
-- provider key is the account holder's credential, and the only thing that should ever open
-- it is the application acting on their behalf.
--
-- The write policies use `auth.uid() = user_id` rather than a member token, so a guest
-- cannot insert themselves as the owner of a key even by guessing an id.
drop policy if exists "owners read their room key" on public.host_ai_keys;
create policy "owners read their room key"
  on public.host_ai_keys for select
  using (auth.uid() = user_id);

drop policy if exists "owners store their room key" on public.host_ai_keys;
create policy "owners store their room key"
  on public.host_ai_keys for insert
  with check (auth.uid() = user_id);

-- The replace path goes through the service role, so an owner-side upsert policy is not
-- required. It is written anyway for the case where a future authenticated client writes
-- directly: without it, `upsert` would fail on the update branch for a legitimate owner.
drop policy if exists "owners update their room key" on public.host_ai_keys;
create policy "owners update their room key"
  on public.host_ai_keys for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Deletion is the promise the disclosure makes, so it is the one operation an owner must
-- always be able to perform without contacting anyone.
drop policy if exists "owners delete their room key" on public.host_ai_keys;
create policy "owners delete their room key"
  on public.host_ai_keys for delete
  using (auth.uid() = user_id);
