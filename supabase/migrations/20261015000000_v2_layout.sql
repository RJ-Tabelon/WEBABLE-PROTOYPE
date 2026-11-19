-- WebAble v2 (docs/10 §6, §8): consent and quota for layout planning.
--   1. accounts.ai_layout: opt-in to sending a page outline to OpenAI (off by
--      default). Separate from cloud_analysis because the recipient differs.
--   2. consume_compose_quota: the planner costs ~100x a Jev call, so it has
--      its own, much smaller limits. Callable only by the service role (the
--      `compose` Edge Function).

alter table public.accounts
  add column ai_layout boolean not null default false;

comment on column public.accounts.ai_layout is
  'Consent: send page outlines (structure and public interface words, never page text) to OpenAI for Fit view layouts.';

create table private.compose_quota (
  user_id uuid not null references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  used integer not null default 0,
  primary key (user_id, window_start)
);

create table private.compose_quota_global (
  window_start timestamptz primary key,
  used integer not null default 0
);

alter table private.compose_quota enable row level security;
alter table private.compose_quota_global enable row level security;

-- Layout planning quota: per person 10/hour and 60/day; product-wide 30/min and 2000/day.
create function public.consume_compose_quota(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hour timestamptz := date_trunc('hour', now());
  v_minute timestamptz := date_trunc('minute', now());
  v_day timestamptz := date_trunc('day', now());
  v_user_hour integer;
  v_user_day integer;
  v_global_minute integer;
  v_global_day integer;
begin
  insert into private.compose_quota as q (user_id, window_start, used) values (p_user, v_hour, 1)
    on conflict (user_id, window_start) do update set used = q.used + 1
    returning used into v_user_hour;

  select coalesce(sum(used), 0) into v_user_day
    from private.compose_quota where user_id = p_user and window_start >= v_day;

  insert into private.compose_quota_global as g (window_start, used) values (v_minute, 1)
    on conflict (window_start) do update set used = g.used + 1
    returning used into v_global_minute;

  select coalesce(sum(used), 0) into v_global_day
    from private.compose_quota_global where window_start >= v_day;

  delete from private.compose_quota where window_start < now() - interval '2 days';
  delete from private.compose_quota_global where window_start < now() - interval '2 days';

  return jsonb_build_object(
    'user_ok', v_user_hour <= 10 and v_user_day <= 60,
    'global_ok', v_global_minute <= 30 and v_global_day <= 2000
  );
end;
$$;

revoke execute on function public.consume_compose_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_compose_quota(uuid) to service_role;
