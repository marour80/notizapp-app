-- ============================================================
--  SmartNote – Freundesliste (Kontakte zum schnellen Teilen)
--  In Supabase: SQL Editor → Run. Idempotent.
-- ============================================================

-- Deine private Kontaktliste: pro Eintrag ein Freund + dein Spitzname für ihn.
create table if not exists public.friends (
  owner           uuid not null default auth.uid(),
  friend_uid      uuid not null,
  alias           text,            -- dein eigener Name für die Person (z. B. "Mama")
  friend_username text,            -- Schnappschuss des @Namens (für Anzeige)
  created_at      timestamptz not null default now(),
  primary key (owner, friend_uid)
);
alter table public.friends enable row level security;

-- Jeder verwaltet nur seine EIGENE Liste.
drop policy if exists friends_self on public.friends;
create policy friends_self on public.friends for all
  using (owner = auth.uid())
  with check (owner = auth.uid());
