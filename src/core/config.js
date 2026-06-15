/*
 * Zentrale Konfiguration. Der publishable/anon-Key ist absichtlich öffentlich –
 * der Zugriffsschutz läuft über Row-Level-Security + anonyme Anmeldung in Supabase.
 */
(function (global) {
  global.NZ_CONFIG = {
    SUPABASE_URL: 'https://stmdyyaaibpywpvfmuph.supabase.co',
    SUPABASE_KEY: 'sb_publishable_QRU3uPValHydnj5I54IMIw_1jpPvgnR',
    CLOUD: true, // false = nur lokal (kein Cloud-Sync)
    PUSH: false, // erst auf true setzen, wenn Firebase eingerichtet ist (google-services.json)
    AI: false, // erst auf true, wenn die Edge Function "claude" deployt + ANTHROPIC_API_KEY gesetzt ist
    WEB_URL: 'https://marour80.github.io/notizapp/' // öffentliche Adresse für Teilen-Links/QR
  };
})(typeof window !== 'undefined' ? window : globalThis);
