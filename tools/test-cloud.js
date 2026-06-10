/*
 * Verbindungstest für die Supabase-Cloud.
 * Ausführen mit:  node tools/test-cloud.js
 * Prüft: anonyme Anmeldung → Notiz schreiben → lesen → löschen.
 */
const { createClient } = require('@supabase/supabase-js');

const URL = 'https://stmdyyaaibpywpvfmuph.supabase.co';
const KEY = 'sb_publishable_QRU3uPValHydnj5I54IMIw_1jpPvgnR';

(async () => {
  const c = createClient(URL, KEY, { auth: { persistSession: false } });

  console.log('1) Anonyme Anmeldung…');
  const { data: auth, error: aErr } = await c.auth.signInAnonymously();
  if (aErr) {
    console.error('   ❌ FEHLER:', aErr.message);
    console.error('   → In Supabase: Authentication → Sign In/Providers → "Anonymous Sign-ins" aktivieren.');
    process.exit(1);
  }
  const uid = auth.user.id;
  console.log('   ✓ angemeldet als', uid.slice(0, 13) + '…');

  const id = 'test_' + Date.now().toString(36);
  console.log('2) Test-Notiz schreiben…');
  const { error: wErr } = await c.from('notes').insert({
    id,
    owner: uid,
    data: { id, title: 'Cloud-Test', status: 'todo', subtasks: [] }
  });
  if (wErr) {
    console.error('   ❌ FEHLER:', wErr.message);
    console.error('   → Hast du das SQL aus supabase/schema.sql ausgeführt?');
    process.exit(1);
  }
  console.log('   ✓ geschrieben');

  console.log('3) Zurücklesen…');
  const { data: rows, error: rErr } = await c.from('notes').select('id,data').eq('id', id);
  if (rErr || !rows.length) {
    console.error('   ❌ FEHLER:', rErr ? rErr.message : 'nichts gefunden');
    process.exit(1);
  }
  console.log('   ✓ gelesen:', rows[0].data.title);

  console.log('4) Aufräumen (löschen)…');
  await c.from('notes').delete().eq('id', id);
  console.log('   ✓ gelöscht');

  console.log('\n🎉 ALLES OK – die Cloud ist einsatzbereit!');
  process.exit(0);
})();
