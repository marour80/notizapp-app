// SmartNote – Push-Versand via Firebase Cloud Messaging (HTTP v1).
// Wird von einem Supabase Database Webhook bei UPDATE auf "notes" aufgerufen.
//
// Benötigte Secrets (Supabase → Edge Functions → Secrets):
//   FCM_SA_B64 = Base64 des Firebase-Service-Account-JSON (eine Zeile)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  = automatisch vorhanden

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
        aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
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

  const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
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
    console.log('notify: noteId=' + noteId + ' share_code=' + (note.share_code || '-') + ' actor=' + (actor || '-'));
    // Nur geteilte Notizen sind relevant (sonst gibt es ohnehin keine Mitglieder).
    if (!noteId || !note.share_code) {
      console.log('notify: skip (nicht geteilt)');
      return new Response('skip', { status: 200 });
    }

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Empfänger = Mitglieder + Besitzer, ohne den Verursacher.
    const { data: members } = await supa.from('note_members').select('member').eq('note_id', noteId);
    let targets = (members || []).map((m: any) => m.member);
    if (note.owner) targets.push(note.owner);
    targets = targets.filter((id: string, i: number, a: string[]) => id && id !== actor && a.indexOf(id) === i);
    console.log('notify: owner=' + (note.owner || '-') + ' members=' + JSON.stringify((members || []).map((m: any) => m.member)) + ' targets=' + JSON.stringify(targets));
    if (!targets.length) {
      console.log('notify: keine Empfänger (targets leer)');
      return new Response('no targets', { status: 200 });
    }

    const { data: toks, error: tokErr } = await supa.from('push_tokens').select('device, token').in('device', targets);
    if (tokErr) console.log('notify: push_tokens-Fehler: ' + tokErr.message);
    const tokens = (toks || []).map((t: any) => t.token).filter(Boolean);
    console.log('notify: gefundene Tokens=' + tokens.length + ' (für devices ' + JSON.stringify((toks || []).map((t: any) => t.device)) + ')');
    if (!tokens.length) {
      console.log('notify: KEINE Tokens für die Empfänger → nichts gesendet');
      return new Response('no tokens', { status: 200 });
    }

    const sa = JSON.parse(atob(Deno.env.get('FCM_SA_B64')!));
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
            notification: { title: 'SmartNote', body: `„${title}" wurde aktualisiert.` },
            data: { noteId },
            android: { priority: 'HIGH', notification: { sound: 'default' } }
          }
        })
      });
      if (r.ok) {
        sent++;
      } else {
        const errTxt = await r.text();
        console.log('notify: FCM-Fehler ' + r.status + ': ' + errTxt.slice(0, 300));
      }
    }
    console.log('notify: FERTIG sent=' + sent + ' von ' + tokens.length);
    return new Response(JSON.stringify({ sent, total: tokens.length }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.log('notify: EXCEPTION ' + ((e as any)?.message || e));
    return new Response('error: ' + ((e as any)?.message || e), { status: 500 });
  }
});
