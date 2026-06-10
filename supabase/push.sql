-- ============================================================
--  NotizApp – Push-Benachrichtigungen (in Supabase: SQL Editor → Run)
--  Idempotent.
-- ============================================================

-- 1) Geräte-Push-Token (ein Token je Gerät) -------------------
create table if not exists public.push_tokens (
  device     uuid primary key default auth.uid(),
  token      text not null,
  platform   text default 'android',
  updated_at timestamptz not null default now()
);

alter table public.push_tokens enable row level security;

drop policy if exists pt_self on public.push_tokens;
create policy pt_self on public.push_tokens for all
  using (device = auth.uid())
  with check (device = auth.uid());

-- 2) Wer hat zuletzt geändert? (um sich nicht selbst zu pushen) -
alter table public.notes add column if not exists last_actor uuid;

-- 3) Echtzeit/Server kann last_actor lesen – kein Extra nötig.
