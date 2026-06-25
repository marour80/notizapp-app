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

// Sprachnachricht -> Text via OpenAI (probiert mehrere Modelle, je nach Projekt-Zugriff)
async function transcribe(file: any): Promise<string> {
  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY fehlt (Secret in Supabase setzen).');
  const models = ['whisper-1', 'gpt-4o-mini-transcribe'];
  const errs: string[] = [];
  for (const model of models) {
    const fd = new FormData();
    fd.append('file', file, file.name || 'audio.webm');
    fd.append('model', model);
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

async function generate(client: any, prompt: string, isVoice = false, context: any = null) {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      items: { type: 'array', items: { type: 'string' } },
      shareWith: { type: 'string' },
      summary: { type: 'string' }
    },
    required: ['title', 'items', 'summary']
  };
  let userContent = (isVoice ? 'Gesprochene Notiz: ' : '') + prompt;
  if (context && context.title) {
    userContent =
      'AKTUELLE LISTE (vom Nutzer noch NICHT bestätigt):\n' +
      'Titel: ' + context.title + '\n' +
      'Punkte: ' + ((context.items || []).join(', ') || '(keine)') + '\n' +
      (context.shareWith ? 'Teilen mit: ' + context.shareWith + '\n' : '') +
      '\nDer Nutzer möchte diese Liste ANPASSEN. Seine Korrektur (gesprochen): "' + prompt + '"\n' +
      'Gib die VOLLSTÄNDIGE aktualisierte Liste zurück (nicht nur die Änderung) + eine kurze Zusammenfassung der Änderung.';
  }
  const res = await client.messages.create({
    model: MODEL_GENERATE,
    max_tokens: 1024,
    system:
      'Du wandelst die Eingabe in eine übersichtliche Liste um: einen kurzen Titel und passende Teilaufgaben (3–25 knappe Punkte, ohne Nummerierung).\n' +
      'ANTWORTE IN DERSELBEN SPRACHE wie die Eingabe des Nutzers (z. B. Deutsch auf Deutsch, Englisch auf Englisch). Titel UND Teilaufgaben in dieser Sprache.\n' +
      'ZUSAMMENFASSUNG ("summary"): Schreib in 1 kurzen, freundlichen Satz (in der Sprache des Nutzers), WAS du verstanden hast und gleich tust — z. B. "Ich erstelle die Liste „Wocheneinkauf" mit Milch, Brot und Eiern und teile sie mit Mama." Diese Zusammenfassung wird dem Nutzer zur Bestätigung gezeigt.\n' +
      'TEILEN: Sagt der Nutzer, dass er die Notiz mit jemandem teilen will (z. B. "…und teile das mit Mama", "share this with Anna", "schick das an Papa"), ' +
      'dann schreib NUR den genannten Namen in das Feld "shareWith" (z. B. "Mama", "Anna", "Papa") und lass diesen Teil-mit-Satz aus den Teilaufgaben WEG. ' +
      'Sagt er nichts vom Teilen, lass "shareWith" weg.\n' +
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
      const transcript = await transcribe(file);
      if (!transcript.trim()) return json({ error: 'Nichts verstanden – bitte nochmal aufnehmen.' }, 400);
      let context: any = null;
      try {
        const ctxRaw = form.get('context');
        if (ctxRaw) context = JSON.parse(String(ctxRaw));
      } catch {}
      const list = await generate(client, transcript, true, context);
      return json({ ...list, transcript });
    }

    const { mode, input } = await req.json();
    if (mode === 'generate') return json(await generate(client, String(input || '')));
    if (mode === 'sort') return json(await sortItems(client, (input && input.items) || []));
    return json({ error: 'Unbekannter Modus' }, 400);
  } catch (e) {
    return json({ error: String((e && (e as any).message) || e) }, 500);
  }
});
