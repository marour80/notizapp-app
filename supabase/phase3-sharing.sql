-- ============================================================
--  NotizApp – Phase 3: Teilen  (in Supabase: SQL Editor → einfügen → Run)
--  Ergänzt nur die Beitreten-Funktion. Idempotent.
-- ============================================================

-- Sicheres Beitreten per Share-Code.
-- SECURITY DEFINER: darf die Notiz per Code finden, OBWOHL der Beitretende
-- sie (noch) nicht sehen darf. Es werden NUR explizit geteilte Notizen
-- (share_code gesetzt) gefunden – nichts anderes ist erreichbar.
create or replace function public.join_note(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note_id text;
begin
  if p_code is null or length(trim(p_code)) = 0 then
    return null;
  end if;

  select id into v_note_id
  from public.notes
  where share_code = upper(trim(p_code))
  limit 1;

  if v_note_id is null then
    return null; -- ungültiger Code
  end if;

  insert into public.note_members(note_id, member)
  values (v_note_id, auth.uid())
  on conflict (note_id, member) do nothing;

  return v_note_id;
end;
$$;

-- Erlaubt anonymen (eingeloggten) Nutzern den Aufruf.
grant execute on function public.join_note(text) to anon, authenticated;
