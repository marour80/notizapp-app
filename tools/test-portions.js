/*
 * Testet Mengenangaben + Portionen.
 * Ausführen: node tools/test-portions.js
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const URL = 'https://stmdyyaaibpywpvfmuph.supabase.co';
const KEY = 'sb_publishable_QRU3uPValHydnj5I54IMIw_1jpPvgnR';
const hasQty = (items) => items.filter((t) => /\d/.test(t)).length;

(async () => {
  const c = createClient(URL, KEY);
  await c.auth.signInAnonymously();

  console.log('1) Text: "Tiramisu für 8 Personen" -> Mengen + skaliert?');
  let r = await c.functions.invoke('Claude', { body: { mode: 'generate', input: 'Tiramisu für 8 Personen' } });
  if (r.error || (r.data && r.data.error)) { console.error('   ❌', (r.error && r.error.message) || r.data.error); process.exit(2); }
  console.log('   Titel:', r.data.title);
  (r.data.items || []).forEach((t) => console.log('   •', t));
  console.log('   Punkte mit Menge:', hasQty(r.data.items || []) + '/' + (r.data.items || []).length);

  console.log('\n2) Sprache: "tiramisu for eight people" -> Mengen?');
  const buf = fs.readFileSync(path.join(__dirname, 'voice-tiramisu8.wav'));
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'audio.wav');
  let v = await c.functions.invoke('Claude', { body: fd });
  if (v.error || (v.data && v.data.error)) { console.error('   ❌', (v.error && v.error.message) || v.data.error); process.exit(2); }
  console.log('   Transkript:', v.data.transcript);
  console.log('   Titel:', v.data.title);
  console.log('   Punkte mit Menge:', hasQty(v.data.items || []) + '/' + (v.data.items || []).length);

  const ok = hasQty(r.data.items || []) >= 4 && hasQty(v.data.items || []) >= 4;
  console.log(ok ? '\n🎉 MENGEN + PORTIONEN FUNKTIONIEREN!' : '\n⚠️ Zu wenige Mengenangaben.');
  process.exit(0);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
