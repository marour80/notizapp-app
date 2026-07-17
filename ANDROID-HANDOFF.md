# Android-Handoff (Stand: Version 1.7.8, iOS Build 11)

> **⚠️ REGEL für beide Sessions (Mac & Windows): Jedes UI-Feature muss in BEIDEN Layouts ankommen.**
> Mobil (`max-width:760px`) = Bottom-Nav + Vollbild-Screens. Breit (`min-width:761px`) = `.side-nav`
> in der Seitenleiste (gleiche `data-nav`-Semantik); Termine als mittlere Spalte (left:240px,
> width:300px) + Inhalt rechts im Editor (wie Notizen); Einstellungen als Seite neben der Seitenleiste.
> Neue Tabs/Screens immer in beiden Breiten verdrahten und im Preview bei Handy- UND Desktop-Breite
> testen. Tab-Wechsel schließen auf breiten Screens den Editor (`closeEditor()`).
> (Seit 1.7.9/1.7.10 umgesetzt — Windows-Session hat das Tablet ans mobile Redesign angeglichen.)

Für die Claude-Session auf dem Windows-Rechner: Die iOS-Seite ist auf 1.7.8 (TestFlight).
Dieser Stand enthält seit der letzten Android-Version SEHR viele Änderungen. Ziel:
Android auf denselben Stand bringen und ein Play-Store-Bundle (AAB) bauen.

## 1. Pflicht-Schritte (in dieser Reihenfolge)

```bash
git pull
npm install            # WICHTIG: Plugins haben sich geändert (siehe unten)
npx cap sync android
```

Dann in `android/app/build.gradle` die Version setzen:
- `versionName "1.7.8"`
- `versionCode 11` (oder höher als der letzte Play-Store-Build)

Danach wie gewohnt AAB bauen und hochladen.

## 2. Geänderte Plugins (deshalb ist npm install + cap sync PFLICHT)

- **ENTFERNT: `@capacitor/push-notifications`** – Push läuft jetzt über
  **`@capacitor-firebase/messaging`** (liefert echte FCM-Tokens; src/core/native.js
  registerPush nutzt FirebaseMessaging.requestPermissions/getToken + tokenReceived).
  Die google-services.json bleibt wie sie ist. Prüfen: Läuft der
  google-services-Gradle-Plugin-Eintrag noch? (Sollte, weil Push vorher schon lief.)
- **NEU: `@capacitor/local-notifications`** – für Termin-Erinnerungen, Morgen-Briefing
  und die "Termin vorbei – erledigt?"-Nachfrage mit Aktions-Buttons.
  - Android 13+: Das Plugin fragt die POST_NOTIFICATIONS-Berechtigung ab (macht die App
    beim Aktivieren der Erinnerungen).
  - Android 12+: Für exakte Zeitpunkte ggf. `SCHEDULE_EXACT_ALARM` in der
    AndroidManifest.xml nötig – bitte prüfen und testen (Erinnerung auf 2 Min. in der
    Zukunft stellen).

## 3. Was NUR iOS ist (auf Android bewusst ohne Funktion, kein Handlungsbedarf)

- `ios/App/App/NZRecorderPlugin.swift` (Mikro-Pegel für die Voice-Orb): Android nutzt
  automatisch den Web-Weg (MediaRecorder + AnalyserNode) → Orb reagiert dort ECHT auf
  die Stimme, nichts zu tun.
- `ios/App/SmartNoteWidget/` (Homescreen-/Lockscreen-Widget) + NZWidgetPlugin:
  iOS-only. `NZNative.updateWidget()` läuft auf Android ins Leere (Plugin fehlt → no-op).
  Ein Android-Homescreen-Widget wäre ein eigenes Projekt (App-Widget + RemoteViews) –
  optional, später.

## 4. Features in diesem Stand (zum Testen auf Android)

- Sprach-Router: Liste / einfache Termin-Notiz / Frage (mit Sprachantwort) / Termin ÄNDERN
  ("der Termin morgen soll eine Stunde früher sein" → Bestätigung → ändern)
- Termine-Tab (5. Nav-Punkt) mit Agenda-Gruppen + manuellem Anlegen (+-Button, Datum-Feld
  im Editor mit nativem Picker)
- Termin-Erinnerungen (Settings: an/aus + Vorlaufzeiten, pro Termin überschreibbar)
- Morgen-Briefing (Settings: Uhrzeit)
- "Termin vorbei – erledigt?"-Push mit Buttons (✓ Erledigt verschiebt nach Vergangen)
- Foto → Liste (Kamera-Scan im Neue-Notiz-Dialog)
- Settings-Redesign (Vollbild, Profil-Karte)
- Geteilte Notizen: Mitglied-Löschen = Teilung verlassen (kein Zombie-Comeback),
  Besitzer-Löschen mit Warnung; Push zeigt echten Namen
- Leere Notizen werden verworfen; Voice-Orb statt Mikro-Emoji
- "Wer ist dabei?" (RSVP) ist FERTIG, aber per Flag deaktiviert
  (src/renderer.js: RSVP_ENABLED = false)

## 5. Server (nichts zu tun, nur wissen)

Die Supabase-Funktionen (Claude-Router mit intents list/note/query/edit + photo-Modus,
notify- mit RSVP-/Namens-Logik) sind deployed und gelten für beide Plattformen.
Push-Token-Speicherung: nach Login/Logout wird der Token unter der neuen Identität
gespeichert (refreshIdentity in src/core/supabase.js).
