-- CallUp Cons / Supabase
-- Execute este arquivo no SQL Editor do seu projeto Supabase.
-- Não coloque service_role key no frontend.

create extension if not exists pgcrypto;

do $$ begin
  create type public.user_status as enum ('pending','approved','rejected','blocked');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null unique,
  status public.user_status not null default 'pending',
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.login_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_token uuid not null default gen_random_uuid(),
  claimed_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.contact_status_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.login_sessions enable row level security;
alter table public.contact_status_events enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true and p.status='approved');
$$;

drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles for select using (id=auth.uid() or public.is_admin());

drop policy if exists "profiles self insert" on public.profiles;
create policy "profiles self insert" on public.profiles for insert with check (id=auth.uid());

drop policy if exists "admin manages profiles" on public.profiles;
create policy "admin manages profiles" on public.profiles for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "events own insert" on public.contact_status_events;
create policy "events own insert" on public.contact_status_events for insert with check (user_id=auth.uid());

create or replace function public.claim_login_session()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  uid uuid := auth.uid();
  p public.profiles;
  existing public.login_sessions;
begin
  if uid is null then return jsonb_build_object('allowed',false,'reason','not_authenticated'); end if;
  select * into p from public.profiles where id=uid;
  if p.status <> 'approved' then return jsonb_build_object('allowed',false,'reason',p.status); end if;

  select * into existing from public.login_sessions where user_id=uid;
  if existing.user_id is not null then
    if existing.last_seen_at > now() - interval '30 minutes' then
      return jsonb_build_object('allowed',false,'reason','active_session');
    end if;
    delete from public.login_sessions where user_id=uid;
  end if;

  insert into public.login_sessions(user_id) values(uid);
  return jsonb_build_object('allowed',true);
end $$;

create or replace function public.release_login_session()
returns void language sql security definer set search_path=public as $$
  delete from public.login_sessions where user_id=auth.uid();
$$;

create or replace function public.record_contact_status_event(p_status text)
returns void language sql security definer set search_path=public as $$
  insert into public.contact_status_events(user_id,status) values(auth.uid(),p_status);
$$;

-- Crie seu primeiro usuário normalmente pelo cadastro. Depois rode:
-- update public.profiles set is_admin=true, status='approved' where lower(email)='beawarumbyof@gmail.com';

-- Trigger para criar perfil automaticamente quando um usuário é criado.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,full_name,email,status,is_admin)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),lower(new.email),'pending',false)
  on conflict(id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
