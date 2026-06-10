/*
 * Test des shareNote-UPSERT-Fix: Notiz teilen OHNE vorher zu speichern,
 * dann tritt ein zweiter Nutzer per Code bei. Ausführen: node tools/test-share2.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mem = {};
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => (mem[k] = String(v)),
  removeItem: (k) => delete mem[k]
};
globalThis.supabase = require('@supabase/supabase-js');
globalThis.NZ_CONFIG = {
  SUPABASE_URL: 'https://stmdyyaaibpywpvfmuph.supabase.co',
  SUPABASE_KEY: 'sb_publishable_QRU3uPValHydnj5I54IMIw_1jpPvgnR',
  CLOUD: true
};
for (const f of ['model', 'device', 'supabase', 'store'].map((n) => `src/core/${n}.js`)) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });
}

(async () => {
  const { NZ, NZStore, NZShare } = globalThis;
  await NZStore.ready;
  console.log('Speicher:', NZStore.kind);

  // Notiz NUR lokal erstellen, NICHT speichern → direkt teilen (der Bug-Fall)
  const note = NZ.makeNote({ title: 'Upsert-Teilen-Test' });
  const code = await NZShare.shareNote(note);
  console.log('1) geteilt mit Code:', code);

  // Zweiter Nutzer B tritt per Code bei
  const B = globalThis.supabase.createClient(NZ_CONFIG.SUPABASE_URL, NZ_CONFIG.SUPABASE_KEY, {
    auth: { persistSession: false }
  });
  await B.auth.signInAnonymously();
  const { data: noteId, error } = await B.rpc('join_note', { p_code: code });
  console.log('2) B join_note →', noteId || 'NULL', error ? 'FEHLER ' + error.message : '');

  const { data: rows } = await B.from('notes').select('id,data').eq('id', note.id);
  console.log('3) B sieht die Notiz:', (rows || []).length, rows && rows[0] ? '"' + rows[0].data.title + '"' : '');

  // Aufräumen
  await NZStore.save({ notes: [], folders: [] });

  const ok = noteId === note.id && (rows || []).length === 1;
  console.log(ok ? '\n🎉 TEILEN-FIX FUNKTIONIERT (Code wird gefunden)!' : '\n⚠️ Fehlgeschlagen.');
  process.exit(ok ? 0 : 2);
})().catch((e) => {
  console.error('FEHLER:', e.message);
  process.exit(1);
});
