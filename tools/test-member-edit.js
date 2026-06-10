/*
 * Testet, ob ein BEIGETRETENES Mitglied (B) eine Teilaufgabe hinzufügen kann
 * und der Besitzer (A) sie sieht. Ausführen: node tools/test-member-edit.js
 */
const { createClient } = require('@supabase/supabase-js');
const URL = 'https://stmdyyaaibpywpvfmuph.supabase.co';
const KEY = 'sb_publishable_QRU3uPValHydnj5I54IMIw_1jpPvgnR';

function mk() {
  return createClient(URL, KEY, { auth: { persistSession: false } });
}
async function signIn(c) {
  const { data, error } = await c.auth.signInAnonymously();
  if (error) throw new Error('Auth: ' + error.message);
  c.realtime.setAuth(data.session.access_token);
  return data.user.id;
}

(async () => {
  const A = mk();
  const B = mk();
  const uidA = await signIn(A);
  const uidB = await signIn(B);
  const id = 'me_' + Date.now().toString(36);
  const code = 'EDIT-' + String(Math.floor(100 + Math.random() * 900));

  console.log('1) A erstellt + teilt Notiz…');
  await A.from('notes').insert({
    id,
    owner: uidA,
    share_code: code,
    data: { id, title: 'Gemeinsame Liste', subtasks: [{ id: 's1', text: 'Milch', status: 'todo' }] }
  });

  console.log('2) B tritt bei…');
  const j = await B.rpc('join_note', { p_code: code });
  if (j.error || !j.data) throw new Error('join fehlgeschlagen: ' + (j.error && j.error.message));

  console.log('3) B fügt eine Teilaufgabe hinzu (UPDATE als Mitglied)…');
  const newData = { id, title: 'Gemeinsame Liste', subtasks: [
    { id: 's1', text: 'Milch', status: 'todo' },
    { id: 's2', text: 'Brot (von B)', status: 'todo', updatedBy: { id: uidB, nickname: 'Gast' } }
  ] };
  const upd = await B.from('notes').update({ data: newData }).eq('id', id);
  if (upd.error) {
    console.error('   ❌ B darf NICHT bearbeiten:', upd.error.message);
    await A.from('notes').delete().eq('id', id);
    process.exit(2);
  }
  console.log('   ✓ B-Update ohne Fehler');

  console.log('4) A liest die Notiz → ist B\'s Teilaufgabe da?');
  const { data: rows } = await A.from('notes').select('data').eq('id', id);
  const subs = rows && rows[0] ? rows[0].data.subtasks : [];
  const hasB = subs.some((s) => s.id === 's2');
  console.log('   Teilaufgaben bei A:', subs.map((s) => s.text).join(', '));

  await A.from('notes').delete().eq('id', id);

  console.log(hasB ? '\n🎉 MITGLIED KANN BEARBEITEN & ES SYNCT!' : '\n⚠️ B\'s Änderung kam nicht an.');
  process.exit(hasB ? 0 : 2);
})().catch((e) => {
  console.error('FEHLER:', e.message);
  process.exit(1);
});
