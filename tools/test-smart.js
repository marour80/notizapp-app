/*
 * Testet die "schlaue" KI: Vorhaben -> passende Liste (Zutaten/Schritte).
 * Ausführen: node tools/test-smart.js
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const URL = 'https://stmdyyaaibpywpvfmuph.supabase.co';
const KEY = 'sb_publishable_QRU3uPValHydnj5I54IMIw_1jpPvgnR';

(async () => {
  const c = createClient(URL, KEY);
  await c.auth.signInAnonymously();

  console.log('1) Text-KI: "Tiramisu backen" -> soll Zutaten liefern…');
  let r = await c.functions.invoke('Claude', { body: { mode: 'generate', input: 'Tiramisu backen' } });
  if (r.error || (r.data && r.data.error)) {
    console.error('   ❌', (r.error && r.error.message) || r.data.error);
    process.exit(2);
  }
  console.log('   Titel:', r.data.title);
  console.log('   Punkte:', (r.data.items || []).join(' | '));

  console.log('\n2) Sprach-KI: "I want to bake a tiramisu" -> soll Zutaten liefern…');
  const buf = fs.readFileSync(path.join(__dirname, 'voice-tiramisu.wav'));
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'audio.wav');
  let v = await c.functions.invoke('Claude', { body: fd });
  if (v.error || (v.data && v.data.error)) {
    console.error('   ❌', (v.error && v.error.message) || v.data.error);
    process.exit(2);
  }
  console.log('   Transkript:', v.data.transcript);
  console.log('   Titel:', v.data.title);
  console.log('   Punkte:', (v.data.items || []).join(' | '));

  const smart = (r.data.items || []).length >= 4 && (v.data.items || []).length >= 4;
  console.log(smart ? '\n🎉 KI DENKT MIT (Zutaten erstellt)!' : '\n⚠️ Listen wirken zu kurz – evtl. nur übernommen.');
  process.exit(0);
})().catch((e) => {
  console.error('FEHLER:', e.message);
  process.exit(1);
});
