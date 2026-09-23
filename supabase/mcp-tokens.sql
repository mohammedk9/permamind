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
  if (select count(*) from mcp_tokens where user_id = v_user and revoked_at is null and expires_at > now()) >= 5 then
    raise exception 'too many active MCP tokens';
  end if;

  v_token := 'pmcp_' || encode(gen_random_bytes(32), 'hex');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');
  insert into mcp_tokens(user_id, token_hash, label, expires_at)
    values (v_user, v_hash, v_label, v_expires)
    returning id into v_id;
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
