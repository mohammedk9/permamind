-- ============================================================================
-- PermaMind - production bootstrap (ADDITIVE ONLY, safe to re-run)
-- ============================================================================
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- SAFETY CONTRACT
--   * This script NEVER runs: drop table / truncate / delete / drop schema.
--   * Every object uses `create table if not exists` / `create or replace
--     function`, so it is safe to run more than once.
--   * This script never runs: drop table / truncate / delete / drop column.
--   * public.profiles is never referenced at all, so it is untouched.
--   * public.search_usage_monthly and public.storage_purchases receive only
--     additive, idempotent changes carried over from storage-purchases.sql:
--     add column if not exists, enable row level security, and add constraint
--     (skipped when it already exists). Existing rows and columns are kept.
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
-- This file is the concatenation, in order, of: ai-usage.sql,
-- storage-purchases.sql, arweave-upload-queue.sql, mcp-readonly.sql and
-- mcp-tokens.sql, plus pgcrypto and the verification queries. An earlier
-- hand-assembled version silently lost a closing `);` and an orphaned
-- function tail, so the SQL body is now identical to those five sources by
-- construction. Edit those files, never this one.
--
-- Order matters: extensions -> AI quota -> purchases/sync -> Arweave -> MCP.
-- ============================================================================

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

-- ============================================================================
-- 6. VERIFICATION - these are the last statements. Read the output.
-- ============================================================================

-- Expect 10 tables. The three legacy tables must still be listed.
select c.relname as table_name, c.relrowsecurity as rls_enabled
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

-- Expect all 7 functions to resolve.
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'reserve_ai_request', 'finalize_ai_request', 'release_ai_request',
    'issue_mcp_token', 'resolve_mcp_token', 'read_mcp_summaries',
    'reserve_search_request'
  )
order by p.proname;
