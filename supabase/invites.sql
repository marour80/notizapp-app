-- ============================================================
--  SmartNote – Teilen per Nutzername (Profile + Einladungen)
--  In Supabase: SQL Editor → Run. Idempotent.
-- ============================================================

-- 1) Profile: eindeutiger @Nutzername je Konto -----------------
create table if not exists public.profiles (
  uid          uuid primary key default auth.uid(),
  username     text unique not null,
  display_name text,
  updated_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Jeder darf Profile LESEN (nötig, um per Nutzername zu suchen).
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);

-- Nur sein eigenes Profil schreiben.
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for all
  using (uid = auth.uid())
  with check (uid = auth.uid());

-- 2) Einladungen ----------------------------------------------
create table if not exists public.invites (
  id         uuid primary key default gen_random_uuid(),
  note_id    text not null,
  code       text,                 -- Teilen-Code zum Beitreten
  from_uid   uuid not null default auth.uid(),
  from_name  text,
  to_uid     uuid not null,
  note_title text,
  status     text not null default 'pending',  -- pending | accepted | declined
  created_at timestamptz not null default now()
);
alter table public.invites enable row level security;

-- Absender: eigene Einladungen anlegen + sehen.
drop policy if exists invites_insert on public.invites;
create policy invites_insert on public.invites for insert
  with check (from_uid = auth.uid());
drop policy if exists invites_sender_read on public.invites;
create policy invites_sender_read on public.invites for select
  using (from_uid = auth.uid());

-- Empfänger: eigene Einladungen sehen + Status ändern (annehmen/ablehnen).
drop policy if exists invites_recipient_read on public.invites;
create policy invites_recipient_read on public.invites for select
  using (to_uid = auth.uid());
drop policy if exists invites_recipient_upd on public.invites;
create policy invites_recipient_upd on public.invites for update
  using (to_uid = auth.uid())
  with check (to_uid = auth.uid());

-- Realtime für Einladungen aktivieren (damit Anfragen sofort ankommen).
alter publication supabase_realtime add table public.invites;
