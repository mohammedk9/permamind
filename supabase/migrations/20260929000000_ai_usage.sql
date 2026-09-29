-- Additive, idempotent migration for the shared free AI allowance.
-- This migration intentionally touches only the AI usage tables and RPCs.
-- It does not alter profiles, search_usage_monthly, storage_purchases, or any
-- other legacy user-data table.

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

  -- Both free allowance kinds are ten per UTC day. Keep this invariant in the
  -- database because authenticated clients can call an exposed RPC directly.
  if p_kind not in ('chat', 'summary') or p_limit <> 10 then
    raise exception 'invalid quota request';
  end if;

  insert into public.ai_usage_daily(day_key, user_id)
    values (v_day, p_user_id)
    on conflict (day_key, user_id) do nothing;

  if p_kind = 'chat' then
    select chat_count into v_used
      from public.ai_usage_daily
     where day_key = v_day and user_id = p_user_id
     for update;
  else
    select summary_count into v_used
      from public.ai_usage_daily
     where day_key = v_day and user_id = p_user_id
     for update;
  end if;

  -- A crashed request cannot call release. Expired reservations are returned
  -- to the available pool while the daily row is locked.
  update public.ai_usage_reservations
     set status = 'released', completed_at = now()
   where user_id = p_user_id
     and day_key = v_day
     and status = 'pending'
     and expires_at <= now();

  select count(*)::integer into v_pending
    from public.ai_usage_reservations
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
  insert into public.ai_usage_reservations as r (day_key, user_id, kind)
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
    from public.ai_usage_reservations
   where reservation_id = p_reservation_id;

  if not found then return false; end if;
  if auth.uid() is null or auth.uid() <> v_user_id then
    raise exception 'not authorized';
  end if;
  if v_status <> 'pending' then return false; end if;

  -- Reserve, finalize, and release all lock the daily row before the
  -- reservation row. This prevents concurrent finalization from double count.
  perform 1 from public.ai_usage_daily
   where day_key = v_day and user_id = v_user_id
   for update;
  select status, expires_at into v_status, v_expires_at
    from public.ai_usage_reservations
   where reservation_id = p_reservation_id
   for update;
  if v_status <> 'pending' then return false; end if;

  if v_expires_at <= now() then
    update public.ai_usage_reservations
       set status = 'released', completed_at = now()
     where reservation_id = p_reservation_id;
    return false;
  end if;

  if v_kind = 'chat' then
    update public.ai_usage_daily
       set chat_count = chat_count + 1, updated_at = now()
     where day_key = v_day and user_id = v_user_id;
  else
    update public.ai_usage_daily
       set summary_count = summary_count + 1, updated_at = now()
     where day_key = v_day and user_id = v_user_id;
  end if;

  update public.ai_usage_reservations
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
    from public.ai_usage_reservations
   where reservation_id = p_reservation_id;

  if not found then return false; end if;
  if auth.uid() is null or auth.uid() <> v_user_id then
    raise exception 'not authorized';
  end if;
  if v_status <> 'pending' then return false; end if;

  perform 1 from public.ai_usage_daily
   where day_key = v_day and user_id = v_user_id
   for update;
  update public.ai_usage_reservations
     set status = 'released', completed_at = now()
   where reservation_id = p_reservation_id
     and status = 'pending';
  return found;
end; $$;

revoke all on function public.release_ai_request(uuid) from public, anon;
grant execute on function public.release_ai_request(uuid) to authenticated;