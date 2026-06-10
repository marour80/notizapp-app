// NotizApp – Push-Versand via Firebase Cloud Messaging (HTTP v1).
// Wird von einem Supabase Database Webhook bei UPDATE auf "notes" aufgerufen.
//
// Benötigte Secrets (supabase secrets set ...):
//   FIREBASE_SERVICE_ACCOUNT  = Inhalt der Service-Account-JSON (eine Zeile)
//   SUPABASE_URL              = (automatisch vorhanden)
//   SUPABASE_SERVICE_ROLE_KEY = (automatisch vorhanden)

import { createClient } from 'jsr:@supabase/supabase-js@2';

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Google OAuth2-Access-Token aus dem Service Account erzeugen (RS256-JWT).
async function getAccessToken(sa: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: sa.token_uri,
        iat: now,
        exp: now + 3600
      })
    )
  );
  const data = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data));
  const jwt = `${data}.${b64url(sig)}`;

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const json = await res.json();
  if (!json.access_token) throw new Error('OAuth fehlgeschlagen: ' + JSON.stringify(json));
  return json.access_token;
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const note = payload.record || payload.new || {};
    const noteId: string = note.id;
    const actor: string | null = note.last_actor || null;
    const title: string = (note.data && note.data.title) || 'Geteilte Notiz';
    if (!noteId) return new Response('no note', { status: 200 });

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Mitglieder der Notiz (ohne den Verursacher)
    const { data: members } = await supa.from('note_members').select('member').eq('note_id', noteId);
    let targets = (members || []).map((m: any) => m.member);
    // Besitzer ist kein Mitglied-Eintrag → ebenfalls einbeziehen
    if (note.owner) targets.push(note.owner);
    targets = targets.filter((id: string, i: number, a: string[]) => id && id !== actor && a.indexOf(id) === i);
    if (!targets.length) return new Response('no targets', { status: 200 });

    const { data: toks } = await supa.from('push_tokens').select('token').in('device', targets);
    const tokens = (toks || []).map((t: any) => t.token).filter(Boolean);
    if (!tokens.length) return new Response('no tokens', { status: 200 });

    const sa = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT')!);
    const accessToken = await getAccessToken(sa);
    const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

    let sent = 0;
    for (const token of tokens) {
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: 'NotizApp', body: `„${title}" wurde aktualisiert.` },
            data: { noteId },
            android: { priority: 'HIGH' }
          }
        })
      });
      if (r.ok) sent++;
    }
    return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response('error: ' + (e?.message || e), { status: 500 });
  }
});
