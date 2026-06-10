/*
 * NZStore – austauschbare Speicher-Schicht.
 * Die gesamte App spricht NUR mit diesem Interface, nie direkt mit Datei/Cloud.
 * So können wir den Hintergrund beliebig tauschen, ohne die UI anzufassen:
 *
 *   Interface:
 *     load()        -> Promise<{ notes, folders }>
 *     save(data)    -> Promise<void>
 *     onChanged(cb) -> ruft cb() bei externen Änderungen (anderes Fenster/Tab/Gerät)
 *
 *   Adapter heute:
 *     - electron : lokale Datei via window.api (Desktop)
 *     - web      : localStorage (Browser/PWA, Sync über Tabs)
 *   Adapter später (Phase 2):
 *     - supabase : Cloud-DB + Echtzeit (Handy-Sharing)
 */
(function (global) {
  const EMPTY = { notes: [], folders: [] };

  function normalize(data) {
    if (!data || typeof data !== 'object') return { notes: [], folders: [] };
    if (!Array.isArray(data.notes)) data.notes = [];
    if (!Array.isArray(data.folders)) data.folders = [];
    return data;
  }

  // ---- Electron-Adapter (Desktop) ----
  function electronAdapter() {
    return {
      kind: 'electron',
      async load() {
        return normalize(await global.api.load());
      },
      async save(data) {
        await global.api.save(JSON.parse(JSON.stringify(data)));
      },
      onChanged(cb) {
        if (global.api.onChanged) global.api.onChanged(() => cb());
      }
    };
  }

  // ---- Web-Adapter (Browser/PWA) ----
  function webAdapter() {
    const KEY = 'nz_data';
    return {
      kind: 'web',
      async load() {
        try {
          return normalize(JSON.parse(localStorage.getItem(KEY)));
        } catch {
          return { notes: [], folders: [] };
        }
      },
      async save(data) {
        localStorage.setItem(KEY, JSON.stringify(data));
      },
      onChanged(cb) {
        // Feuert, wenn ein anderer Tab denselben Key ändert.
        global.addEventListener('storage', (e) => {
          if (e.key === KEY) cb();
        });
      }
    };
  }

  function localAdapter() {
    if (global.api && typeof global.api.load === 'function') return electronAdapter();
    return webAdapter();
  }

  // Adapter-Auswahl ist async (Cloud braucht Anmeldung). Fällt bei Problemen auf lokal zurück.
  const adapterPromise = (async () => {
    const cfg = global.NZ_CONFIG || {};
    if (cfg.CLOUD && global.NZSupabase) {
      try {
        await global.NZSupabase.ensureClient();
        console.info('[NZStore] Cloud aktiv (Supabase).');
        return global.NZSupabase.adapter;
      } catch (e) {
        console.warn('[NZStore] Cloud nicht verfügbar → lokal. Grund:', e.message || e);
      }
    }
    const a = localAdapter();
    console.info('[NZStore] Speicher:', a.kind);
    return a;
  })();

  let activeKind = 'pending';
  adapterPromise.then((a) => (activeKind = a.kind));

  global.NZStore = {
    get kind() {
      return activeKind;
    },
    EMPTY,
    ready: adapterPromise,
    load: async () => (await adapterPromise).load(),
    save: async (data) => (await adapterPromise).save(data),
    onChanged: async (cb) => (await adapterPromise).onChanged(cb)
  };
})(typeof window !== 'undefined' ? window : globalThis);
