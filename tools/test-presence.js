/*
 * Präsenz-Test: zwei Nutzer "betreten" dieselbe Notiz und sollten sich gegenseitig sehen.
 * Ausführen mit:  node tools/test-presence.js
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
  const idA = await signIn(A);
  const idB = await signIn(B);
  const noteId = 'pres_' + Date.now().toString(36);
  let seenByA = 0;

  function join(c, me, onSync) {
    const ch = c.channel('presence:' + noteId, { config: { presence: { key: me.id } } });
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState();
      const list = [];
      Object.values(st).forEach((arr) => arr.forEach((m) => list.push(m)));
      onSync(list);
    });
    ch.subscribe(async (s) => {
      if (s === 'SUBSCRIBED') await ch.track(me);
    });
    return ch;
  }

  console.log('1) A betritt die Notiz…');
  join(A, { id: idA, nickname: 'Anna', color: '#7c6cff' }, (list) => {
    seenByA = list.length;
  });
  await wait(1500);

  console.log('2) B betritt dieselbe Notiz…');
  join(B, { id: idB, nickname: 'Ben', color: '#3ad17a' }, () => {});
  await wait(2500);

  console.log('   A sieht jetzt', seenByA, 'Personen (erwartet 2)');
  console.log(seenByA >= 2 ? '\n🎉 LIVE-ONLINE-ANZEIGE FUNKTIONIERT!' : '\n⚠️ Präsenz nicht synchron.');
  process.exit(seenByA >= 2 ? 0 : 2);
})().catch((e) => {
  console.error('❌ FEHLER:', e.message);
  process.exit(1);
});
