/*
 * Testet die KI-Edge-Function "claude" end-to-end.
 * Ausführen: node tools/test-ai.js
 */
const { createClient } = require('@supabase/supabase-js');
const URL = 'https://stmdyyaaibpywpvfmuph.supabase.co';
const KEY = 'sb_publishable_QRU3uPValHydnj5I54IMIw_1jpPvgnR';

(async () => {
  const c = createClient(URL, KEY);
  const { error: aErr } = await c.auth.signInAnonymously();
  if (aErr) {
    console.error('Auth-Fehler:', aErr.message);
    process.exit(1);
  }
  console.log('1) anonym angemeldet ✓');

  console.log('2) KI-Liste generieren ("Wocheneinkauf für 4 Personen")…');
  let r = await c.functions.invoke('Claude', { body: { mode: 'generate', input: 'Wocheneinkauf für 4 Personen' } });
  if (r.error) {
    console.error('   ❌ Fehler:', r.error.message || r.error);
    if (r.data) console.error('   Antwort:', JSON.stringify(r.data));
    process.exit(2);
  }
  if (r.data && r.data.error) {
    console.error('   ❌ Funktion meldet:', r.data.error);
    process.exit(2);
  }
  console.log('   Titel:', r.data.title);
  console.log('   Artikel (' + (r.data.items || []).length + '):', (r.data.items || []).slice(0, 6).join(', '), '…');

  console.log('3) Einkauf sortieren…');
  const items = ['Milch', 'Brot', 'Äpfel', 'Tiefkühlpizza', 'Spülmittel', 'Bananen', 'Joghurt', 'Cola'];
  let s = await c.functions.invoke('Claude', { body: { mode: 'sort', input: { items } } });
  if (s.error || (s.data && s.data.error)) {
    console.error('   ❌ Fehler:', (s.error && s.error.message) || (s.data && s.data.error));
    process.exit(2);
  }
  (s.data.groups || []).forEach((g) => console.log('   •', g.category + ':', (g.items || []).join(', ')));

  const ok = r.data.items && r.data.items.length && s.data.groups && s.data.groups.length;
  console.log(ok ? '\n🎉 KI FUNKTIONIERT!' : '\n⚠️ Antwort unerwartet.');
  process.exit(ok ? 0 : 2);
})().catch((e) => {
  console.error('FEHLER:', e.message);
  process.exit(1);
});
