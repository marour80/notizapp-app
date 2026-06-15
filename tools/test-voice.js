/*
 * Testet die Sprach-zu-Liste-Funktion: schickt eine Test-WAV an die Edge Function.
 * Ausführen: node tools/test-voice.js
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const URL = 'https://stmdyyaaibpywpvfmuph.supabase.co';
const KEY = 'sb_publishable_QRU3uPValHydnj5I54IMIw_1jpPvgnR';

(async () => {
  const c = createClient(URL, KEY);
  await c.auth.signInAnonymously();
  console.log('1) anonym angemeldet ✓');

  const buf = fs.readFileSync(path.join(__dirname, 'voice-test.wav'));
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'audio.wav');

  console.log('2) Audio (264 KB) an die Funktion senden → Whisper + KI…');
  const { data, error } = await c.functions.invoke('Claude', { body: fd });
  if (error) {
    console.error('   ❌ Fehler:', error.message || error);
    process.exit(2);
  }
  if (data && data.error) {
    console.error('   ❌ Funktion meldet:', data.error);
    process.exit(2);
  }
  console.log('   Transkript:', data.transcript);
  console.log('   Titel:', data.title);
  console.log('   Teilaufgaben:', (data.items || []).join(' | '));

  const ok = data.transcript && data.items && data.items.length;
  console.log(ok ? '\n🎉 SPRACHNOTIZ FUNKTIONIERT!' : '\n⚠️ Antwort unerwartet.');
  process.exit(ok ? 0 : 2);
})().catch((e) => {
  console.error('FEHLER:', e.message);
  process.exit(1);
});
