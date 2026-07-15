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

// Einzelnen Push senden – gibt Status + kompletten Antworttext zurück (fürs Debuggen).
async function sendPush(accessToken: string, projectId: string, token: string, bodyText: string, noteId: string) {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: 'SmartNote', body: bodyText },
        data: { noteId },
        android: { priority: 'HIGH', notification: { sound: 'default' } },
        apns: { payload: { aps: { sound: 'default' } } }
      }
    })
  });
  const text = r.ok ? '' : await r.text();
  return { ok: r.ok, status: r.status, text };
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();

    // ---- Wartung: {mode:'list-tokens'} → Übersicht (Token nur als Präfix) ----
    if (payload && payload.mode === 'list-tokens') {
      const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: rows } = await supa.from('push_tokens').select('device, token, platform, updated_at').order('updated_at', { ascending: false });
      const out = (rows || []).map((r: any) => ({ device: r.device, platform: r.platform, tokenPrefix: String(r.token).slice(0, 12), updated_at: r.updated_at }));
      return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
    }

    // ---- Wartung: {mode:'move-token', from, to} → Token-Zeile auf andere Geräte-ID umziehen ----
    if (payload && payload.mode === 'move-token') {
      const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: rows } = await supa.from('push_tokens').select('device, token, platform').eq('device', payload.from);
      const row = rows && rows[0];
      if (!row) return new Response(JSON.stringify({ error: 'Quelle nicht gefunden' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      await supa.from('push_tokens').upsert({ device: payload.to, token: row.token, platform: row.platform });
      await supa.from('push_tokens').delete().eq('device', payload.from);
      console.log('notify: move-token ' + payload.from + ' → ' + payload.to);
      return new Response(JSON.stringify({ moved: payload.to }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ---- Wartung: {mode:'cleanup-tokens'} → gleicher Token unter mehreren Geräte-IDs? Nur den neuesten behalten. ----
    if (payload && payload.mode === 'cleanup-tokens') {
      const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: rows } = await supa.from('push_tokens').select('device, token, updated_at');
      const byToken = new Map<string, any[]>();
      for (const r of rows || []) {
        const list = byToken.get(r.token) || [];
        list.push(r);
        byToken.set(r.token, list);
      }
      const removed: string[] = [];
      for (const [, list] of byToken) {
        if (list.length < 2) continue;
        list.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
        for (const dead of list.slice(1)) {
          await supa.from('push_tokens').delete().eq('device', dead.device);
          removed.push(dead.device);
        }
      }
      console.log('notify: cleanup-tokens entfernt=' + JSON.stringify(removed));
      return new Response(JSON.stringify({ removed }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ---- Debug/Test-Modus: {mode:'push-test', device:'<uuid>'} → Push direkt an dieses Gerät ----
    if (payload && payload.mode === 'push-test') {
      const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: toks } = await supa.from('push_tokens').select('device, token, platform').eq('device', payload.device);
      const row = toks && toks[0];
      if (!row) return new Response(JSON.stringify({ error: 'kein Token für device ' + payload.device }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      const sa = JSON.parse(atob(Deno.env.get('FCM_SA_B64')!));
      const accessToken = await getAccessToken(sa);
      const res = await sendPush(accessToken, sa.project_id, row.token, payload.text || 'Testnachricht 👋', 'test');
      console.log('notify: PUSH-TEST device=' + payload.device + ' platform=' + row.platform +
        ' tokenPrefix=' + String(row.token).slice(0, 12) + ' saProject=' + sa.project_id +
        ' saMail=' + sa.client_email + ' → status=' + res.status + ' ' + res.text.slice(0, 900));
      return new Response(JSON.stringify({ platform: row.platform, tokenPrefix: String(row.token).slice(0, 12), saProject: sa.project_id, saMail: sa.client_email, status: res.status, ok: res.ok, error: res.text }), { headers: { 'Content-Type': 'application/json' } });
    }
    const note = payload.record || payload.new || {};
    const noteId: string = note.id;
    const actor: string | null = note.last_actor || null;
    const title: string = (note.data && note.data.title) || 'Geteilte Notiz';
    // Name des Verursachers + ob eine Teilaufgabe hinzugefuegt wurde (fuer eine schoene Nachricht)
    const oldNote = payload.old_record || payload.old || {};
    const subs: any[] = (note.data && note.data.subtasks) || [];
    const oldSubs: any[] = (oldNote.data && oldNote.data.subtasks) || [];
    const actorCand = subs
      .filter((s) => s && s.updatedBy && s.updatedBy.id === actor)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    // Bevorzugt den vom Client mitgeschriebenen Namen (data.lastActorName, ab v1.7.0).
    const who: string =
      (note.data && note.data.lastActorName) ||
      (actorCand[0] && actorCand[0].updatedBy && actorCand[0].updatedBy.nickname) ||
      'Jemand';
    const addedSubtask = subs.length > oldSubs.length;
    // "Wer ist dabei?": Zusage/Absage erkannt → schönere Nachricht.
    let rsvpMsg: string | null = null;
    const newR = (note.data && note.data.rsvp) || {};
    const oldR = (oldNote.data && oldNote.data.rsvp) || {};
    for (const k of Object.keys(newR)) {
      const nv = newR[k];
      const ov = oldR[k];
      if (nv && (!ov || ov.v !== nv.v)) {
        rsvpMsg = (nv.name || who) + (nv.v === 'yes' ? ` ist dabei! ✅ – „${title}"` : ` hat abgesagt ❌ – „${title}"`);
      }
    }
    const bodyText = rsvpMsg
      ? rsvpMsg
      : addedSubtask
        ? `${who} hat eine Teilaufgabe zu „${title}" hinzugefügt.`
        : `${who} hat „${title}" aktualisiert.`;
    console.log('notify: noteId=' + noteId + ' share_code=' + (note.share_code || '-') + ' actor=' + (actor || '-') + ' who=' + who + ' added=' + addedSubtask);
    // Nur geteilte Notizen sind relevant (sonst gibt es ohnehin keine Mitglieder).
    if (!noteId || !note.share_code) {
      console.log('notify: skip (nicht geteilt)');
      return new Response('skip', { status: 200 });
    }

    // Die App schreibt beim Sync ALLE Notizen (auch unveränderte) → der Webhook feuert
    // dann für jede geteilte Notiz. Push nur, wenn sich der INHALT wirklich geändert hat.
    // lastActorName zählt dabei NICHT als Inhalt (wechselt bei jedem Sync-Teilnehmer).
    const norm = (d: any) => {
      if (!d) return '';
      const c = { ...d };
      delete c.lastActorName;
      return JSON.stringify(c);
    };
    if (oldNote && oldNote.data && norm(note.data) === norm(oldNote.data)) {
      console.log('notify: skip (Inhalt unverändert)');
      return new Response('skip unchanged', { status: 200 });
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
    console.log('notify: sende via saProject=' + sa.project_id + ' saMail=' + sa.client_email + ' tokenLen=' + accessToken.length);

    let sent = 0;
    for (const token of tokens) {
      const res = await sendPush(accessToken, sa.project_id, token, bodyText, noteId);
      if (res.ok) {
        sent++;
      } else {
        console.log('notify: FCM-Fehler ' + res.status + ' tokenPrefix=' + String(token).slice(0, 12) + ': ' + res.text.slice(0, 900));
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
