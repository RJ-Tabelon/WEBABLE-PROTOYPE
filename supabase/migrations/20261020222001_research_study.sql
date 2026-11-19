-- Research data is deliberately outside the exposed public API schema.
-- Access is through the Next.js server with a participant-specific HttpOnly capability.
create schema if not exists research;
revoke all on schema research from public, anon, authenticated;

create table research.invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  session_hash text unique check (session_hash ~ '^[a-f0-9]{64}$'),
  sequence smallint not null check (sequence between 0 and 3),
  seed bigint not null check (seed between 0 and 4294967295),
  cohort text not null check (cohort in ('pilot', 'main')),
  revision integer not null default 0 check (revision >= 0),
  response jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  check (response is null or jsonb_typeof(response) = 'object')
);
alter table research.invites enable row level security;
revoke all on research.invites from public, anon, authenticated;
comment on table research.invites is 'WebAble research sessions; no contact details. Pilot/main cohorts are separated. Only server and researcher database connections may access.';
