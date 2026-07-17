// NotizApp – KI-Funktionen über die Claude-API.
// Läuft als Supabase Edge Function, damit der API-Schlüssel geheim bleibt.
//
// Modi:
//   { mode: "generate", input: "Wocheneinkauf für 4" }  -> { title, items: [...] }
//   { mode: "sort",     input: { items: [...] } }        -> { groups: [{category, items}] }
//
// Benötigtes Secret (im Supabase-Dashboard setzen):
//   ANTHROPIC_API_KEY = sk-ant-...

import Anthropic from 'npm:@anthropic-ai/sdk@0.69.0';

// Modell-Mix fürs beste Preis/Qualitäts-Verhältnis:
//  • Listen erstellen + "teile mit X" erkennen → Sonnet (stark, günstiger als Opus).
//  • Einkauf sortieren (einfach) → Haiku (max. günstig).
const MODEL_GENERATE = 'claude-sonnet-4-6';
const MODEL_SORT = 'claude-haiku-4-5-20251001';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

function textFrom(res: any): string {
  const block = (res.content || []).find((b: any) => b.type === 'text');
  return (block && block.text) || '{}';
}

// Leitet aus dem Audio-MIME-Typ einen Dateinamen mit einer von OpenAI AKZEPTIERTEN Endung ab.
// Wichtig für iOS: der Recorder liefert "audio/aac" → OpenAI kennt ".aac" NICHT, aber ".m4a" (gleicher Container).
// So ist die Erkennung unabhängig davon, welchen (oder gar keinen) Namen der Client mitschickt.
function audioFilename(file: any): string {
  const t = ((file && file.type) || '').toLowerCase();
  if (t.includes('webm')) return 'audio.webm';
  if (t.includes('ogg')) return 'audio.ogg';
  if (t.includes('wav')) return 'audio.wav';
  if (t.includes('mpeg') || t.includes('mp3') || t.includes('mpga')) return 'audio.mp3';
  if (t.includes('mp4')) return 'audio.mp4';
  if (t.includes('aac') || t.includes('m4a')) return 'audio.m4a';
  const n = (file && file.name) || '';
  if (/\.(flac|m4a|mp3|mp4|mpeg|mpga|oga|ogg|wav|webm)$/i.test(n)) return n;
  return 'audio.m4a';
}

// Sprachnachricht -> Text via OpenAI Whisper.
async function transcribe(file: any, lang: string | null = null): Promise<string> {
  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY fehlt (Secret in Supabase setzen).');
  // whisper-1: in diesem OpenAI-Projekt freigeschaltet und akzeptiert die gängigen Audioformate.
  // (gpt-4o-mini-transcribe wäre genauer, ist hier aber nicht freigegeben → "does not have access".)
  const models = ['whisper-1'];
  const name = audioFilename(file);
  // Kontext-Anker gegen Whisper-Halluzinationen (kurze/leise Aufnahmen kippen sonst
  // gern in fremdsprachige Floskeln). Der Prompt verankert Sprache + Wortschatz.
  const bias =
    lang === 'en'
      ? 'Voice input for a notes app: shopping lists, tasks, appointments, or questions about my notes.'
      : 'Sprachnotiz für eine Notiz-App: Einkaufslisten, Aufgaben, Termine oder Fragen zu meinen Notizen.';
  const errs: string[] = [];
  for (const model of models) {
    const fd = new FormData();
    fd.append('file', file, name);
    fd.append('model', model);
    fd.append('prompt', bias);
    fd.append('temperature', '0');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key },
      body: fd
    });
    const j = await r.json();
    if (r.ok) return j.text || '';
    errs.push(model + ' -> ' + ((j.error && j.error.message) || 'HTTP ' + r.status));
  }
  throw new Error('Transkription fehlgeschlagen: ' + errs.join('  ||  '));
}

async function generate(client: any, prompt: string, isVoice = false, context: any = null, notes: any[] | null = null, now: string | null = null, lang: string | null = null) {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      intent: { type: 'string', enum: ['list', 'note', 'query', 'edit'] },
      title: { type: 'string' },
      items: { type: 'array', items: { type: 'string' } },
      body: { type: 'string' },
      when: { type: 'string' },
      answer: { type: 'string' },
      spoken: { type: 'string' },
      matchedIds: { type: 'array', items: { type: 'string' } },
      targetId: { type: 'string' },
      shareWith: { type: 'string' },
      summary: { type: 'string' }
    },
    required: ['intent', 'title', 'items', 'body', 'when', 'answer', 'spoken', 'matchedIds', 'targetId', 'shareWith', 'summary']
  };
  let userContent = '';
  if (now) userContent += 'JETZT (aktuelles Datum/Uhrzeit des Nutzers): ' + now + '\n';
  if (lang) userContent += 'APP-SPRACHE des Nutzers: ' + (lang === 'en' ? 'Englisch' : 'Deutsch') + '\n';
  if (notes && notes.length) userContent += 'VORHANDENE NOTIZEN DES NUTZERS (JSON):\n' + JSON.stringify(notes) + '\n\n';
  userContent += (isVoice ? 'Gesprochene Eingabe: ' : 'Eingabe: ') + prompt;
  if (context && context.title) {
    userContent =
      (now ? 'JETZT: ' + now + '\n' : '') +
      'AKTUELLER ENTWURF (vom Nutzer noch NICHT bestätigt, intent=' + (context.intent || 'list') + '):\n' +
      'Titel: ' + context.title + '\n' +
      (context.body ? 'Text: ' + context.body + '\n' : '') +
      (context.when ? 'Termin: ' + context.when + '\n' : '') +
      'Punkte: ' + ((context.items || []).join(', ') || '(keine)') + '\n' +
      (context.shareWith ? 'Teilen mit: ' + context.shareWith + '\n' : '') +
      '\nDer Nutzer möchte diesen Entwurf ANPASSEN. Seine Korrektur (gesprochen): "' + prompt + '"\n' +
      'Gib den VOLLSTÄNDIGEN aktualisierten Entwurf zurück (nicht nur die Änderung) + eine kurze Zusammenfassung der Änderung. Behalte den intent bei, außer die Korrektur verlangt klar etwas anderes.';
  }
  const res = await client.messages.create({
    model: MODEL_GENERATE,
    max_tokens: 3000,
    system:
      'Du bist der Assistent einer Notiz-App. Entscheide zuerst die ABSICHT ("intent") der Eingabe:\n' +
      '• "list" – der Nutzer will eine Liste/Aufgaben anlegen (Einkauf, Packliste, Rezept, To-dos, Vorhaben mit mehreren Schritten).\n' +
      '• "note" – der Nutzer will EINE einfache Notiz/Info/Termin festhalten, OHNE Teilaufgaben (z. B. "Padel am Montag um 16 Uhr in der Halle mit Marvin", "WLAN-Passwort ist …", "Reifen wechseln nicht vergessen"). ' +
      'Fülle dann: "title" = kurzer prägnanter Titel, "body" = die vollständige Info in 1–3 Sätzen, "items" = LEER. ' +
      '"when": Wird ein Datum/eine Uhrzeit genannt, rechne sie mithilfe von JETZT in ein absolutes Datum um und gib es als ISO-String zurück (z. B. "2026-07-15T20:00"); ohne Uhrzeit nur das Datum ("2026-07-15"); ohne Zeitangabe leer lassen.\n' +
      '• "edit" – der Nutzer will einen BESTEHENDEN Termin oder eine bestehende Notiz ÄNDERN ("der Termin von morgen soll eine Stunde früher sein", "verschieb das Padel auf Freitag 19 Uhr", "benenne die Einkaufsliste um in Wochenendeinkauf"). ' +
      'Finde die gemeinte Notiz in den VORHANDENEN NOTIZEN und trage ihre id in "targetId" ein. ' +
      'Berechne die NEUEN Werte aus den alten (z. B. "eine Stunde früher" bei when=2026-07-16T20:00 → "2026-07-16T19:00"; relative Angaben mit JETZT auflösen). ' +
      'Fülle NUR die Felder, die sich ändern ("when" neues ISO-Datum, "title" neuer Titel, "body" neuer Text) – unveränderte Felder LEER lassen. ' +
      'Will der Nutzer PUNKTE/TEILAUFGABEN HINZUFÜGEN ("füge Butter und Eier zur Einkaufsliste hinzu"): trage NUR die NEUEN Punkte in "items" ein (bestehende NICHT wiederholen) und lass when/title/body leer, außer sie ändern sich auch. Sonst "items" leer. ' +
      '"summary": Bestätigungssatz mit ALT → NEU, z. B. "Ich verschiebe „Padel mit Patrick" von Mi., 20:00 auf Mi., 19:00 – passt das?". ' +
      'Findest du keine passende Notiz, nimm stattdessen intent="query" mit answer="Diesen Termin habe ich in deinen Notizen nicht gefunden."\n' +
      '• "query" – der Nutzer FRAGT etwas über seine vorhandenen Notizen ("Wann ist mein nächstes Padel-Spiel?", "Habe ich am Mittwoch was vor?", "Was steht auf der Einkaufsliste?"). ' +
      'Beantworte die Frage NUR anhand der mitgelieferten VORHANDENEN NOTIZEN in "answer" – kurz, freundlich, konkret (nenne Datum/Uhrzeit/Ort, rechne Datumsangaben mit JETZT um, z. B. "morgen"). ' +
      'Trage die ids der passenden Notizen in "matchedIds" ein. Findest du nichts Passendes, sag das ehrlich in "answer" ("Dazu habe ich nichts in deinen Notizen gefunden."). ' +
      '"spoken" (nur bei query, sonst leer): ULTRA-KURZE Sprachfassung der Antwort zum Vorlesen – maximal ~10 Wörter, nur die Kerninfo, keine Floskeln, keine Emojis. Beispiel: answer="Ja! Am Mittwoch, den 15. Juli um 20:00 Uhr hast du Padel in der Halle mit Patrick. 🎾" → spoken="Mittwoch 20 Uhr: Padel mit Patrick.". ' +
      'Bei "query": KEINE Notiz erstellen – "title" leer, "items" leer. NIEMALS Notizen erfinden, die nicht in den Daten stehen.\n' +
      'Im Zweifel zwischen "note" und "list": Werden 3+ getrennte Dinge/Aufgaben genannt → "list", sonst "note". ' +
      'FRAGEN ERKENNEN (großzügig!): Beginnt oder klingt die Eingabe wie eine Frage – Fragewörter wie wann/was/wo/wer/wie/welche, "habe ich", "hab ich", "gibt es", "steht (irgend)was", when/what/do I have/is there – dann IMMER intent="query", auch OHNE Fragezeichen und auch bei holpriger Transkription.\n' +
      'TRANSKRIPTIONS-WÄCHTER (WICHTIG!): Die gesprochene Eingabe stammt aus automatischer Spracherkennung und ist manchmal HALLUZINIERT – typische Artefakte: kurze fremdsprachige Floskeln ohne jeden Bezug zu Notizen/Aufgaben/Terminen (z. B. arabische Sätze wie "اشتركوا في القناة", "Untertitel im Auftrag des ZDF", "Thanks for watching", reine Danksagungen oder Musik-Beschreibungen). ' +
      'Wenn die Eingabe so ein Artefakt ist oder schlicht keinen verwertbaren Inhalt hat: intent="query", "answer" = eine kurze Bitte um Wiederholung in der APP-SPRACHE (z. B. "Das habe ich leider nicht verstanden – versuch es bitte nochmal."), alles andere leer. NIEMALS aus so einem Artefakt eine Notiz oder Liste bauen.\n' +
      'ANTWORT-SPRACHE bei "query": dieselbe Sprache wie die Frage; bei unverständlicher Eingabe die APP-SPRACHE.\n\n' +
      'FÜR intent="list" gilt: Wandle die Eingabe in eine übersichtliche Liste um: einen kurzen Titel und passende Teilaufgaben (3–25 knappe Punkte, ohne Nummerierung).\n' +
      'SPRACHE (WICHTIG): Antworte durchgehend in EINER einzigen Sprache – derselben, in der die eigentlichen Inhalte/Aufgaben des Nutzers stehen. Titel, Teilaufgaben UND die Zusammenfassung MÜSSEN in GENAU dieser Sprache sein, niemals teils Deutsch und teils eine andere Sprache. ' +
      'Falls die Eingabe am Anfang ein einzelnes fremdsprachiges oder unsinniges Bruchstück enthält (typischer Transkriptionsfehler), IGNORIERE es und richte dich nach der Sprache des eigentlichen Inhalts.\n' +
      'ZUSAMMENFASSUNG ("summary"): Schreib in 1 kurzen, freundlichen Satz (in der Sprache des Nutzers), WAS du verstanden hast und gleich tust — z. B. "Ich erstelle die Liste „Wocheneinkauf" mit Milch, Brot und Eiern und teile sie mit Mama." oder bei einer einfachen Notiz "Ich notiere: Padel am Mittwoch um 20 Uhr mit Patrick." Bei intent="query" lass "summary" leer. Diese Zusammenfassung wird dem Nutzer zur Bestätigung gezeigt.\n' +
      'TEILEN (SEHR VORSICHTIG!): Setze "shareWith" NUR dann, wenn die Eingabe ein EINDEUTIGES Teilen-Kommando enthält – also ein Teilen-Verb ' +
      '(teilen/teile, schicken/schick, senden, share, send, شارك, أرسل) ZUSAMMEN mit "mit/an/with/to/مع/إلى" und einem Namen, ' +
      'z. B. "…und teile das mit Mama", "share this with Anna", "schick das an Papa". ' +
      'Dann schreib NUR den genannten Namen in das Feld "shareWith" (z. B. "Mama", "Anna", "Papa") und lass diesen Teil-mit-Satz aus den Teilaufgaben WEG. ' +
      'Ein bloßer Name – oder ein Wort, das nur zufällig wie ein Name KLINGT (z. B. eine Zutat oder ein Lebensmittel wie لحمة/„Fleisch") – ist KEIN Teilen-Befehl ' +
      'und gehört normal in die Teilaufgaben. Sagt der Nutzer nichts vom Teilen, lass "shareWith" IMMER leer. Im Zweifel lieber gar nicht teilen als falsch teilen.\n' +
      'Erkenne dabei selbst, was gemeint ist:\n' +
      '• Nennt der Nutzer KONKRETE Dinge/Aufgaben (z. B. "Milch, Brot, Zahnarzt anrufen"), übernimm genau diese.\n' +
      '• Nennt der Nutzer ein VORHABEN oder ZIEL (z. B. "Tiramisu backen", "Geburtstagsparty planen", "für 3 Tage packen"), ' +
      'denk SELBST mit und erstelle die passende Liste — z. B. die nötigen Zutaten beim Kochen/Backen, oder die Schritte/Dinge beim Planen.\n' +
      '• Mischt der Nutzer beides, kombiniere sinnvoll.\n' +
      'WICHTIG bei Rezepten/Kochen/Backen: Gib zu JEDER Zutat eine sinnvolle MENGE an (z. B. "250 g Mascarpone", "3 Eier", "100 ml Espresso", "1 Pck. Löffelbiskuits").\n' +
      'Berücksichtige genannte PORTIONEN / Personenzahl und SKALIERE die Mengen entsprechend (z. B. "für 8 Personen" → doppelte Mengen ggü. 4). ' +
      'Ohne Angabe nimm eine übliche Menge (etwa 4 Portionen) und schreib die Portionszahl in den Titel (z. B. "Tiramisu (4 Portionen)").',
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: userContent }]
  });
  return JSON.parse(textFrom(res));
}

// Foto lesen (Rezept, Einkaufszettel, Tafel, Notiz) → Liste oder Notiztext.
async function readPhoto(client: any, dataUrl: string, lang: string | null, now: string | null) {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) throw new Error('Ungültiges Bild (erwartet data:image/...;base64).');
  const mediaType = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
  const b64 = m[2];
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      intent: { type: 'string', enum: ['list', 'note'] },
      title: { type: 'string' },
      items: { type: 'array', items: { type: 'string' } },
      body: { type: 'string' },
      when: { type: 'string' },
      summary: { type: 'string' }
    },
    required: ['intent', 'title', 'items', 'body', 'when', 'summary']
  };
  const res = await client.messages.create({
    model: MODEL_GENERATE,
    max_tokens: 2000,
    system:
      'Du liest den Inhalt eines FOTOS für eine Notiz-App aus (z. B. Rezept aus einem Kochbuch, handgeschriebener Einkaufszettel, Tafel/Whiteboard, Etikett, Plakat mit Termin).\n' +
      '• Enthält das Bild eine LISTE oder ein Rezept → intent="list": kurzer Titel + die Punkte als "items" (Zutaten MIT Mengen, wenn angegeben). Handschrift so gut wie möglich entziffern.\n' +
      '• Ist es eher Fließtext/eine Info/ein Termin → intent="note": Titel + Inhalt in "body"; steht ein Datum/eine Uhrzeit darauf, rechne sie mithilfe von JETZT in ein ISO-Datum um ("when", z. B. "2026-07-20T19:00"), sonst "when" leer.\n' +
      'ANTWORTSPRACHE: die Sprache des Nutzers (APP-SPRACHE), unabhängig von der Sprache auf dem Foto.\n' +
      '"summary": 1 kurzer freundlicher Satz, was du erkannt hast (wird dem Nutzer zur Bestätigung gezeigt). ' +
      'Ist auf dem Foto nichts Verwertbares zu erkennen, sag das ehrlich in "summary" und lass den Rest leer.',
    output_config: { format: { type: 'json_schema', schema } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          {
            type: 'text',
            text:
              (now ? 'JETZT: ' + now + '\n' : '') +
              'APP-SPRACHE: ' + (lang === 'en' ? 'Englisch' : 'Deutsch') + '\n' +
              'Lies das Foto aus und gib das Ergebnis strukturiert zurück.'
          }
        ]
      }
    ]
  });
  return JSON.parse(textFrom(res));
}

async function sortItems(client: any, items: string[]) {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      groups: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            category: { type: 'string' },
            items: { type: 'array', items: { type: 'string' } }
          },
          required: ['category', 'items']
        }
      }
    },
    required: ['groups']
  };
  const res = await client.messages.create({
    model: MODEL_SORT,
    max_tokens: 1024,
    system:
      'Du sortierst Einkaufslisten nach Supermarkt-Bereichen (z. B. Obst & Gemüse, Kühlregal, ' +
      'Backwaren, Getränke, Tiefkühl, Haushalt, Drogerie). Behalte die EXAKTEN Artikelnamen bei. ' +
      'Ordne jeden Artikel genau einer Kategorie zu, in sinnvoller Einkaufs-Reihenfolge. ' +
      'Die KATEGORIE-NAMEN in derselben Sprache wie die Artikel (deutsche Artikel → deutsche Kategorien, englische → englische).',
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: 'Sortiere diese Artikel nach Bereich:\n' + (items || []).join('\n') }]
  });
  return JSON.parse(textFrom(res));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return json({ error: 'ANTHROPIC_API_KEY fehlt (Secret in Supabase setzen).' }, 500);
    const client = new Anthropic({ apiKey: key });

    // Sprachnachricht (multipart/form-data mit "file") -> transkribieren + Liste erstellen
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!file) return json({ error: 'Keine Audiodatei empfangen.' }, 400);
      console.log('[Claude] Audio empfangen:', (file as any).name, '|', (file as any).type, '|', ((file as any).size ?? '?') + ' bytes');
      const langField = form.get('lang') ? String(form.get('lang')) : null;
      const transcript = await transcribe(file, langField);
      console.log('[Claude] Transkript (' + transcript.length + ' Zeichen):', transcript.slice(0, 160));
      if (!transcript.trim()) return json({ error: 'Nichts verstanden – bitte nochmal aufnehmen.' }, 400);
      let context: any = null;
      try {
        const ctxRaw = form.get('context');
        if (ctxRaw) context = JSON.parse(String(ctxRaw));
      } catch {}
      let notes: any[] | null = null;
      try {
        const nRaw = form.get('notes');
        if (nRaw) notes = JSON.parse(String(nRaw));
      } catch {}
      const now = form.get('now') ? String(form.get('now')) : null;
      const list = await generate(client, transcript, true, context, notes, now, langField);
      return json({ ...list, transcript });
    }

    const { mode, input } = await req.json();
    if (mode === 'generate') {
      // input: entweder purer Text (Altclient) oder { text, notes, now, lang }
      if (input && typeof input === 'object') {
        return json(await generate(client, String(input.text || ''), false, null, input.notes || null, input.now || null, input.lang || null));
      }
      return json(await generate(client, String(input || '')));
    }
    if (mode === 'photo') return json(await readPhoto(client, String((input && input.dataUrl) || ''), (input && input.lang) || null, (input && input.now) || null));
    if (mode === 'sort') return json(await sortItems(client, (input && input.items) || []));
    return json({ error: 'Unbekannter Modus' }, 400);
  } catch (e) {
    const msg = String((e && (e as any).message) || e);
    console.error('[Claude] Fehler:', msg);
    return json({ error: msg }, 500);
  }
});
