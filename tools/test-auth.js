/*
 * Testet die optionale E-Mail-Anmeldung:
 *  A (anonym) erstellt Notiz → sichert mit E-Mail+Passwort.
 *  B (neues Gerät) meldet sich an → muss dieselbe uid + Notiz sehen.
 * Ausführen: node tools/test-auth.js
 */
const { createClient } = require('@supabase/supabase-js');
const URL = 'https://stmdyyaaibpywpvfmuph.supabase.co';
const KEY = 'sb_publishable_QRU3uPValHydnj5I54IMIw_1jpPvgnR';
const mk = () => createClient(URL, KEY, { auth: { persistSession: false } });

(async () => {
  const A = mk();
  await A.auth.signInAnonymously();
  const uid = (await A.auth.getUser()).data.user.id;
  const id = 'auth_' + Date.now().toString(36);
  await A.from('notes').insert({ id, owner: uid, data: { id, title: 'Sicherungs-Test', subtasks: [] } });
  console.log('1) anonym, Notiz erstellt. uid =', uid.slice(0, 12) + '…');

  const email = 'test_' + Date.now().toString(36) + '@notizapp-test.de';
  const pw = 'geheim123';
  const { error: upErr } = await A.auth.updateUser({ email, password: pw });
  console.log('2) sichern mit', email, '→', upErr ? 'FEHLER: ' + upErr.message : 'ok');

  const B = mk();
  const { data: si, error: siErr } = await B.auth.signInWithPassword({ email, password: pw });
  if (siErr) {
    console.log('3) Anmelden auf Gerät B → FEHLER:', siErr.message);
    if (/confirm/i.test(siErr.message)) {
      console.log('   → In Supabase E-Mail-Bestätigung ausschalten (Anleitung folgt).');
    }
    await A.from('notes').delete().eq('id', id);
    process.exit(2);
  }
  const same = si.user.id === uid;
  const { data: rows } = await B.from('notes').select('id,data').eq('id', id);
  console.log('3) B angemeldet. gleiche uid?', same, '| sieht Notiz?', (rows || []).length === 1);

  await B.from('notes').delete().eq('id', id);
  console.log(same && (rows || []).length === 1 ? '\n🎉 E-MAIL-ANMELDUNG FUNKTIONIERT!' : '\n⚠️ Etwas stimmt nicht.');
  process.exit(same && (rows || []).length === 1 ? 0 : 2);
})().catch((e) => {
  console.error('FEHLER:', e.message);
  process.exit(1);
});
