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
    return { id: uid(), text: text || '', status: 'todo', updatedBy: by || null, updatedAt: Date.now() };
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
    formatDate
  };
})(typeof window !== 'undefined' ? window : globalThis);
