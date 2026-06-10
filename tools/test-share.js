/*
 * Teilen-Test mit ZWEI getrennten anonymen Nutzern.
 *   A (Besitzer) erstellt + teilt eine Notiz.
 *   B (Gast) tritt per Code bei, sieht die Notiz und empfängt Live-Updates von A.
 * Ausführen mit:  node tools/test-share.js
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const A = mk();
  const B = mk();
  const uidA = await signIn(A);
  const uidB = await signIn(B);
  console.log('A (Besitzer):', uidA.slice(0, 12) + '…');
  console.log('B (Gast)   :', uidB.slice(0, 12) + '…');

  const id = 'sh_' + Date.now().toString(36);
  const code = 'TEST-' + String(Math.floor(100 + Math.random() * 900));

  console.log('\n1) A erstellt + teilt Notiz (Code ' + code + ')…');
  let r = await A.from('notes').insert({ id, owner: uidA, data: { id, title: 'Einkauf', subtasks: [] } });
  if (r.error) throw new Error('Insert: ' + r.error.message);
  r = await A.from('notes').update({ share_code: code }).eq('id', id);
  if (r.error) throw new Error('Share: ' + r.error.message);
  console.log('   ✓ geteilt');

  console.log('2) B kann die Notiz NOCH NICHT sehen (kein Mitglied)…');
  r = await B.from('notes').select('id').eq('id', id);
  console.log('   sichtbar für B:', (r.data || []).length, '(erwartet 0)');

  console.log('3) B abonniert Live-Updates + tritt per Code bei…');
  let live = false;
  B.channel('share-test')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, (p) => {
      if (p.new && p.new.id === id) {
        console.log('   ⚡ B empfängt Live-Update:', JSON.stringify(p.new.data.subtasks));
        live = true;
      }
    })
    .subscribe();
  await wait(1500);
  r = await B.rpc('join_note', { p_code: code });
  if (r.error) throw new Error('join_note: ' + r.error.message + '  → phase3-sharing.sql ausgeführt?');
  console.log('   ✓ beigetreten, note_id =', r.data);

  console.log('4) B sieht die Notiz jetzt…');
  r = await B.from('notes').select('id,data').eq('id', id);
  console.log('   sichtbar für B:', (r.data || []).length, (r.data && r.data[0] ? '→ "' + r.data[0].data.title + '"' : ''));

  console.log('5) A ändert die Notiz → B sollte ein Live-Event bekommen…');
  await A.from('notes').update({ data: { id, title: 'Einkauf', subtasks: [{ id: 's1', text: 'Milch', status: 'done' }] } }).eq('id', id);
  await wait(4000);

  console.log('6) Aufräumen…');
  await A.from('notes').delete().eq('id', id);

  const ok = (r.data || []).length === 1 && live;
  console.log(ok ? '\n🎉 TEILEN FUNKTIONIERT (Beitritt + Live-Sync)!' : '\n⚠️ Etwas fehlt (Beitritt oder Live-Event).');
  process.exit(ok ? 0 : 2);
})().catch((e) => {
  console.error('\n❌ FEHLER:', e.message);
  process.exit(1);
});
