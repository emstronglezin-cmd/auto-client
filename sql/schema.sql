-- Run once in Supabase SQL Editor. PostgreSQL only; no user-facing RLS is needed
-- because this service accesses the database with its server-side connection string.
create extension if not exists pgcrypto;

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  osm_type text not null,
  osm_id text not null,
  country text not null,
  city text not null,
  category text not null,
  name text not null,
  address text,
  phone text,
  email text,
  status text not null default 'nouveau' check (status in ('nouveau','contact manuel','démo prête','email en file','contacté','répondu','désinscrit','rebondi','erreur')),
  response_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (osm_type, osm_id)
);
create unique index if not exists leads_business_location_unique on leads (lower(name), lower(coalesce(address,'')), lower(city), lower(country));
create unique index if not exists leads_email_unique on leads (lower(email)) where email is not null;
create index if not exists leads_status_idx on leads (status, created_at desc);

create table if not exists demos (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references leads(id) on delete cascade,
  slug text not null unique,
  demo_url text not null,
  content_json jsonb not null,
  github_path text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists emails (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  demo_id uuid references demos(id) on delete set null,
  sequence integer not null default 0 check (sequence between 0 and 2),
  subject text not null,
  body_text text not null,
  brevo_message_id text,
  status text not null default 'queued' check (status in ('queued','sending','sent','dry_run','delivered','opened','clicked','bounced','failed','cancelled')),
  click_count integer not null default 0,
  sent_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lead_id, sequence)
);
create index if not exists emails_sent_at_idx on emails (sent_at desc);

create table if not exists events (
  id bigserial primary key,
  lead_id uuid references leads(id) on delete set null,
  email_id uuid references emails(id) on delete set null,
  event_type text not null,
  source text not null default 'system',
  provider_event_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists events_provider_event_unique on events(provider_event_id) where provider_event_id is not null;
create index if not exists events_type_created_idx on events(event_type, created_at desc);

-- Suppression persists even if a lead row is later removed or rediscovered.
create table if not exists blocklist (
  email text primary key,
  reason text not null default 'unsubscribe',
  created_at timestamptz not null default now()
);
