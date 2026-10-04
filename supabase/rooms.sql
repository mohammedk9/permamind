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

  -- What the room's model is *for*, chosen by the host at creation.
  --
  -- A room of several models is only useful if they disagree with each other, and they
  -- only disagree if each is given a job: one to criticise, one to market, one to explain.
  -- Without this the room gets several answers of the same kind and reads as noise.
  --
  -- The list is the host's and belongs to them, the same way `ai_model` does. A member
  -- picks one entry from it; they cannot invent one, because a speciality nobody agreed to
  -- is the same as no speciality at all.
  --
  -- The array is ordered and bounded so the client can render it as a fixed control rather
  -- than as free text. `jsonb` rather than a join table because it is read whole, written
  -- once, and never queried by element.
  ai_specialties jsonb not null default '[]'::jsonb
    check (jsonb_typeof(ai_specialties) = 'array' and jsonb_array_length(ai_specialties) <= 8),
  -- How many models the room may run at once. Null means the host did not set a limit,
  -- which is not the same as "unlimited": the API refuses a body that exceeds it and
  -- treats null as "no panel feature enabled at all".
  ai_max_models integer check (ai_max_models is null or ai_max_models > 0),

  -- ## Which kind of room this is
  --
  -- `guest` is every room that has ever existed, and it keeps every promise section 13 makes:
  -- no account, no email, no durable identity, nothing to collect. `panel` is the room where
  -- registered members each bring their own model, and it is a *separate kind* rather than a
  -- flag on the same room for the reason in `panel-rooms-proposal.md` section 1: bolting
  -- identity onto the guest room would make section 13 false, and section 13 is the reason a
  -- link is safe to hand to strangers.
  --
  -- The default is `guest`, so every existing room and every existing row of every other
  -- table means exactly what it meant before this column existed.
  room_kind text not null default 'guest' check (room_kind in ('guest', 'panel')),
  -- A panel room is a panel only if members can bring models, so the host must have defined
  -- at least one speciality to choose from. A `panel` room with an empty list would be a
  -- panel whose members may only pick "nothing", which is an ordinary room with extra steps.
  check (room_kind <> 'panel' or jsonb_array_length(ai_specialties) > 0),

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

  -- ## Panel members are accounts
  --
  -- Null for every guest of every guest room, which is the whole point: `null` *is* the
  -- promise that this member left no durable identity behind. A non-null value appears only
  -- in a `panel` room, and the join route refuses to write one anywhere else.
  --
  -- On delete cascade, deliberately. Unlike `invited_by` — which is a courtesy record of who
  -- did the inviting and is set to null when that account goes — this is the member's own
  -- identity, and if the account disappears the membership must go with it. Leaving the row
  -- behind would leave a panel seat occupied by an account that no longer exists.
  user_id uuid references auth.users(id) on delete cascade,

  -- ## The model a member brought, if they brought one
  --
  -- All three are null together, enforced below. A member who registers no model simply
  -- cannot invoke one: `panel-rooms-proposal.md` section 5 calls this the correct outcome
  -- rather than a gap, because the alternative is a shared credential and a shared credential
  -- is how one member ends up spending another's key.
  --
  -- `model_id` is a provider model id, not a credential. The *key* that signs the call is
  -- never stored here: Option A sends it in a header and Option B has no stored host key in a
  -- panel room at all.
  model_id text check (model_id is null or length(model_id) between 1 and 200),
  model_label text check (model_label is null or length(model_label) between 1 and 60),
  model_specialty text check (model_specialty is null or length(model_specialty) between 1 and 60),

  -- All three or none. A row with an id and no label would render as an unnamed model, and a
  -- label with no id would let a member claim to be a model that does not exist.
  check (
    (model_id is null and model_label is null and model_specialty is null)
    or (model_id is not null and model_label is not null and model_specialty is not null)
  ),

  -- A model is a panel concept. On a guest room there is exactly one model, the room's own,
  -- so a member row naming a different one would mean nothing and only be reachable by a bug.
  -- The room's kind lives on `rooms` and cannot be checked from here, so this half of the
  -- invariant is asserted by the panel tests rather than by the schema.

  -- The member's display name, sealed under the room key.
  --
  -- It is ciphertext the server cannot open, exactly like a message body, and that is the
  -- point: section 4 promises the server never learns what anyone is called. Storing the name
  -- in a cleartext column would break that promise for the sake of a nicer presence list, so
  -- the name is sealed once at join and never updated.
  --
  -- One column, not two. `sealMessage` prefixes the IV to the ciphertext so a single column
  -- round-trips, which makes a separate nonce column redundant rather than merely unused —
  -- an earlier version of this file had one and nothing ever wrote it.
  --
  -- Null means no name was chosen, which is different from an empty name and is the only
  -- honest way to record "this member did not say".
  alias_ciphertext text,
  alias_bytes integer check (alias_bytes is null or alias_bytes > 0 and alias_bytes <= 1024),
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

-- Idempotent column adds, for a database created before presence existed.
--
-- `create table if not exists` skips the whole definition when the table is already there,
-- so a column added to the block above would silently not exist on an install that ran the
-- file earlier. Each of these is written to be safe to re-run.
alter table public.room_members add column if not exists alias_ciphertext text;
alter table public.room_members add column if not exists alias_bytes integer;

-- Panel columns, for a database created before panel rooms existed. `create table if not
-- exists` skips the whole definition when the table is already there, so without these an
-- install that ran an earlier revision would have no `user_id` for the join route to write.
--
-- Each is `add column if not exists`, so re-running is safe. The constraints on the new
-- columns are added below rather than here, because a constraint can only be attached to a
-- column that is known to exist.
alter table public.rooms add column if not exists room_kind text not null default 'guest';
alter table public.room_members add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.room_members add column if not exists model_id text;
alter table public.room_members add column if not exists model_label text;
alter table public.room_members add column if not exists model_specialty text;

-- A panel room with no specialities is refused, so the constraint is added rather than
-- carried in the table definition above: an existing `rooms` table would otherwise never
-- receive it.
alter table public.rooms drop constraint if exists rooms_room_kind_specialties;
alter table public.rooms
  add constraint rooms_room_kind_specialties
  check (room_kind <> 'panel' or jsonb_array_length(ai_specialties) > 0);

alter table public.rooms drop constraint if exists rooms_room_kind_values;
alter table public.rooms
  add constraint rooms_room_kind_values
  check (room_kind in ('guest', 'panel'));

alter table public.room_members drop constraint if exists room_members_model_all_or_none;
alter table public.room_members
  add constraint room_members_model_all_or_none
  check (
    (model_id is null and model_label is null and model_specialty is null)
    or (model_id is not null and model_label is not null and model_specialty is not null)
  );

-- Counting who has brought a model is the cap check in `registerPanelModel`, and it asks
-- this question on every registration. Without the index that is a scan of the roster.
create index if not exists room_members_models_idx
  on public.room_members(room_id) where model_id is not null;

-- A member may hold one seat per room per account. Without this the same person could join
-- twice, occupy two panel seats, and consume two of the host's model slots.
create unique index if not exists room_members_panel_account
  on public.room_members(room_id, user_id) where user_id is not null;

-- `alias_nonce` was added by an earlier revision of this file and never written by any code
-- path. It is not dropped here, because this file is additive by contract and an unused
-- nullable column costs nothing. A database that wants it gone can run
--
--   alter table public.room_members drop column if exists alias_nonce;
--
-- once, by hand. Leaving that to a maintainer rather than to every re-run of the bootstrap is
-- the whole point of the rule.

alter table public.room_members drop constraint if exists room_members_alias_bytes_check;
alter table public.room_members
  add constraint room_members_alias_bytes_check
  check (alias_bytes is null or alias_bytes > 0 and alias_bytes <= 1024);

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

  -- Which model wrote an `ai` message, and what job the host gave it.
  --
  -- Attribution, not content: a model name is not the room's text and reveals nothing the
  -- room did not already say out loud. It is stored in the clear for the same reason
  -- `reply_to_id` is — the client needs it to render a row without decrypting anything,
  -- and a column nobody can read is a column nobody can display.
  --
  -- Null on every `human` and `system` row. The two checks below say so rather than leaving
  -- it to convention, because a model label attached to a person's message would let one
  -- member present their own words as the model's opinion.
  model_label text check (model_label is null or length(model_label) between 1 and 60),
  model_specialty text check (model_specialty is null or length(model_specialty) between 1 and 60),
  check (kind <> 'ai' or model_label is not null),
  check (kind = 'ai' or model_label is null),
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

-- Idempotent column adds, for a database created before attribution existed.
--
-- `create table if not exists` skips the whole definition when the table is already there,
-- so a column added to the block above would silently not exist on an install that ran the
-- file earlier. Existing rows are backfilled before the constraints are added: every
-- pre-existing `ai` message predates attribution and records no model, so it is labelled
-- from the room's own model rather than left null and then refused by the new check.
alter table public.rooms add column if not exists ai_specialties jsonb not null default '[]'::jsonb;
alter table public.rooms add column if not exists ai_max_models integer;

alter table public.room_messages add column if not exists model_label text;
alter table public.room_messages add column if not exists model_specialty text;

update public.room_messages m
   set model_label = coalesce(r.ai_model, 'model')
  from public.rooms r
 where m.room_id = r.room_id
   and m.kind = 'ai'
   and m.model_label is null;

alter table public.room_messages drop constraint if exists room_messages_model_label_bounds;
alter table public.room_messages
  add constraint room_messages_model_label_bounds
  check (model_label is null or length(model_label) between 1 and 60);

alter table public.room_messages drop constraint if exists room_messages_model_specialty_bounds;
alter table public.room_messages
  add constraint room_messages_model_specialty_bounds
  check (model_specialty is null or length(model_specialty) between 1 and 60);

alter table public.room_messages drop constraint if exists room_messages_ai_has_label;
alter table public.room_messages
  add constraint room_messages_ai_has_label
  check (kind <> 'ai' or model_label is not null);

alter table public.room_messages drop constraint if exists room_messages_only_ai_has_label;
alter table public.room_messages
  add constraint room_messages_only_ai_has_label
  check (kind = 'ai' or model_label is null);

alter table public.rooms drop constraint if exists rooms_ai_specialties_shape;
alter table public.rooms
  add constraint rooms_ai_specialties_shape
  check (jsonb_typeof(ai_specialties) = 'array' and jsonb_array_length(ai_specialties) <= 8);

alter table public.rooms drop constraint if exists rooms_ai_max_models_positive;
alter table public.rooms
  add constraint rooms_ai_max_models_positive
  check (ai_max_models is null or ai_max_models > 0);

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
-- Moves an older, room-scoped `host_ai_keys` out of the way, before the current definition
-- below runs.
--
-- The old table was keyed by `room_id` + `author_token_hash` and authorised with a member
-- token. The current one is keyed by `user_id` and authorised with `auth.uid()`. Those cannot
-- be migrated into each other: there is no mapping from a room and a member token to an
-- account. A database carrying the old shape therefore cannot be altered into the new one, and
-- the policies below fail on it with
--
--   ERROR: 42703: column "user_id" does not exist
--
-- The old table is **renamed, never dropped**. Two reasons, and the second is the important
-- one. A drop is unrecoverable, and this file promises to stay additive. More to the point, the
-- rename leaves the old rows readable by whoever wants them — the table was never usable by
-- any current code path, so nothing depends on it, but "nothing uses it" is a judgement and a
-- rename lets that judgement be checked rather than trusted.
--
-- Only the exact legacy shape is recognised. Anything else raises with a description of the
-- table instead, because guessing at an unknown schema is what made this take three attempts.
do $$
declare
  legacy_count integer;
begin
  if to_regclass('public.host_ai_keys') is null then
    return;
  end if;

  -- Already correct: nothing to do, and the create below will be a no-op.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'host_ai_keys' and column_name = 'user_id'
  ) then
    return;
  end if;

  -- The legacy shape: no user_id, but carrying both columns only that shape had.
  select count(*) into legacy_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'host_ai_keys'
    and column_name in ('room_id', 'author_token_hash');

  if legacy_count = 2 then
    execute 'alter table public.host_ai_keys rename to host_ai_keys_legacy_room_scoped';
    return;
  end if;

  raise exception
    'public.host_ai_keys exists, has no user_id, and is not the known legacy shape. Columns: %',
    coalesce((
      select string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position)
      from information_schema.columns
      where table_schema = 'public' and table_name = 'host_ai_keys'
    ), '(none)');
end $$;

create table if not exists public.host_ai_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  key_version integer not null default 1 check (key_version > 0),
  sealed_dek text not null,
  sealed_key text not null,
  -- Mandatory. There is no 'forever', here or at the API boundary.
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);


-- room_ai_usage ------------------------------------------------------------
-- One row per successful model call made inside a room.
--
-- This exists so the host can see what a room has cost them, which the risk table calls for:
-- "per-room and per-member spend is shown to the host". Without it a `trusted` member can
-- spend the host's key up to the room's rate limit and the host has no way to notice.
--
-- What it deliberately does not hold: the question, the answer, the room's title, or any
-- member's display name. `author_token_hash` is a hash, so the row identifies a member the
-- same way `room_members` does — by a value the server cannot invert and cannot tie back to
-- another room. Nothing here can be joined to what was said.
--
-- One row per call rather than a counter, because a counter cannot answer "who spent it", and
-- answering that is most of the point.
create table if not exists public.room_ai_usage (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(room_id) on delete cascade,
  author_token_hash text not null check (author_token_hash ~ '^[0-9a-f]{64}$'),
  -- Which model answered, so the host can see which part of the panel is actually used.
  model text not null check (length(model) between 1 and 200),
  created_at timestamptz not null default now()
);

create index if not exists room_ai_usage_room_created_idx
  on public.room_ai_usage(room_id, created_at desc);

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
alter table public.room_ai_usage enable row level security;
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
-- Service role only. The write comes from the server after a successful call and the read is
-- the host's, so granting `authenticated` any verb here would hand a member a table they
-- have no business reaching.
grant insert, select on public.room_ai_usage to service_role;
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

-- room_ai_usage ------------------------------------------------------------
-- The host reads the spend; the server writes it; nobody else does either.
--
-- Read is host-only because this is the room's cost record and the host is the one paying. A
-- `trusted` member invoking the model does not earn a view of the total — that would make the
-- host's bill legible to the people spending it, which is the opposite of what the trust grant
-- is for.
drop policy if exists "host reads own room usage" on public.room_ai_usage;
create policy "host reads own room usage"
  on public.room_ai_usage for select
  using (public.room_role(room_id) = 'host');

-- There is deliberately no insert policy. The only writer is the service role, and a policy it
-- could not satisfy would exist only to be misread as one.

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
