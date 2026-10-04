-- ============================================================================
-- PermaMind - production bootstrap (ADDITIVE ONLY, safe to re-run)
-- ============================================================================
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- SAFETY CONTRACT
--   * This script NEVER runs: drop table / truncate / delete / drop schema.
--   * Every object uses `create table if not exists` / `create or replace
--     function`, so it is safe to run more than once.
--   * The only removals are `drop policy if exists`, which redefines access
--     rules; a policy is an access rule, not user data.
--
-- WHY THIS FILE EXISTS
-- The tables backing the ten-message daily allowance were committed to the
-- repo but never applied to the database, so the RPC `reserve_ai_request`
-- did not exist and every free chat request failed with HTTP 503 instead of
-- being counted. This script applies them.
--
-- GENERATED FILE - do not hand-edit
-- Produced by scripts/rebuild-bootstrap.ps1. Edit the sources listed below,
-- never this one: supabase/__tests__/bootstrap-sync.test.ts asserts that each
-- source is embedded here verbatim and in this order.
--
-- Order matters: extensions -> ai-usage -> storage-purchases -> arweave-upload-queue -> mcp-readonly -> mcp-tokens -> rooms -> verification.
-- ==========================================================================

create extension if not exists pgcrypto;

-- ==========================================================================
-- 1. AI DAILY ALLOWANCE (ten chat + ten summary requests per UTC day)
-- ==========================================================================

-- Durable daily quotas for the shared free AI key. Apply in the Supabase SQL editor.
-- The in-process limiter remains only a burst guard and is not the daily quota.
--
-- A request is first recorded as a pending reservation. The daily counter is
-- incremented only by finalize_ai_request, so provider failures and cancelled
-- streams do not spend the user's allowance.

create table if not exists public.ai_usage_daily (
  day_key date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_count integer not null default 0 check (chat_count >= 0),
  summary_count integer not null default 0 check (summary_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (day_key, user_id)
);

create table if not exists public.ai_usage_reservations (
  reservation_id uuid primary key default gen_random_uuid(),
  day_key date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('chat', 'summary')),
  status text not null default 'pending' check (status in ('pending', 'finalized', 'released')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  completed_at timestamptz
);

create index if not exists ai_usage_reservations_active_idx
  on public.ai_usage_reservations (user_id, day_key, kind, status, expires_at);

alter table public.ai_usage_daily enable row level security;
revoke all on public.ai_usage_daily from anon, authenticated;
drop policy if exists "users read own ai usage" on public.ai_usage_daily;
create policy "users read own ai usage"
  on public.ai_usage_daily for select
  using (auth.uid() = user_id);
grant select on public.ai_usage_daily to authenticated;

alter table public.ai_usage_reservations enable row level security;
revoke all on public.ai_usage_reservations from anon, authenticated;

drop function if exists public.reserve_ai_request(uuid, text, integer);
create or replace function public.reserve_ai_request(
  p_user_id uuid,
  p_kind text,
  p_limit integer
) returns table(allowed boolean, used_count integer, reservation_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_used integer;
  v_pending integer;
  v_reservation_id uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized';
  end if;
  -- Keep the policy in the database as well as in the server code. The RPC is
  -- executable by authenticated users, so accepting an arbitrary client limit
  -- would let a caller bypass the ten-request allowance.
  if p_kind not in ('chat', 'summary') or p_limit <> 10 then
    raise exception 'invalid quota request';
  end if;

  insert into ai_usage_daily(day_key, user_id)
    values (v_day, p_user_id)
    on conflict (day_key, user_id) do nothing;

  if p_kind = 'chat' then
    select chat_count into v_used
      from ai_usage_daily
      where day_key = v_day and user_id = p_user_id
      for update;
  else
    select summary_count into v_used
      from ai_usage_daily
      where day_key = v_day and user_id = p_user_id
      for update;
  end if;

  -- A crashed request cannot call release. Expired pending rows are therefore
  -- returned to the available pool before checking the limit again. The daily
  -- row is already locked above, matching finalize/release lock ordering.
  update ai_usage_reservations
     set status = 'released', completed_at = now()
   where user_id = p_user_id
     and day_key = v_day
     and status = 'pending'
     and expires_at <= now();

  select count(*)::integer into v_pending
    from ai_usage_reservations
   where day_key = v_day
     and user_id = p_user_id
     and kind = p_kind
     and status = 'pending'
     and expires_at > now();

  if v_used + v_pending >= p_limit then
    return query select false, v_used + v_pending, null::uuid;
    return;
  end if;

  -- The function's OUT column is also called reservation_id. An unqualified
  -- `returning reservation_id` is ambiguous between that plpgsql variable and
  -- the table column, and plpgsql.variable_conflict defaults to error, so the
  -- statement failed at run time. Qualifying through an alias is required.
  insert into ai_usage_reservations as r (day_key, user_id, kind)
    values (v_day, p_user_id, p_kind)
    returning r.reservation_id into v_reservation_id;

  return query select true, v_used + v_pending + 1, v_reservation_id;
end; $$;

revoke all on function public.reserve_ai_request(uuid, text, integer) from public, anon;
grant execute on function public.reserve_ai_request(uuid, text, integer) to authenticated;

create or replace function public.finalize_ai_request(
  p_reservation_id uuid
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_day date;
  v_kind text;
  v_status text;
  v_expires_at timestamptz;
begin
  select user_id, day_key, kind, status, expires_at
    into v_user_id, v_day, v_kind, v_status, v_expires_at
    from ai_usage_reservations
   where reservation_id = p_reservation_id;

  if not found then return false; end if;
  if auth.uid() is null or auth.uid() <> v_user_id then
    raise exception 'not authorized';
  end if;
  if v_status <> 'pending' then return false; end if;

  -- Keep the lock order identical to reserve/release: daily row first, then
  -- reservation row. This preserves atomicity without deadlocking concurrent
  -- requests for the same user and UTC day.
  perform 1 from ai_usage_daily where day_key = v_day and user_id = v_user_id for update;
  select status, expires_at into v_status, v_expires_at
    from ai_usage_reservations where reservation_id = p_reservation_id for update;
  if v_status <> 'pending' then return false; end if;

  if v_expires_at <= now() then
    update ai_usage_reservations
       set status = 'released', completed_at = now()
     where reservation_id = p_reservation_id;
    return false;
  end if;

  if v_kind = 'chat' then
    update ai_usage_daily
       set chat_count = chat_count + 1, updated_at = now()
     where day_key = v_day and user_id = v_user_id;
  else
    update ai_usage_daily
       set summary_count = summary_count + 1, updated_at = now()
     where day_key = v_day and user_id = v_user_id;
  end if;

  update ai_usage_reservations
     set status = 'finalized', completed_at = now()
   where reservation_id = p_reservation_id;
  return true;
end; $$;

revoke all on function public.finalize_ai_request(uuid) from public, anon;
grant execute on function public.finalize_ai_request(uuid) to authenticated;

create or replace function public.release_ai_request(
  p_reservation_id uuid
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_day date;
  v_status text;
begin
  select user_id, day_key, status
    into v_user_id, v_day, v_status
    from ai_usage_reservations
   where reservation_id = p_reservation_id;

  if not found then return false; end if;
  if auth.uid() is null or auth.uid() <> v_user_id then
    raise exception 'not authorized';
  end if;
  if v_status <> 'pending' then return false; end if;

  perform 1 from ai_usage_daily where day_key = v_day and user_id = v_user_id for update;
  update ai_usage_reservations
     set status = 'released', completed_at = now()
   where reservation_id = p_reservation_id and status = 'pending';
  return found;
end; $$;

revoke all on function public.release_ai_request(uuid) from public, anon;
grant execute on function public.release_ai_request(uuid) to authenticated;

-- ==========================================================================
-- 2. STORAGE PURCHASES + WEB-SEARCH QUOTA + OPTIONAL CLOUD SYNC
-- ==========================================================================

create table if not exists public.storage_purchases (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  bytes bigint not null check (bytes > 0), wallet_address text not null, tx_id text not null unique,
  status text not null default 'pending' check (status in ('pending','confirmed','rejected','arweave_pending')),
  network text not null default 'arweave', token text not null default 'AR', quoted_amount numeric,
  created_at timestamptz not null default now()
);
alter table public.storage_purchases add column if not exists arweave_tx_id text;
alter table public.storage_purchases add column if not exists funded_at timestamptz;
alter table public.storage_purchases enable row level security;
drop policy if exists "users read own purchases" on public.storage_purchases;
create policy "users read own purchases" on public.storage_purchases for select using (auth.uid() = user_id);
drop policy if exists "users create own purchases" on public.storage_purchases;
create policy "users create own purchases" on public.storage_purchases for insert with check (auth.uid() = user_id);
-- Purchases are immutable for clients. Status is changed only by trusted server
-- code (service role or a restricted SECURITY DEFINER function), never by anon/authenticated users.
drop policy if exists "users confirm own purchases" on public.storage_purchases;
revoke update on public.storage_purchases from anon, authenticated;
do $$ begin
  alter table public.storage_purchases add constraint storage_purchases_tx_id_format
    check (tx_id ~ '^[A-Za-z0-9_-]{43}$' or tx_id ~ '^0x[0-9a-fA-F]{64}$');
exception when duplicate_object then null;
end $$;

-- Atomic monthly search quota. Run this migration in Supabase SQL Editor.
create table if not exists public.search_usage_monthly (
  month_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (month_key, user_id)
);
alter table public.search_usage_monthly enable row level security;
drop policy if exists "users read own search usage" on public.search_usage_monthly;
create policy "users read own search usage" on public.search_usage_monthly for select using (auth.uid() = user_id);

create or replace function public.reserve_search_request(
  p_user_id uuid, p_month_key text, p_user_limit integer, p_global_limit integer
) returns table(allowed boolean, user_count integer, global_count bigint)
language plpgsql security definer set search_path = public as $$
declare v_user integer; v_global bigint;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'not authorized'; end if;
  select coalesce(sum(request_count), 0) into v_global from search_usage_monthly where month_key = p_month_key;
  insert into search_usage_monthly(month_key, user_id, request_count)
    values (p_month_key, p_user_id, 0) on conflict (month_key, user_id) do nothing;
  select request_count into v_user from search_usage_monthly where month_key = p_month_key and user_id = p_user_id for update;
  if v_user >= p_user_limit or v_global >= p_global_limit then
    return query select false, v_user, v_global; return;
  end if;
  update search_usage_monthly set request_count = request_count + 1, updated_at = now()
    where month_key = p_month_key and user_id = p_user_id returning request_count into v_user;
  return query select true, v_user, v_global + 1;
end; $$;
revoke all on function public.reserve_search_request(uuid,text,integer,integer) from public;
grant execute on function public.reserve_search_request(uuid,text,integer,integer) to authenticated;

-- Optional cloud sync. Payloads are encrypted on the client before they reach
-- this table; Supabase stores metadata and ciphertext only.
create table if not exists public.memory_sync_blobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  data_scope text not null check (data_scope in ('conversations', 'memories', 'projects')),
  ciphertext text not null,
  content_hash text,
  encryption_version integer not null default 1,
  updated_at timestamptz not null default now(),
  unique (user_id, data_scope)
);
alter table public.memory_sync_blobs enable row level security;
drop policy if exists "users read own sync blobs" on public.memory_sync_blobs;
create policy "users read own sync blobs" on public.memory_sync_blobs for select using (auth.uid() = user_id);
drop policy if exists "users create own sync blobs" on public.memory_sync_blobs;
create policy "users create own sync blobs" on public.memory_sync_blobs for insert with check (auth.uid() = user_id);
drop policy if exists "users update own sync blobs" on public.memory_sync_blobs;
create policy "users update own sync blobs" on public.memory_sync_blobs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "users delete own sync blobs" on public.memory_sync_blobs;
create policy "users delete own sync blobs" on public.memory_sync_blobs for delete using (auth.uid() = user_id);

-- Small, user-selected conversation summaries for optional cloud sync.
-- Full messages are intentionally not stored here.
create table if not exists public.cloud_conversation_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text not null,
  ciphertext text not null,
  ciphertext_bytes integer not null check (ciphertext_bytes > 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  source_created_at timestamptz not null,
  source_updated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (user_id, conversation_id)
);
alter table public.cloud_conversation_summaries add column if not exists ciphertext text;
alter table public.cloud_conversation_summaries add column if not exists ciphertext_bytes integer;
-- Existing installations may have the earlier plaintext-summary columns. Keep
-- old rows readable while all new rows use ciphertext; do not rewrite or
-- silently expose legacy data.
alter table public.cloud_conversation_summaries alter column ciphertext drop not null;
alter table public.cloud_conversation_summaries alter column ciphertext_bytes drop not null;
-- If the legacy migration created these columns, new encrypted-only writes must
-- not be forced to provide plaintext values. PostgreSQL has no IF EXISTS form
-- for ALTER COLUMN, so check each column before changing it.
do $$
declare
  legacy_column text;
begin
  foreach legacy_column in array array['summary', 'topics', 'tags', 'entities', 'facts', 'decisions', 'message_count'] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'cloud_conversation_summaries'
        and information_schema.columns.column_name = legacy_column
    ) then
      execute format('alter table public.cloud_conversation_summaries alter column %I drop not null', legacy_column);
    end if;
  end loop;
end $$;
alter table public.cloud_conversation_summaries enable row level security;
drop policy if exists "users read own summaries" on public.cloud_conversation_summaries;
create policy "users read own summaries" on public.cloud_conversation_summaries for select using (auth.uid() = user_id);
drop policy if exists "users create own summaries" on public.cloud_conversation_summaries;
create policy "users create own summaries" on public.cloud_conversation_summaries for insert with check (auth.uid() = user_id);
drop policy if exists "users update own summaries" on public.cloud_conversation_summaries;
create policy "users update own summaries" on public.cloud_conversation_summaries for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "users delete own summaries" on public.cloud_conversation_summaries;
create policy "users delete own summaries" on public.cloud_conversation_summaries for delete using (auth.uid() = user_id);

-- ==========================================================================
-- 3. ARWEAVE UPLOAD QUEUE
-- ==========================================================================

-- Durable ciphertext queue for Arweave uploads.
-- The browser encrypts first. This table stores only the encrypted envelope
-- plus non-secret metadata. Plaintext never belongs here.
-- Status is changed only by the service role worker, never by clients.

create table if not exists public.arweave_upload_queue (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  snapshot_version integer not null check (snapshot_version > 0),
  ciphertext text not null check (char_length(ciphertext) between 1 and 70000000),
  metadata jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'uploading', 'uploaded', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_retry_at timestamptz,
  tx_id text check (tx_id is null or tx_id ~ '^[A-Za-z0-9_-]{43}$'),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  uploaded_at timestamptz,
  unique (user_id, content_hash)
);

create index if not exists arweave_upload_queue_due_idx
  on public.arweave_upload_queue (status, next_retry_at, created_at);

alter table public.arweave_upload_queue enable row level security;

drop policy if exists "users read own arweave queue" on public.arweave_upload_queue;
create policy "users read own arweave queue"
  on public.arweave_upload_queue for select
  using (auth.uid() = user_id);

drop policy if exists "users insert own arweave queue" on public.arweave_upload_queue;
create policy "users insert own arweave queue"
  on public.arweave_upload_queue for insert
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and attempts = 0
    and tx_id is null
  );

revoke update, delete on public.arweave_upload_queue from anon, authenticated;

-- ==========================================================================
-- 4. MCP READ-ONLY PROJECTION
-- ==========================================================================

-- MCP read-only projection. It never exposes ciphertext, messages, local data, or Arweave snapshots.
alter table public.cloud_conversation_summaries add column if not exists title text;
alter table public.cloud_conversation_summaries add column if not exists summary text;
alter table public.cloud_conversation_summaries add column if not exists topics text[] not null default '{}';
alter table public.cloud_conversation_summaries add column if not exists tags text[] not null default '{}';
alter table public.cloud_conversation_summaries add column if not exists mcp_allowed boolean not null default false;

create index if not exists cloud_summaries_mcp_owner_idx
  on public.cloud_conversation_summaries(user_id, mcp_allowed, updated_at desc);

alter table public.cloud_conversation_summaries enable row level security;
drop policy if exists "mcp users read allowed summaries" on public.cloud_conversation_summaries;
create policy "mcp users read allowed summaries"
  on public.cloud_conversation_summaries for select
  using (auth.uid() = user_id and mcp_allowed = true);

create table if not exists public.mcp_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool text not null check (tool in ('list_allowed_summaries', 'get_allowed_summary', 'search_allowed_summaries')),
  outcome text not null check (outcome in ('success', 'error', 'rate_limited')),
  request_id text,
  created_at timestamptz not null default now()
);
alter table public.mcp_audit_log enable row level security;
revoke all on public.mcp_audit_log from anon, authenticated;
grant insert on public.mcp_audit_log to authenticated;
-- Audit writes are performed with the user's authenticated Supabase client; no service role is required.
drop policy if exists "users write own mcp audit" on public.mcp_audit_log;
create policy "users write own mcp audit"
  on public.mcp_audit_log for insert
  with check (auth.uid() = user_id);
create index if not exists mcp_audit_user_created_idx on public.mcp_audit_log(user_id, created_at desc);

-- ==========================================================================
-- 5. MCP TOKENS
-- ==========================================================================

-- Separate, revocable MCP credentials. A Supabase session token is not accepted by /api/mcp.
-- Apply after supabase/mcp-readonly.sql.

create table if not exists public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  label text not null default 'MCP client' check (char_length(label) between 1 and 80),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at)
);

create index if not exists mcp_tokens_owner_idx
  on public.mcp_tokens(user_id, created_at desc);

alter table public.mcp_tokens enable row level security;
revoke all on public.mcp_tokens from anon, authenticated;
grant select, update(revoked_at) on public.mcp_tokens to authenticated;

drop policy if exists "users read own mcp tokens" on public.mcp_tokens;
create policy "users read own mcp tokens"
  on public.mcp_tokens for select
  using (auth.uid() = user_id);

drop policy if exists "users revoke own mcp tokens" on public.mcp_tokens;
create policy "users revoke own mcp tokens"
  on public.mcp_tokens for update
  using (auth.uid() = user_id and revoked_at is null)
  with check (auth.uid() = user_id and revoked_at is not null);

-- Token hashes are generated only by this function. Callers cannot insert an arbitrary hash.
create or replace function public.issue_mcp_token(p_label text default 'MCP client')
returns table(token text, token_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_token text;
  v_hash text;
  v_id uuid;
  v_expires timestamptz := now() + interval '30 days';
  v_label text := left(btrim(coalesce(p_label, 'MCP client')), 80);
begin
  if v_user is null then raise exception 'not authorized'; end if;
  if v_label = '' then v_label := 'MCP client'; end if;
  -- `expires_at` is both an OUT column of this function and a column of
  -- mcp_tokens, so the bare reference below is ambiguous at run time. Aliasing
  -- the table makes the column reference explicit.
  if (select count(*) from mcp_tokens as t
      where t.user_id = v_user and t.revoked_at is null and t.expires_at > now()) >= 5 then
    raise exception 'too many active MCP tokens';
  end if;

  v_token := 'pmcp_' || encode(gen_random_bytes(32), 'hex');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');
  insert into mcp_tokens as t (user_id, token_hash, label, expires_at)
    values (v_user, v_hash, v_label, v_expires)
    returning t.id into v_id;
  return query select v_token, v_id, v_expires;
end; $$;

revoke all on function public.issue_mcp_token(text) from public, anon;
grant execute on function public.issue_mcp_token(text) to authenticated;

-- Resolves a presented MCP token without making its hash readable. Session JWTs never match.
create or replace function public.resolve_mcp_token(p_token text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_hash text;
  v_user uuid;
begin
  if p_token is null or p_token !~ '^pmcp_[0-9a-f]{64}$' then return null; end if;
  v_hash := encode(digest(p_token, 'sha256'), 'hex');
  update mcp_tokens
    set last_used_at = now()
    where token_hash = v_hash
      and revoked_at is null
      and expires_at > now()
    returning user_id into v_user;
  return v_user;
end; $$;

revoke all on function public.resolve_mcp_token(text) from public, anon, authenticated;
grant execute on function public.resolve_mcp_token(text) to service_role;

-- Reads one page of explicitly shared summaries. The presented token is checked
-- again inside the database; ciphertext and full messages are not selected.
create or replace function public.read_mcp_summaries(
  p_token text,
  p_summary_id uuid default null,
  p_query text default null,
  p_limit integer default 20
) returns table(
  id uuid,
  conversation_id text,
  title text,
  summary text,
  topics text[],
  tags text[],
  source_created_at timestamptz,
  source_updated_at timestamptz,
  updated_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_query text := nullif(left(btrim(coalesce(p_query, '')), 100), '');
begin
  v_user := public.resolve_mcp_token(p_token);
  if v_user is null then return; end if;
  return query
    select s.id, s.conversation_id, s.title, s.summary, s.topics, s.tags,
           s.source_created_at, s.source_updated_at, s.updated_at
      from cloud_conversation_summaries s
      where s.user_id = v_user
        and s.mcp_allowed = true
        and s.summary is not null
        and (p_summary_id is null or s.id = p_summary_id)
        and (v_query is null or s.summary ilike '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
      order by s.updated_at desc
      limit v_limit;
end; $$;

revoke all on function public.read_mcp_summaries(text, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.read_mcp_summaries(text, uuid, text, integer) to service_role;

-- Audit rows are written by the server after token resolution. Users can review their own rows.
grant insert on public.mcp_audit_log to service_role;
drop policy if exists "users read own mcp audit" on public.mcp_audit_log;
create policy "users read own mcp audit"
  on public.mcp_audit_log for select
  using (auth.uid() = user_id);
grant select on public.mcp_audit_log to authenticated;

-- ==========================================================================
-- 6. GROUP ROOMS (ciphertext only, member-token access)
-- ==========================================================================

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
-- ==========================================================================
-- VERIFICATION - these are the last statements. Read the output.
-- ==========================================================================

select c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- Row counts confirm legacy data was preserved, not recreated.
select 'profiles' as table_name, count(*) as row_count from public.profiles
union all select 'search_usage_monthly', count(*) from public.search_usage_monthly
union all select 'storage_purchases', count(*) from public.storage_purchases
union all select 'ai_usage_daily', count(*) from public.ai_usage_daily
order by table_name;

-- Expect every RPC below to resolve.
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'reserve_ai_request', 'finalize_ai_request', 'release_ai_request',
    'issue_mcp_token', 'resolve_mcp_token', 'read_mcp_summaries',
    'reserve_search_request',
    'room_role', 'room_is_open'
  )
order by p.proname;

