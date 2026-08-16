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