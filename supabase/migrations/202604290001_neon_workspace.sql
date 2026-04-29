create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.jwt_firebase_uid()
returns text
language sql
stable
set search_path = public
as $$
  select nullif(auth.jwt() ->> 'firebase_uid', '');
$$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  firebase_uid text not null unique,
  email text,
  display_name text not null default 'User',
  avatar_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  kind text not null default 'codex',
  codex_enabled boolean not null default true,
  description text not null default '',
  last_message_preview text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint threads_kind_check check (kind in ('general', 'codex'))
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  author_id text not null,
  author_name text not null,
  author_type text not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint messages_author_type_check check (author_type in ('human', 'agent', 'system'))
);

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  display_name text not null,
  status text not null default 'pending',
  connected_by text not null,
  scopes text[] not null default '{}'::text[],
  capabilities jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integrations_provider_check check (provider in ('slack', 'github', 'notion', 'google', 'freelancer', 'codex', 'pipedream')),
  constraint integrations_status_check check (status in ('disconnected', 'pending', 'connected', 'error')),
  constraint integrations_profile_provider_unique unique (profile_id, provider)
);

create table if not exists public.integration_accounts (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid references public.integrations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  auth_provider text not null default 'pipedream',
  external_account_id text,
  external_user_id text,
  account_name text,
  status text not null default 'connected',
  scopes text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_accounts_external_unique unique (profile_id, provider, external_account_id),
  constraint integration_accounts_status_check check (status in ('disconnected', 'pending', 'connected', 'error'))
);

create index if not exists profiles_firebase_uid_idx on public.profiles (firebase_uid);
create index if not exists threads_profile_updated_idx on public.threads (profile_id, updated_at desc, id desc);
create index if not exists messages_thread_created_idx on public.messages (thread_id, created_at asc, id asc);
create index if not exists messages_profile_created_idx on public.messages (profile_id, created_at desc, id desc);
create index if not exists integrations_profile_provider_idx on public.integrations (profile_id, provider);
create index if not exists integration_accounts_profile_provider_status_idx
  on public.integration_accounts (profile_id, provider, status);
create index if not exists integration_accounts_integration_id_idx on public.integration_accounts (integration_id);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_threads_updated_at on public.threads;
create trigger set_threads_updated_at
before update on public.threads
for each row execute function public.set_updated_at();

drop trigger if exists set_integrations_updated_at on public.integrations;
create trigger set_integrations_updated_at
before update on public.integrations
for each row execute function public.set_updated_at();

drop trigger if exists set_integration_accounts_updated_at on public.integration_accounts;
create trigger set_integration_accounts_updated_at
before update on public.integration_accounts
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.threads enable row level security;
alter table public.messages enable row level security;
alter table public.integrations enable row level security;
alter table public.integration_accounts enable row level security;

alter table public.profiles force row level security;
alter table public.threads force row level security;
alter table public.messages force row level security;
alter table public.integrations force row level security;
alter table public.integration_accounts force row level security;

drop policy if exists profiles_own_access on public.profiles;
create policy profiles_own_access on public.profiles
  for all to authenticated
  using (firebase_uid = (select public.jwt_firebase_uid()))
  with check (firebase_uid = (select public.jwt_firebase_uid()));

drop policy if exists threads_own_access on public.threads;
create policy threads_own_access on public.threads
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = threads.profile_id
        and profiles.firebase_uid = (select public.jwt_firebase_uid())
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = threads.profile_id
        and profiles.firebase_uid = (select public.jwt_firebase_uid())
    )
  );

drop policy if exists messages_own_access on public.messages;
create policy messages_own_access on public.messages
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = messages.profile_id
        and profiles.firebase_uid = (select public.jwt_firebase_uid())
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = messages.profile_id
        and profiles.firebase_uid = (select public.jwt_firebase_uid())
    )
  );

drop policy if exists integrations_own_access on public.integrations;
create policy integrations_own_access on public.integrations
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = integrations.profile_id
        and profiles.firebase_uid = (select public.jwt_firebase_uid())
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = integrations.profile_id
        and profiles.firebase_uid = (select public.jwt_firebase_uid())
    )
  );

drop policy if exists integration_accounts_own_access on public.integration_accounts;
create policy integration_accounts_own_access on public.integration_accounts
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = integration_accounts.profile_id
        and profiles.firebase_uid = (select public.jwt_firebase_uid())
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = integration_accounts.profile_id
        and profiles.firebase_uid = (select public.jwt_firebase_uid())
    )
  );
