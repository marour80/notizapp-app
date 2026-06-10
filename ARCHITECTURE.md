# NotizApp – Architektur & Roadmap

Ziel: **eine** Codebasis für **Desktop, Web/PWA und Handy** – mit geteilten Notizen
(Einkaufsliste-Style), pro Notiz teilbar, **ohne Registrierung**.

## Schichten (seit Phase 1)

```
┌─────────────────────────────────────────────┐
│  UI  (plattformspezifisch)                    │
│   • src/index.html + renderer.js  → Desktop   │
│   • src/widget.html + widget.js   → Widget    │
│   • (später) web/index.html       → PWA/Handy │
└───────────────┬───────────────────────────────┘
                │  spricht NUR mit dem Kern
┌───────────────▼───────────────────────────────┐
│  KERN  (plattformunabhängig, src/core/)        │
│   • model.js   – Datenmodell, Status-Logik     │
│   • device.js  – anonyme Identität (Wer war's) │
│   • store.js   – Speicher-Interface + Adapter  │
└───────────────┬───────────────────────────────┘
                │  austauschbarer Adapter
┌───────────────▼───────────────────────────────┐
│  SPEICHER                                      │
│   • electron : lokale Datei (Desktop) ✅        │
│   • web      : localStorage (Browser) ✅        │
│   • supabase : Cloud + Echtzeit (Phase 2) ⏳    │
└────────────────────────────────────────────────┘
```

**Wichtig:** Die UI ruft niemals direkt Datei/Cloud auf, sondern immer `NZStore`.
Dadurch tauschen wir in Phase 2 nur den Adapter aus – die UI bleibt unverändert.

## Datenmodell (Notiz)

```js
{
  id, title, body, folder, tags: [],
  status: 'todo' | 'doing' | 'done',   // bei Teilaufgaben automatisch abgeleitet
  subtasks: [ { id, text, status, updatedBy, updatedAt } ],
  share: null | { code, createdBy, members: [] },  // Phase 3
  createdAt, updatedAt
}
```

## Anonyme Identität (kein Login)

`NZDevice` erzeugt beim ersten Start lokal eine zufällige `deviceId` + Spitzname + Farbe.
Das ist die Basis für die **„Wer war's"-Spur** beim Teilen – ohne E-Mail/Passwort.

## Roadmap

- [x] **Phase 1 – Fundament**: Kern von UI getrennt, Speicher-Adapter, anonyme Identität. App läuft unverändert auf Desktop + Widget; lauffähig auch im Browser (localStorage).
- [x] **Phase 2 – Cloud-Sync**: Supabase-Adapter (Postgres + RLS + Realtime + anonyme Auth). Verifiziert: Anmeldung, Schreiben/Lesen/Löschen, Echtzeit-Events, voller Adapter-Zyklus. Offline-Cache vorhanden.
- [x] **Phase 3 – Pro-Notiz-Teilen**: Code + Link + QR, sicheres Beitreten (RPC + RLS), Live-Sync, „Wer war's"-Spur (Spitzname/Farbe pro Teilaufgabe), Live-Online-Präsenz, Desktop-Benachrichtigungen. Getestet: 2-Nutzer-Teilen, Live-Update, Präsenz.
- [~] **Phase 4 – Web/PWA + Handy**:
  - PWA fertig & im Browser getestet (Desktop + Mobile-Layout inkl. Safe-Area/iPhone + FAB, Teilen/QR, Cloud, Offline-SW). Details in MOBILE.md.
  - Capacitor-Android-Gerüst + Icons/Splash.
  - **4b**: Tiefen-Link (`notizapp://join?code=…`) + QR-Kamera-Scan implementiert (native, mit Web-Fallback). Push-Client + Server-Funktion + DB fertig vorbereitet – fehlt nur Firebase (siehe PUSH.md).
  - Offen: nativer Build/Test in Android Studio, Firebase für Push.
- [ ] **Phase 5 – Veröffentlichen**: App Store / Play Store.

## Was für Phase 2 gebraucht wird

- Ein kostenloses **Supabase-Projekt** (URL + anon-Key).
- Danach: `supabaseAdapter()` in `src/core/store.js` ergänzen (gleiches Interface wie web/electron).
