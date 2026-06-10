/*
 * Integrationstest des ECHTEN App-Codes (core/store.js + core/supabase.js).
 * Simuliert die Browser-Globals (localStorage, supabase, NZ_CONFIG) und fährt
 * einen vollen Zyklus über NZStore: save → load → save(gelöscht) → load.
 * Ausführen mit:  node tools/test-adapter.js
 */
const fs = require('fs');
const path = require('path');

// --- Browser-Globals simulieren ---
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

const vm = require('vm');
for (const f of ['src/core/model.js', 'src/core/device.js', 'src/core/supabase.js', 'src/core/store.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });
}

(async () => {
  const { NZ, NZStore } = globalThis;

  await NZStore.ready;
  console.log('1) Aktiver Speicher:', NZStore.kind, NZStore.kind === 'supabase' ? '✓' : '❌ (erwartet supabase)');
  if (NZStore.kind !== 'supabase') process.exit(1);

  const note = NZ.makeNote({ title: 'Adapter-Test', subtasks: [NZ.makeSubtask('Milch')] });
  console.log('2) save() in die Cloud…');
  await NZStore.save({ notes: [note], folders: ['Einkauf'] });

  console.log('3) load() aus der Cloud…');
  const back = await NZStore.load();
  const found = back.notes.find((n) => n.id === note.id);
  console.log('   gelesen:', found ? found.title + ' | Teilaufgabe: ' + found.subtasks[0].text : 'NICHT GEFUNDEN');
  if (!found) process.exit(1);

  console.log('4) Notiz löschen (save ohne sie)…');
  await NZStore.save({ notes: [], folders: ['Einkauf'] });
  const after = await NZStore.load();
  const stillThere = after.notes.some((n) => n.id === note.id);
  console.log('   noch vorhanden?', stillThere ? 'JA ❌' : 'NEIN ✓');

  console.log(!stillThere && found ? '\n🎉 ADAPTER + CLOUD ARBEITEN KORREKT!' : '\n⚠️ Etwas stimmt nicht.');
  process.exit(!stillThere && found ? 0 : 2);
})();
