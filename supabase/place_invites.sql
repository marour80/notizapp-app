-- Einkaufs-Orte mit Freunden teilen: Anfrage -> Annehmen (mit eigenem Namen) -> Ort landet beim Freund.
-- Im Supabase-Dashboard unter SQL Editor ausfuehren.

create table if not exists public.place_invites (
  id uuid primary key default gen_random_uuid(),
  from_uid uuid not null,
  from_name text,
  to_uid uuid not null,
  name text,                       -- Name des Orts beim Absender (dient als Vorschlag)
  message text,                    -- kurze Erklaerung ("Der Rewe bei uns um die Ecke")
  lat double precision not null,
  lng double precision not null,
  radius integer default 150,
  status text default 'pending',   -- pending / accepted / declined
  created_at timestamptz default now()
);

alter table public.place_invites enable row level security;

create policy "pi_insert" on public.place_invites
  for insert with check (auth.uid() = from_uid);

create policy "pi_select" on public.place_invites
  for select using (auth.uid() = to_uid or auth.uid() = from_uid);

create policy "pi_update" on public.place_invites
  for update using (auth.uid() = to_uid);

-- Live-Benachrichtigung in der App (Realtime)
alter publication supabase_realtime add table public.place_invites;
