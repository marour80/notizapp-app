/*
 * Zentrale Konfiguration. Der publishable/anon-Key ist absichtlich öffentlich –
 * der Zugriffsschutz läuft über Row-Level-Security + anonyme Anmeldung in Supabase.
 */
(function (global) {
  global.NZ_CONFIG = {
    VERSION: '1.7.10', // wird in der Seitenleiste angezeigt – so erkennst du, ob ein Gerät aktuell ist
    SUPABASE_URL: 'https://stmdyyaaibpywpvfmuph.supabase.co',
    SUPABASE_KEY: 'sb_publishable_QRU3uPValHydnj5I54IMIw_1jpPvgnR',
    CLOUD: true, // false = nur lokal (kein Cloud-Sync)
    PUSH: true, // Firebase eingerichtet (google-services.json vorhanden) → Push aktiv
    AI: true, // KI aktiv (Edge Function "Claude" deployt + ANTHROPIC_API_KEY gesetzt)
    WEB_URL: 'https://marour80.github.io/notizapp/' // öffentliche Adresse für Teilen-Links/QR
  };
})(typeof window !== 'undefined' ? window : globalThis);
