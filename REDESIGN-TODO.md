# Redesign (Glass/Teal) — Stand

Branch: `redesign-glass-ui`. `main`/TestFlight bleibt unberührt, bis alles abgesegnet ist.

## Fertig
- [x] Etappe 1: Teal/Dark-Theme + Glass/Progress-Notizkarten (angeheftet klar markiert)
- [x] Etappe 2: Bottom-Nav (Notizen/Freunde/Suche/Einstellungen), ☰-Menü entfernt, Suche in die Notizen-Ansicht
- [x] Etappe 3: Einstellungen-Screen (Design/Sprache/Konto & Name)
- [x] Etappe 4: Manrope-Schrift + SVG-Icons LOKAL (kein CDN), Mikrofon-FAB fest auf Home
- [x] Etappe 5: Editor-Ansicht — erbt Theme (Teal/Manrope) + Bottom-Nav im Editor ausgeblendet (Vollbild)
- [x] Startbildschirm (Vorlagen), Login-/Konto-Modal, Freunde: Theme geerbt, konsistent
- [x] Fix: Konto & Name — lange E-Mail abgeschnitten (Titel + kleine E-Mail/Name darunter)
- [x] Fix: Suche schließen (✕-Knopf + Enter blurrt) → Tastatur weg, Footer wieder da
- [x] Features: Push nennt echten Namen + "hat eine Teilaufgabe hinzugefügt" (notify deployt); Nickname↔Username-Sync

## Noch offen (vor App-Store-Einreichung / optional)
- [ ] **Safe-Area oben** am echten iPhone final prüfen (Titel/Editor-Leiste unter Uhr/Akku) — Regeln sind gesetzt, nur Geräte-Check
- [ ] **i18n / EN** für die neuen Texte (Bottom-Nav, Einstellungen, „Angeheftet", „Teilaufgaben", „Einstellungen"-Titel) — aktuell fest deutsch; für App-Store (Primärsprache Englisch) nötig
- [ ] **Status-Filter-Chips** (Alle / 🔴🟡🟢) — behalten (funktional); optisch später evtl. verfeinern
- [ ] **Desktop-Sidebar** noch alter Stil (mobil-first, niedrige Prio)
- [ ] Optional: Header aufhübschen (größerer „SmartNote"-Schriftzug)

## Danach
- [ ] Finaler Geräte-Test (Branch-Build)
- [ ] Version hochzählen (1.6.8) → nach `main` mergen → TestFlight-Build
