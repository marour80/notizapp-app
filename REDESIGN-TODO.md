# Redesign (Glass/Teal) — offene Punkte

Branch: `redesign-glass-ui`. `main`/TestFlight bleibt unberührt, bis alles abgesegnet ist.

## Fertig
- [x] Etappe 1: Teal/Dark-Theme + Glass/Progress-Notizkarten (angeheftet klar markiert)
- [x] Etappe 2: Bottom-Nav (Notizen/Freunde/Suche/Einstellungen), ☰-Menü entfernt, Suche in die Notizen-Ansicht
- [x] Etappe 3: Einstellungen-Screen (Design/Sprache/Konto & Name)
- [x] Etappe 4: Manrope-Schrift + SVG-Icons LOKAL (kein CDN), Mikrofon-FAB fest auf Home
- [x] Fix: Konto & Name — lange E-Mail wird abgeschnitten (Titel + kleine E-Mail/Name darunter)
- [x] Fix: Suche schließen (✕-Knopf + Enter blurrt) → Tastatur weg, Footer wieder da

## Noch offen
- [ ] **Etappe 5: Editor-Ansicht** (geöffnete Notiz: Werkzeugleiste, Titel, Teilaufgaben, Eingabefeld) im gleichen Glass/Teal-Stil nachziehen — größter verbleibender Stilbruch
- [ ] **Safe-Area oben** auf Home prüfen/fixen (sitzt „Alle Notizen" sauber unter Uhr/Akku/Notch?)
- [ ] **Status-Filter-Chips** (Alle / 🔴🟡🟢) — behalten, umbauen oder entfernen? (optischer Rest)
- [ ] **i18n** für neue Texte: Bottom-Nav-Labels, Einstellungen-Labels, „Angeheftet", „Teilaufgaben", Titel „Einstellungen" — EN-Übersetzungen ergänzen (aktuell fest deutsch)
- [ ] **Login-/Konto-Modal** (`openAuth`) noch im alten Stil → an neues Design anpassen
- [ ] **Leerer Startbildschirm** (Vorlagen-Kacheln) an neues Theme angleichen
- [ ] **Desktop-Sidebar** noch alter Stil (mobil-first, niedrige Prio)
- [ ] Optional: **Header** aufhübschen (größerer „SmartNote"-Schriftzug / cleaner wie Mockup)

## Danach
- [ ] Auf echtem iPhone testen (Branch-Build)
- [ ] Nach `main` mergen + neuer TestFlight-Build (Version hochzählen)
