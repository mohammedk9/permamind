-- Durable daily quotas for the shared free AI key. Apply in the Supabase SQL editor.
-- The in-process limiter remains only a burst guard and is not the daily quota.

create table if not exists public.ai_usage_daily (
  day_key date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_count integer not null default 0 check (chat_count >= 0),
  summary_count integer not null default 0 check (summary_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (day_key, user_id)
);

alter table public.ai_usage_daily enable row level security;
revoke all on public.ai_usage_daily from anon, authenticated;
drop policy if exists "users read own ai usage" on public.ai_usage_daily;
create policy "users read own ai usage"
  on public.ai_usage_daily for select
  using (auth.uid() = user_id);
grant select on public.ai_usage_daily to authenticated;

create or replace function public.reserve_ai_request(
  p_user_id uuid,
  p_kind text,
  p_limit integer
) returns table(allowed boolean, used_count integer)
language plpgsql security definer set search_path = public as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_used integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized';
  end if;
  if p_kind not in ('chat', 'summary') or p_limit < 1 or p_limit > 1000 then
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
    if v_used >= p_limit then
      return query select false, v_used;
      return;
    end if;
    update ai_usage_daily
      set chat_count = chat_count + 1, updated_at = now()
      where day_key = v_day and user_id = p_user_id
      returning chat_count into v_used;
  else
    select summary_count into v_used
      from ai_usage_daily
      where day_key = v_day and user_id = p_user_id
      for update;
    if v_used >= p_limit then
      return query select false, v_used;
      return;
    end if;
    update ai_usage_daily
      set summary_count = summary_count + 1, updated_at = now()
      where day_key = v_day and user_id = p_user_id
      returning summary_count into v_used;
  end if;

  return query select true, v_used;
end; $$;

revoke all on function public.reserve_ai_request(uuid, text, integer) from public, anon;
grant execute on function public.reserve_ai_request(uuid, text, integer) to authenticated;
