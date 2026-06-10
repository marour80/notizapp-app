/*
 * Echtzeit-Test: abonnieren → schreiben → Live-Event erwarten → aufräumen.
 * Ausführen mit:  node tools/test-realtime.js
 */
const { createClient } = require('@supabase/supabase-js');

const URL = 'https://stmdyyaaibpywpvfmuph.supabase.co';
const KEY = 'sb_publishable_QRU3uPValHydnj5I54IMIw_1jpPvgnR';

(async () => {
  const c = createClient(URL, KEY, { auth: { persistSession: false } });
  const { data: auth, error } = await c.auth.signInAnonymously();
  if (error) {
    console.error('Auth-Fehler:', error.message);
    process.exit(1);
  }
  const uid = auth.user.id;
  // Realtime-Socket mit dem User-Token versorgen, sonst blockiert RLS die Events.
  c.realtime.setAuth(auth.session.access_token);
  let got = false;
  const id = 'rt_' + Date.now().toString(36);

  c.channel('rt-test')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, (p) => {
      console.log('   ⚡ Live-Event:', p.eventType, '→', (p.new && p.new.data && p.new.data.title) || '');
      got = true;
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        console.log('1) Realtime abonniert. Schreibe Notiz…');
        await c.from('notes').insert({ id, owner: uid, data: { id, title: 'Live!', subtasks: [] } });
      }
    });

  setTimeout(async () => {
    await c.from('notes').delete().eq('id', id);
    console.log(got ? '\n🎉 ECHTZEIT FUNKTIONIERT!' : '\n⚠️ Kein Live-Event (Realtime evtl. nicht aktiv).');
    process.exit(got ? 0 : 2);
  }, 6000);
})();
