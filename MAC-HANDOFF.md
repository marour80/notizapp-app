# SmartNote — iOS/Mac-Übergabe (Basis-Infos; Versionsstand siehe `git log`)

Diese Datei bringt eine **frische Claude-Code-Sitzung auf dem Mac** sofort auf Stand,
um den iOS-Build in TestFlight / den App Store zu bringen.
(Erstellt aus der Windows-Sitzung, in der die App entwickelt wird — dort liegt die Gesprächs-Historie.
Die Versionsangaben unten können veraltet sein — der `git log` ist die Wahrheit.)

> **An Claude auf dem Mac:** Lies diese Datei komplett, dann arbeite mit dem User am iOS-Build weiter.
> Der User sitzt am Mac und kann dir **Xcode-Screenshots direkt in die Sitzung ziehen**.

## ⚠️ REGEL: Jedes UI-Feature muss in BEIDEN Layouts ankommen

Es gibt EIN gemeinsames `src/` für alle Plattformen; Unterschiede laufen NUR über CSS-Breakpoints:
- **Mobil** (`@media (max-width: 760px)`): Bottom-Nav (`#bottomNav`), Screens als Vollbild-Overlays.
- **Breit / Tablet / Desktop** (`min-width: 761px`): `.side-nav` in der Seitenleiste (gleiche
  `data-nav`-Semantik wie die Bottom-Nav), **Termine** liegen als mittlere Spalte exakt über der
  Notizen-Listen-Spalte (left:240px; width:300px) und der Inhalt öffnet rechts im Editor —
  gleiches Muster wie Notizen. Einstellungen = Seite neben der Seitenleiste.

**Beim Bauen neuer Tabs/Screens/Buttons immer beide Breiten verdrahten und im Preview bei
Handy- UND Desktop-Breite testen** — sonst driften iPhone und Tablet auseinander (ist passiert:
das 1.7.x-Redesign war anfangs mobil-only, das Tablet zeigte noch die alte Oberfläche).
Tab-Wechsel müssen auf breiten Screens den Editor schließen (`closeEditor()`), sonst bleibt
rechts die zuletzt offene Notiz stehen.

---

## Was ist SmartNote?
Sprachgesteuerte Notiz-/Listen-/Einkaufs-App. **Capacitor 8** (Android + iOS), reines **Vanilla-JS** in `src/`
(kein Bundler; globale Namespaces: NZ, NZStore, NZAI, NZAuth, NZShare, NZProfile, NZInvites, NZFriends,
NZNative, NZI18N, NZ_CONFIG). Backend: **Supabase** (Postgres + RLS + anon-Auth + Realtime + Edge Functions).
KI: **Claude-API** + **OpenAI-Transkription** (Edge Function „Claude"). Push: **Firebase FCM**.

## Repo & Build-Basis (Mac)
- Repo: **github.com/marour80/notizapp-app**, Branch **main**. Auf dem Mac geklont nach `~/notizapp-app`.
- **Node + CocoaPods via Homebrew** installiert (System-Ruby 2.6 zu alt für ffi → `pod` 1.16.2 über brew).
- Gitignored: `.claude/`, `google-services.json`, `android/keystore.properties`, AAB/IPA.

## Aktueller Stand
- Version **1.6.3** (Android versionCode 20). **Android** ist im Google-Play-Closed-Test.
- **iOS** läuft im Simulator. Google-Login funktioniert (via `@capacitor/browser` + `smartnote://`-Schema).
- Zuletzt gefixt: **nativer iOS-Audio-Recorder** (`capacitor-voice-recorder`) statt Web-MediaRecorder
  (Web-Aufnahme auf iOS = stilles Audio → Whisper halluziniert „you"). Edge Function „Claude" zuletzt
  aktualisiert (Transkription `gpt-4o-mini-transcribe` + strengere „teile mit X"-Erkennung) — vom User deployt.

## iOS-Eckdaten
- Bundle-ID: **com.getsmartnote.app**
- App Store Connect: App **„SmartNote – Notes & Lists"**, primary language English.
- Deep-Link-Schema: **smartnote://** (OAuth-Callback `smartnote://login-callback`).
- App-ID im Apple-Portal mit Capabilities **Sign in with Apple** + **Push**.

## ⚠️ Wichtige Stolpersteine (gestern gab's Xcode-Ärger)
1. **Immer `App.xcworkspace` öffnen, NIE `App.xcodeproj`** — sonst fehlen alle CocoaPods-Plugins
   (Symptom: `Capacitor.Plugins.VoiceRecorder` == false). Am sichersten: `npx cap open ios`.
2. **Nach jeder Code-Änderung aus dem Repo** (sonst baut Xcode alten Stand):
   ```
   cd ~/notizapp-app
   git restore package-lock.json   # nur falls "local changes ... would be overwritten by merge"
   git pull
   npm install
   npx cap sync ios
   ```
   `cap sync ios` muss unten **`capacitor-voice-recorder`** auflisten und **„pod install"** durchlaufen.
3. **Info.plist** (`ios/App/App/Info.plist`) braucht zwei Einträge — beim Neugenerieren von `ios/` weg:
   - `NSMicrophoneUsageDescription` (sonst **Crash** beim nativen Recorder).
   - `CFBundleURLTypes` mit URL-Scheme `smartnote` (für die OAuth-Rückleitung).
   Neu setzen (idempotent):
   ```
   /usr/libexec/PlistBuddy -c "Print :NSMicrophoneUsageDescription" ios/App/App/Info.plist 2>/dev/null \
     || /usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string SmartNote nutzt das Mikrofon fuer Sprachnotizen." ios/App/App/Info.plist
   /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" ios/App/App/Info.plist 2>/dev/null
   /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" ios/App/App/Info.plist 2>/dev/null
   /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string smartnote" ios/App/App/Info.plist 2>/dev/null
   ```
4. Simulator-Mikrofon: macOS muss dem **Simulator** Mikrofon-Zugriff geben
   (Systemeinstellungen → Datenschutz & Sicherheit → Mikrofon → Simulator AN), sonst stilles Audio.
   Endgültiger Test der Sprache am besten auf einem **echten iPhone via TestFlight**.

## Nächste Schritte (Ziel: TestFlight → App-Store-Review)
1. **Xcode → Signing & Capabilities:** Team = Apple-Developer-Account des Users, „Automatically manage
   signing" an, Bundle-ID `com.getsmartnote.app`.
2. **Sign in with Apple einbauen** — Apple-Guideline **4.8** verlangt es, weil Google-Login existiert.
   Im App-Code existiert bereits `NZAuth.signInWithApple` + ein versteckter `appleSignInBtn`.
   Offen: Apple-Provider in **Supabase** aktivieren/konfigurieren (Services-ID + Key), Button einblenden, testen.
3. **Version/Build** in Xcode setzen (z. B. Version 1.6.3, Build 1).
4. **Archivieren & hochladen:** Schema „App", Ziel **„Any iOS Device (arm64)"** →
   Product → **Archive** → **Distribute App** → **App Store Connect** → **Upload** → landet in **TestFlight**.
5. **App-Store-Listing:** englischer Text liegt in `store/STORE-LISTING.md`; Screenshots ergänzen;
   Datenschutz-Seite ist live (`src/privacy.html`). Dann zur **Review** einreichen.

## Arbeitsweise
- Bei Build-/Signing-Fehlern: **erst die genaue Meldung lesen** (Xcode Report Navigator bzw. `xcodebuild`-Log),
  dann gezielt fixen — nicht blind neu bauen.
- Größere Code-Änderungen macht der User am liebsten in der **Windows-Sitzung** (dort ist die Historie);
  diese committet + pusht, der Mac zieht per `git pull`. Der Mac ist für **Xcode/Build/Signing/Upload** zuständig.
