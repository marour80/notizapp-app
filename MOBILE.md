# NotizApp – Web & Handy (Phase 4)

Die App läuft jetzt auf **drei** Wegen aus **einer** Codebasis:

| Plattform | Wie starten | Status |
|---|---|---|
| 🖥️ Desktop (Electron) | `npm start` | ✅ fertig |
| 🌐 Web / PWA | `npm run web` → http://localhost:8080 | ✅ fertig & getestet |
| 📱 Android (Capacitor) | siehe unten | ⏳ Gerüst fertig, Build braucht Android Studio |
| 📱 iOS (Capacitor) | nur auf einem Mac mit Xcode | ⏳ später |

---

## 🌐 Web / PWA testen (geht sofort)
```bash
npm run web
```
Dann im Browser **http://localhost:8080** öffnen. Am Handy im selben WLAN:
`http://<deine-PC-IP>:8080` → Browser-Menü → **„Zum Startbildschirm hinzufügen"** →
die App liegt wie eine echte App auf dem Homescreen, läuft im Vollbild und offline.

> Die Cloud (Supabase) funktioniert im Browser identisch – Teilen, Live-Sync, alles.

---

## 📱 Android-App bauen

### Einmalig einrichten
1. **Android Studio** installieren: https://developer.android.com/studio
   (bringt das Android-SDK und einen Emulator mit)
2. **JDK 17** wird von Android Studio mitgeliefert.

### Bei jeder Änderung am App-Code
```bash
npm run sync        # kopiert die Web-App (src/) ins Android-Projekt
npm run android     # öffnet das Projekt in Android Studio
```
In Android Studio dann oben auf **▶ Run** – die App startet im Emulator oder auf
deinem per USB angeschlossenen Handy.

### Was schon vorbereitet ist
- `android/` Projekt-Gerüst ✅
- App-Icons & Splash-Screen (alle Auflösungen) ✅
- `capacitor.config.json` (App-ID `com.notizapp.app`) ✅

---

## 🍎 iOS-App
Braucht einen **Mac mit Xcode**. Dann dort:
```bash
npm install @capacitor/ios
npx cap add ios
npx cap open ios
```

---

## 🔜 Noch offen für die native App (nächste Schritte)
Diese funktionieren im Web schon teils, brauchen am Handy aber native Plugins:

1. **Tiefen-Link** `notizapp://join?code=…` → App öffnen, wenn jemand den Link/QR antippt
   (Android-`intent-filter` + iOS-URL-Scheme + `@capacitor/app`-Listener).
2. **QR-Code scannen** mit der Handy-Kamera (`@capacitor/barcode-scanner`).
3. **Native Push-Benachrichtigungen** (`@capacitor/push-notifications` + Firebase).

Diese drei baue ich, sobald das Android-Projekt bei dir einmal läuft.

---

## 🏪 Veröffentlichen (wenn du die Konten hast)
- **Google Play**: 25 $ einmalig → in Android Studio ein „signed App Bundle (.aab)" bauen → hochladen.
- **Apple App Store**: 99 $/Jahr → in Xcode archivieren → über App Store Connect hochladen.
