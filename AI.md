# NotizApp – KI-Features einrichten

Die KI-Features (✨ **Liste aus einem Satz** + ✨ **Einkauf sortieren**) laufen über die
Claude-API. Damit dein API-Schlüssel **geheim** bleibt, läuft der Aufruf über eine
**Supabase Edge Function** (nicht in der App).

Der ganze Code ist fertig — es fehlen nur **deine 4 Schritte**.

---

## Schritt 1 – Anthropic-API-Schlüssel holen
1. Auf **console.anthropic.com** anmelden (oder registrieren).
2. **Billing**: ein kleines Guthaben aufladen (z. B. 5 $ — reicht für sehr viele Listen).
3. **API Keys → Create Key** → den Schlüssel (`sk-ant-…`) kopieren.

> 💰 Kosten: winzig. Eine Liste kostet Bruchteile eines Cents. Wenn du noch günstiger
> willst, ändere in `supabase/functions/claude/index.ts` die Zeile
> `const MODEL = 'claude-opus-4-8'` auf `'claude-haiku-4-5'` (schneller & ~5× billiger).

## Schritt 2 – Edge Function deployen (im Supabase-Dashboard)
1. Supabase → links **Edge Functions** → **Deploy a new function** (bzw. „Create function").
2. Name exakt: **`claude`**
3. Den **kompletten Inhalt** von `supabase/functions/claude/index.ts` einfügen.
4. **Deploy** klicken.

## Schritt 3 – API-Schlüssel als Secret hinterlegen
1. Supabase → **Edge Functions → Secrets** (oder **Project Settings → Edge Functions**).
2. Neues Secret:
   - Name: **`ANTHROPIC_API_KEY`**
   - Wert: dein `sk-ant-…`-Schlüssel
3. Speichern.

## Schritt 4 – KI in der App einschalten
In `src/core/config.js` die Zeile ändern:
```js
AI: false,   →   AI: true,
```
Dann veröffentlichen:
```powershell
npm run deploy
```
(und für Desktop: einfach `npm start`; fürs Tablet: `npm run sync` + neue APK)

---

## Fertig 🎉
- Links erscheint **✨ KI-Liste** → Satz eintippen („Wocheneinkauf für 4") → fertige Liste.
- In einer Notiz mit Teilaufgaben erscheint **✨ Sortieren** → ordnet Einkaufs-Artikel nach
  Supermarkt-Bereichen (Obst & Gemüse, Kühlregal, …).

> Schreib mir „KI fertig", wenn du Schritt 1–3 gemacht hast — dann teste ich den Aufruf
> und wir schalten es scharf.
