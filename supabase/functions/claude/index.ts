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

// 💡 Günstiger & schneller? Auf "claude-haiku-4-5" ändern – für diese Aufgaben völlig ausreichend.
const MODEL = 'claude-opus-4-8';

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

async function generate(client: any, prompt: string, isVoice = false) {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      items: { type: 'array', items: { type: 'string' } }
    },
    required: ['title', 'items']
  };
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      'Du erstellst kompakte, praktische To-do- bzw. Einkaufslisten auf Deutsch. ' +
      'Gib eine kurze Titelzeile und 3–15 knappe Listenpunkte (nur die Sache, ohne Nummerierung, ohne Mengen außer sie sind wichtig).',
    output_config: { format: { type: 'json_schema', schema } },
    messages: [
      {
        role: 'user',
        content: isVoice
          ? 'Wandle diese gesprochene Notiz in eine übersichtliche Liste um (kurzer Titel + Teilaufgaben). ' +
            'Übernimm ALLE genannten Aufgaben/Artikel als einzelne Punkte:\n\n' + prompt
          : `Erstelle eine Liste für: ${prompt}`
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
    model: MODEL,
    max_tokens: 1024,
    system:
      'Du sortierst Einkaufslisten nach Supermarkt-Bereichen (z. B. Obst & Gemüse, Kühlregal, ' +
      'Backwaren, Getränke, Tiefkühl, Haushalt, Drogerie). Behalte die EXAKTEN Artikelnamen bei. ' +
      'Ordne jeden Artikel genau einer Kategorie zu, in sinnvoller Einkaufs-Reihenfolge.',
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
      const list = await generate(client, transcript, true);
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
