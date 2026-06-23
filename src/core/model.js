/*
 * NZ – Plattformunabhängiger Kern der NotizApp.
 * Läuft in Electron (Desktop), im Browser (Web/PWA) und später im Handy-Wrapper.
 * KEIN DOM, KEIN Electron, KEIN Netzwerk hier drin – nur reine Logik & Daten.
 */
(function (global) {
  const STATUS_ORDER = ['todo', 'doing', 'done'];

  const STATUS_LABELS = {
    todo: 'Noch nicht angefangen',
    doing: 'In Bearbeitung',
    done: 'Geschafft'
  };

  function statusLabel(s) {
    return STATUS_LABELS[s] || s;
  }

  function nextStatus(s) {
    return STATUS_ORDER[(STATUS_ORDER.indexOf(s || 'todo') + 1) % STATUS_ORDER.length];
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // Status einer Notiz aus ihren Teilaufgaben ableiten (falls vorhanden).
  function deriveStatus(note) {
    const subs = (note && note.subtasks) || [];
    if (!subs.length) return (note && note.status) || 'todo';
    const states = subs.map((s) => s.status || 'todo');
    if (states.every((s) => s === 'done')) return 'done';
    if (states.every((s) => s === 'todo')) return 'todo';
    return 'doing';
  }

  // Hat eine Notiz Teilaufgaben, wird ihr Status automatisch gesetzt.
  function applyAutoStatus(note) {
    if (!note) return;
    if ((note.subtasks || []).length) note.status = deriveStatus(note);
  }

  function makeNote(partial) {
    const now = Date.now();
    return Object.assign(
      {
        id: uid(),
        title: '',
        body: '',
        folder: '',
        tags: [],
        status: 'todo',
        subtasks: [],
        share: null, // { code, createdBy, members: [] } – wird in Phase 3 genutzt
        createdAt: now,
        updatedAt: now
      },
      partial || {}
    );
  }

  function makeSubtask(text, by) {
    return { id: uid(), text: text || '', status: 'todo', updatedBy: by || null, updatedAt: Date.now(), photo: null };
  }

  // ---- Feste Farbe pro Person für EINE geteilte Notiz ----
  // Beim Teilen/Beitreten bekommt jedes Gerät genau eine Farbe aus der Palette,
  // gespeichert in note.share.colors = { deviceId: farbe }. So sind Farben stabil
  // und kollidieren innerhalb einer Notiz nicht.
  const SHARE_PALETTE = ['#7c6cff', '#3ad17a', '#ff9f43', '#ff5c72', '#21b8c7', '#e056fd', '#ffd93b', '#4f8cff'];

  function noteColorFor(note, deviceId) {
    return (note && note.share && note.share.colors && note.share.colors[deviceId]) || null;
  }

  function claimNoteColor(note, deviceId) {
    if (!note || !note.share || !deviceId) return null;
    if (!note.share.colors) note.share.colors = {};
    const colors = note.share.colors;
    if (colors[deviceId]) return colors[deviceId];
    const taken = new Set(Object.values(colors));
    // Startversatz aus der Geräte-ID → zwei gleichzeitige Beitritte greifen seltener dieselbe Farbe.
    let off = 0;
    for (let i = 0; i < deviceId.length; i++) off = (off + deviceId.charCodeAt(i)) % SHARE_PALETTE.length;
    let chosen = null;
    for (let k = 0; k < SHARE_PALETTE.length; k++) {
      const c = SHARE_PALETTE[(off + k) % SHARE_PALETTE.length];
      if (!taken.has(c)) {
        chosen = c;
        break;
      }
    }
    if (!chosen) chosen = SHARE_PALETTE[off % SHARE_PALETTE.length]; // mehr Leute als Farben → wiederverwenden
    colors[deviceId] = chosen;
    return chosen;
  }

  // Einprägsamer Teilen-Code, z.B. "OTTER-734".
  const CODE_WORDS = ['OTTER', 'FUCHS', 'EULE', 'LUCHS', 'DACHS', 'IGEL', 'FALKE', 'REH', 'MILCH', 'APFEL', 'BIRNE', 'MOHN'];
  function makeShareCode() {
    const w = CODE_WORDS[Math.floor(Math.random() * CODE_WORDS.length)];
    const n = String(Math.floor(100 + Math.random() * 900));
    return w + '-' + n;
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function stripMd(s) {
    return (s || '').replace(/[#*`_>-]/g, '').replace(/\n/g, ' ').trim();
  }

  // ---- Autoren-Spur fürs Textfeld (wer hat welche Zeile geschrieben) ----
  // bodyLines = [{ text, by, color, name }]. by/color/name = null bei unbekanntem Autor.

  function linesToText(lines) {
    return (lines || []).map((l) => l.text).join('\n');
  }

  // Aus reinem Text (z.B. Altbestand) eine Zeilen-Liste ohne Autor machen.
  function textToLines(text) {
    return String(text == null ? '' : text)
      .split('\n')
      .map((t) => ({ text: t, by: null, color: null, name: null }));
  }

  // Neuen Text gegen die bisherigen Zeilen abgleichen: unveränderte Zeilen behalten
  // ihren Autor (per Zeilen-LCS), neue/geänderte Zeilen bekommen den aktuellen Autor.
  function attributeBody(prevLines, newText, author) {
    const newTexts = String(newText == null ? '' : newText).split('\n');
    const prev = prevLines || [];
    const prevTexts = prev.map((l) => l.text);
    const n = prevTexts.length;
    const m = newTexts.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] =
          prevTexts[i] === newTexts[j]
            ? dp[i + 1][j + 1] + 1
            : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const kept = new Array(m).fill(null);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (prevTexts[i] === newTexts[j]) {
        kept[j] = prev[i];
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        i++;
      } else {
        j++;
      }
    }
    const a = author || {};
    return newTexts.map((text, idx) => {
      const k = kept[idx];
      if (k) return { text, by: k.by, color: k.color, name: k.name };
      return { text, by: a.id || null, color: a.color || null, name: a.nickname || null };
    });
  }

  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
  }

  global.NZ = {
    STATUS_ORDER,
    statusLabel,
    nextStatus,
    uid,
    deriveStatus,
    applyAutoStatus,
    makeNote,
    makeSubtask,
    makeShareCode,
    escapeHtml,
    stripMd,
    formatDate,
    linesToText,
    textToLines,
    attributeBody,
    SHARE_PALETTE,
    noteColorFor,
    claimNoteColor
  };
})(typeof window !== 'undefined' ? window : globalThis);
