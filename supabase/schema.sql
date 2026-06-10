-- ============================================================
--  NotizApp – Datenbank-Schema  (in Supabase: SQL Editor → einfügen → Run)
--  Sicher dank Row-Level-Security + anonymer Anmeldung.
--  Idempotent: kann gefahrlos mehrfach ausgeführt werden.
-- ============================================================

-- 1) Notizen ---------------------------------------------------
create table if not exists public.notes (
  id          text primary key,
  owner       uuid not null default auth.uid(),
  data        jsonb not null,
  share_code  text unique,
  updated_at  timestamptz not null default now()
);

-- 2) Mitglieder geteilter Notizen (für Phase 3 – Teilen) -------
create table if not exists public.note_members (
  note_id   text not null references public.notes(id) on delete cascade,
  member    uuid not null default auth.uid(),
  nickname  text,
  color     text,
  joined_at timestamptz not null default now(),
  primary key (note_id, member)
);

-- 3) Hilfsfunktion gegen RLS-Rekursion -------------------------
create or replace function public.is_member(p_note text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.note_members m
    where m.note_id = p_note and m.member = auth.uid()
  );
$$;

-- 4) Row-Level-Security einschalten ----------------------------
alter table public.notes        enable row level security;
alter table public.note_members enable row level security;

-- 5) Policies: NOTES -------------------------------------------
drop policy if exists notes_select on public.notes;
create policy notes_select on public.notes for select
  using ( owner = auth.uid() or public.is_member(id) );

drop policy if exists notes_insert on public.notes;
create policy notes_insert on public.notes for insert
  with check ( owner = auth.uid() );

drop policy if exists notes_update on public.notes;
create policy notes_update on public.notes for update
  using ( owner = auth.uid() or public.is_member(id) );

drop policy if exists notes_delete on public.notes;
create policy notes_delete on public.notes for delete
  using ( owner = auth.uid() );

-- 6) Policies: NOTE_MEMBERS ------------------------------------
drop policy if exists members_select on public.note_members;
create policy members_select on public.note_members for select
  using (
    member = auth.uid()
    or exists (select 1 from public.notes n where n.id = note_id and n.owner = auth.uid())
  );

drop policy if exists members_insert on public.note_members;
create policy members_insert on public.note_members for insert
  with check ( member = auth.uid() );

drop policy if exists members_delete on public.note_members;
create policy members_delete on public.note_members for delete
  using (
    member = auth.uid()
    or exists (select 1 from public.notes n where n.id = note_id and n.owner = auth.uid())
  );

-- 7) Echtzeit aktivieren ---------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.notes;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.note_members;
exception when duplicate_object then null; end $$;
