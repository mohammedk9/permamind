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