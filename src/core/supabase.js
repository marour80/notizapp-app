/*
 * NZSupabase – Cloud-Adapter (Phase 2).
 * Implementiert dasselbe Interface wie die lokalen Adapter (load/save/onChanged),
 * damit store.js ihn transparent einsetzen kann.
 *
 * Sicherheit: anonyme Anmeldung (kein Login) → jeder Browser/jedes Gerät bekommt eine
 * echte, dauerhafte User-ID. Row-Level-Security sorgt dafür, dass man nur eigene
 * (und in Phase 3: geteilte) Notizen sieht.
 *
 * Offline: bei Netzfehler wird der lokale Cache (localStorage) genutzt.
 */
(function (global) {
  const CACHE_KEY = 'nz_cloud_cache';
  const FOLDERS_KEY = 'nz_folders'; // Ordner bleiben (vorerst) gerätelokal
  let client = null;
  let uid = null;
  let selfWriteAt = 0;
  let lastOwners = {}; // noteId -> owner-uid (aus letztem load), für besitz-bewusstes Speichern

  function cfg() {
    return global.NZ_CONFIG || {};
  }
  function pushOn() {
    return !!(global.NZ_CONFIG && global.NZ_CONFIG.PUSH);
  }

  function cacheGet() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY)) || { notes: [], folders: [] };
    } catch {
      return { notes: [], folders: [] };
    }
  }
  function cacheSet(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {}
  }
  function readFolders() {
    try {
      return JSON.parse(localStorage.getItem(FOLDERS_KEY)) || [];
    } catch {
      return [];
    }
  }
  function writeFolders(folders) {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders || []));
  }

  // Laufzeit-Felder (nur in der UI) vor dem Speichern entfernen.
  function stripRuntime(n) {
    const c = Object.assign({}, n);
    delete c.shared;
    delete c.ownedByMe;
    return c;
  }

  // Client erstellen + anonym anmelden (Session wird von supabase-js persistiert).
  async function ensureClient() {
    if (client && uid) return client;
    if (!global.supabase || !global.supabase.createClient) {
      throw new Error('supabase-js nicht geladen (offline?)');
    }
    const { SUPABASE_URL, SUPABASE_KEY } = cfg();
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase-Konfiguration fehlt');

    client =
      client ||
      global.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storage: localStorage }
      });

    let { data: sess } = await client.auth.getSession();
    if (!sess || !sess.session) {
      const { data, error } = await client.auth.signInAnonymously();
      if (error) throw error;
      sess = data;
    }
    // Realtime-Socket mit dem User-Token versorgen, sonst blockiert RLS die Live-Events.
    const token = sess.session && sess.session.access_token;
    if (token && client.realtime && client.realtime.setAuth) client.realtime.setAuth(token);

    const { data: u } = await client.auth.getUser();
    uid = u && u.user ? u.user.id : null;
    if (!uid) throw new Error('Keine User-ID nach Anmeldung');
    return client;
  }

  function markSelfWrite() {
    selfWriteAt = Date.now();
  }
  function isSelfEcho() {
    return Date.now() - selfWriteAt < 900;
  }

  const adapter = {
    kind: 'supabase',
    uid: () => uid,
    client: () => client,

    async load() {
      try {
        const c = await ensureClient();
        const { data: rows, error } = await c.from('notes').select('id,owner,data,share_code,updated_at');
        if (error) throw error;
        lastOwners = {};
        const notes = (rows || []).map((r) => {
          lastOwners[r.id] = r.owner;
          const n = Object.assign({}, r.data, { id: r.id });
          if (r.share_code) {
            n.share = n.share || {};
            n.share.code = r.share_code;
          } else {
            n.share = n.share || null;
          }
          n.shared = !!r.share_code;
          n.ownedByMe = r.owner === uid;
          return n;
        });
        notes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        const result = { notes, folders: readFolders() };
        cacheSet(result);
        return result;
      } catch (e) {
        console.warn('[NZSupabase] load() offline/Fehler → Cache:', e.message || e);
        return cacheGet();
      }
    },

    async save(data) {
      // lokal sofort spiegeln (Offline-Sicherheit)
      writeFolders(data.folders);
      cacheSet(data);
      try {
        const c = await ensureClient();
        markSelfWrite();
        const iso = (n) => new Date(n.updatedAt || Date.now()).toISOString();

        // Notizen nach Besitz trennen: eigene upserten, fremd-geteilte nur im data-Feld updaten.
        const mine = [];
        const joined = [];
        for (const n of data.notes || []) {
          const owner = lastOwners[n.id];
          if (owner && owner !== uid) joined.push(n);
          else mine.push(n);
        }

        if (mine.length) {
          const rows = mine.map((n) => {
            const row = { id: n.id, owner: uid, data: stripRuntime(n), updated_at: iso(n) };
            if (n.share && n.share.code) row.share_code = n.share.code;
            if (pushOn()) row.last_actor = uid; // nur wenn Push/Firebase eingerichtet (Spalte existiert)
            return row;
          });
          const { error } = await c.from('notes').upsert(rows);
          if (error) throw error;
        }

        // Fremde geteilte Notizen: nur Inhalt aktualisieren (Besitz/Code unangetastet).
        for (const n of joined) {
          const patch = { data: stripRuntime(n), updated_at: iso(n) };
          if (pushOn()) patch.last_actor = uid;
          await c.from('notes').update(patch).eq('id', n.id);
        }

        // Nur EIGENE entfernte Notizen löschen (fremde geteilte bleiben).
        const keep = new Set(mine.map((n) => n.id));
        const { data: existing } = await c.from('notes').select('id').eq('owner', uid);
        const toDelete = (existing || []).filter((r) => !keep.has(r.id)).map((r) => r.id);
        if (toDelete.length) await c.from('notes').delete().in('id', toDelete);
      } catch (e) {
        console.warn('[NZSupabase] save() offline/Fehler (lokal gesichert):', e.message || e);
      }
    },

    onChanged(cb) {
      ensureClient()
        .then((c) => {
          c.channel('nz-notes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, (p) => {
              if (isSelfEcho()) return; // eigene Änderung nicht doppelt laden
              const row = p.new && p.new.id ? p.new : p.old;
              const info = row && row.data ? { id: row.id, title: row.data.title, event: p.eventType } : {};
              cb(info);
            })
            .subscribe();
        })
        .catch(() => {});
    }
  };

  // ---- Teilen (Phase 3) ----
  // Notiz teilen → erzeugt/holt Code, schreibt share_code. Gibt Code zurück.
  async function shareNote(note) {
    const c = await ensureClient();
    let code = (note.share && note.share.code) || global.NZ.makeShareCode();
    for (let attempt = 0; ; attempt++) {
      note.share = { code, createdBy: global.NZDevice.me(), createdAt: Date.now() };
      // UPSERT: stellt sicher, dass die Notiz MIT share_code in der Cloud liegt,
      // auch wenn sie vorher noch nicht (vollständig) gespeichert war.
      const row = {
        id: note.id,
        owner: uid,
        data: stripRuntime(note),
        share_code: code,
        updated_at: new Date().toISOString()
      };
      if (pushOn()) row.last_actor = uid;
      const { error } = await c.from('notes').upsert(row);
      if (!error) return code;
      // Code-Kollision (share_code unique) → neuen Code versuchen
      if (error.code === '23505' && attempt < 5) {
        code = global.NZ.makeShareCode();
        continue;
      }
      throw error;
    }
  }

  // Beitreten per Code → gibt note_id zurück (oder null bei ungültig).
  async function joinByCode(code) {
    const c = await ensureClient();
    const { data, error } = await c.rpc('join_note', { p_code: (code || '').trim().toUpperCase() });
    if (error) throw error;
    return data || null;
  }

  // Teilen beenden (nur Besitzer): Code entfernen + alle Mitglieder lösen.
  async function unshareNote(note) {
    const c = await ensureClient();
    note.share = null;
    await c.from('notes').update({ share_code: null, data: stripRuntime(note) }).eq('id', note.id).eq('owner', uid);
    await c.from('note_members').delete().eq('note_id', note.id);
  }

  // Geteilte Notiz verlassen (Mitglied entfernt sich selbst).
  async function leaveNote(noteId) {
    const c = await ensureClient();
    await c.from('note_members').delete().eq('note_id', noteId).eq('member', uid);
  }

  // Push-Token dieses Geräts in der Cloud speichern (für native Benachrichtigungen).
  async function savePushToken(token, platform) {
    if (!token) return;
    try {
      const c = await ensureClient();
      await c.from('push_tokens').upsert({ device: uid, token, platform: platform || 'android' });
    } catch (e) {
      console.warn('[Push] Token speichern fehlgeschlagen:', e.message || e);
    }
  }

  // Live-Präsenz: wer ist gerade in dieser Notiz? onSync bekommt die Personenliste.
  async function joinPresence(noteId, meObj, onSync) {
    const c = await ensureClient();
    const ch = c.channel('presence:' + noteId, { config: { presence: { key: meObj.id } } });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState();
      const list = [];
      Object.values(state).forEach((arr) => arr.forEach((m) => list.push(m)));
      onSync(list);
    });
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await ch.track(meObj);
    });
    return {
      leave() {
        try {
          c.removeChannel(ch);
        } catch {}
      }
    };
  }

  // ---- Optionale E-Mail-Anmeldung (Notizen sichern/wiederherstellen) ----
  async function getAuthInfo() {
    const c = await ensureClient();
    const { data } = await c.auth.getUser();
    const u = data && data.user;
    return { email: (u && u.email) || null, secured: !!(u && u.email) };
  }

  // Aktuelle (anonyme) Identität mit E-Mail+Passwort dauerhaft machen.
  // uid bleibt gleich → vorhandene Notizen bleiben erhalten.
  async function secureWithEmail(email, password) {
    const c = await ensureClient();
    const { data, error } = await c.auth.updateUser({ email: email.trim(), password });
    if (error) throw error;
    try {
      localStorage.setItem('nz_last_email', email.trim());
    } catch {}
    return data;
  }

  // Auf einem (anderen) Gerät anmelden → lädt die Notizen dieses Kontos.
  async function signInEmail(email, password) {
    const c = await ensureClient();
    const { error } = await c.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    try {
      localStorage.setItem('nz_last_email', email.trim());
    } catch {}
    return true; // Aufrufer lädt die App neu (uid hat gewechselt)
  }

  function lastEmail() {
    try {
      return localStorage.getItem('nz_last_email') || null;
    } catch {
      return null;
    }
  }

  async function signOutUser() {
    const c = await ensureClient();
    try {
      localStorage.removeItem('nz_last_email');
    } catch {}
    await c.auth.signOut();
    await c.auth.signInAnonymously(); // neue anonyme Identität, App läuft weiter
  }

  global.NZSupabase = {
    adapter,
    ensureClient,
    isReady: () => !!(client && uid),
    uid: () => uid
  };

  global.NZAuth = { getAuthInfo, secureWithEmail, signInEmail, signOutUser, lastEmail };

  // ---- KI (ruft die Edge Function "claude" auf; Schlüssel bleibt serverseitig) ----
  async function aiInvoke(mode, input) {
    const c = await ensureClient();
    const { data, error } = await c.functions.invoke('Claude', { body: { mode, input } });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error);
    return data;
  }
  async function aiVoice(formData) {
    const c = await ensureClient();
    const { data, error } = await c.functions.invoke('Claude', { body: formData });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error);
    return data;
  }
  global.NZAI = {
    available: () => !!(global.NZ_CONFIG && global.NZ_CONFIG.AI),
    generate: (prompt) => aiInvoke('generate', prompt),
    sort: (items) => aiInvoke('sort', { items }),
    voice: (formData) => aiVoice(formData)
  };

  // Einheitliche Teilen-Schnittstelle (nur mit Cloud verfügbar).
  global.NZShare = {
    available: () => true,
    shareNote,
    joinByCode,
    unshareNote,
    leaveNote,
    joinPresence,
    savePushToken
  };
})(typeof window !== 'undefined' ? window : globalThis);
