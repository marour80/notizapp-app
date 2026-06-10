# NotizApp – Push-Benachrichtigungen einrichten

Push am Handy braucht **Firebase Cloud Messaging (FCM)** – das ist bei Android Pflicht.
Der gesamte Code ist fertig; es fehlen nur **deine Firebase-Schritte** und ein Deploy.

## Übersicht (was schon fertig ist ✅)
- Client registriert sich für Push und speichert den Token in der Cloud (`push_tokens`) ✅
- DB-Feld `last_actor` (damit man sich nicht selbst benachrichtigt) ✅
- Server-Funktion `supabase/functions/notify` (sendet FCM) ✅

---

## Schritt 1 – Firebase-Projekt anlegen (kostenlos)
1. https://console.firebase.google.com → **Projekt hinzufügen** (Name z. B. `notizapp`).
2. Im Projekt: **Add app → Android**.
3. **Package name:** `com.notizapp.app` (genau so!).
4. **google-services.json** herunterladen und ablegen unter:
   `android/app/google-services.json`
5. Firebase-Gradle-Plugin aktivieren (einmalig):
   - in `android/build.gradle` unter `dependencies`:
     `classpath 'com.google.gms:google-services:4.4.2'`
   - am Ende von `android/app/build.gradle`:
     `apply plugin: 'com.google.gms.google-services'`

## Schritt 2 – Service-Account-Schlüssel (für den Server-Versand)
1. Firebase Console → **Projekteinstellungen → Dienstkonten → Neuen privaten Schlüssel generieren**.
2. Die heruntergeladene JSON-Datei brauchen wir gleich als Supabase-Secret.

## Schritt 3 – Datenbank vorbereiten
Im Supabase **SQL Editor** den Inhalt von **`supabase/push.sql`** ausführen.

## Schritt 4 – Server-Funktion deployen
Mit der Supabase-CLI (https://supabase.com/docs/guides/cli):
```bash
supabase login
supabase link --project-ref stmdyyaaibpywpvfmuph
# Service-Account-JSON als Secret hinterlegen (eine Zeile):
supabase secrets set FIREBASE_SERVICE_ACCOUNT="$(cat dein-service-account.json)"
# Funktion deployen:
supabase functions deploy notify --no-verify-jwt
```

## Schritt 5 – Webhook: bei Notiz-Änderung Funktion aufrufen
Supabase Dashboard → **Database → Webhooks → Create a new hook**:
- Table: `notes`
- Events: **Update** (optional auch Insert)
- Type: **Supabase Edge Functions** → Funktion `notify`
- Speichern.

## Fertig 🎉
Ab jetzt: ändert jemand eine geteilte Notiz, bekommen alle anderen Mitglieder
eine Push-Benachrichtigung am Handy – auch wenn die App geschlossen ist.

> Wenn du Schritt 1–2 (Firebase) erledigt und mir Bescheid gegeben hast,
> gehe ich die restlichen Schritte mit dir durch und teste den Versand.
