// ---- State ----
let data = { notes: [], folders: [] };
let activeNoteId = null;
let currentFolder = '__all__';
let currentStatus = 'all';
let searchTerm = '';
let saveTimer = null;

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const noteListEl = $('noteList');
const folderListEl = $('folderList');
const editorEl = $('editor');
const editorEmptyEl = $('editorEmpty');
const titleInput = $('titleInput');
const folderSelect = $('folderSelect');

// ---- Core aliases (plattformunabhängig, siehe src/core/) ----
const { uid, deriveStatus, applyAutoStatus, escapeHtml, stripMd, formatDate } = NZ;
const STATUS_ORDER = NZ.STATUS_ORDER;

// ---- i18n (Deutsch / Englisch) ----
const t = (key, vars) => (window.NZI18N ? NZI18N.t(key, vars) : key);
function statusLabel(s) {
  return t({ todo: 'statusTodo', doing: 'statusDoing', done: 'statusDone' }[s] || 'statusTodo');
}

// ---- In-App-Hinweise (Toast) ----
function showToast(msg, color) {
  const host = $('toastHost');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast';
  const c = color || 'var(--accent)';
  el.innerHTML = `<span class="toast-dot" style="background:${c}"></span><span>${escapeHtml(msg)}</span>`;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 3600);
}

// Wer hat die Notiz zuletzt geändert? Aus den Daten abgeleitet (nicht ich selbst).
function actorOfNote(note) {
  if (!note) return null;
  const myId = NZDevice.getId();
  let best = null;
  let bestT = -1;
  (note.subtasks || []).forEach((s) => {
    const u = s.updatedBy;
    if (u && u.id && u.id !== myId && (s.updatedAt || 0) >= bestT) {
      bestT = s.updatedAt || 0;
      best = u;
    }
  });
  return best;
}

// Hinweis anzeigen, wenn jemand anderes eine GETEILTE Notiz ändert (mit Throttle).
const toastLast = {};
function notifyShared(info) {
  if (!info || !info.id || info.event === 'DELETE') return;
  const note = data.notes.find((n) => n.id === info.id);
  if (!note || !(note.share && note.share.code)) return; // nur geteilte Notizen
  const now = Date.now();
  if (toastLast[info.id] && now - toastLast[info.id] < 4000) return;
  toastLast[info.id] = now;
  const actor = actorOfNote(note);
  const title = (info.title || '').trim() || t('untitled');
  if (actor) showToast(t('toastUpdatedBy', { who: actor.nickname || t('someone'), title }), actor.color);
  else showToast(t('toastUpdated', { title }));
}

// ---- Init ----
(async function init() {
  data = await NZStore.load();
  // Altlasten: früher erzeugte leere Notizen einmalig wegräumen.
  const beforeSweep = data.notes.length;
  data.notes = data.notes.filter((n) => !isEmptyNote(n));
  if (data.notes.length !== beforeSweep) persist();
  const ver = (window.NZ_CONFIG && NZ_CONFIG.VERSION) || '';
  if (ver) $('appVersion').textContent = 'v' + ver;
  applyLanguage(); // setzt statische Texte + Toggle-Label
  const theme = localStorage.getItem('theme') || 'dark';
  applyTheme(theme);
  renderAll();
  scheduleReminderRefresh(); // geplante Termin-Erinnerungen an den aktuellen Stand angleichen

  // "Termin vorbei – erledigt?"-Buttons: Antwort verarbeiten (kommt auch aus dem Hintergrund).
  if (window.NZNative && NZNative.initTermActions) {
    NZNative.initTermActions(
      { done: t('actionDone'), keep: t('actionKeep') },
      (actionId, noteId) => {
        if (!noteId) return;
        const note = data.notes.find((n) => n.id === noteId);
        if (!note) return;
        if (actionId === 'done') {
          note.termDone = true; // ab nach "Vergangen" – ganz ohne App-Besuch
          note.updatedAt = Date.now();
          persist();
          renderAll();
        } else if (actionId === 'tap') {
          // Auf die Nachricht selbst getippt → App öffnet den Termine-Tab
          document.body.classList.remove('search-open', 'settings-open');
          closeEditor(); // Editor-Spalte (Tablet) nicht mit alter Notiz stehen lassen
          renderTermine();
          document.body.classList.add('termine-open');
          setActiveTab('termine');
        }
      }
    );
  }
})();

// ---- Sprache anwenden / umschalten ----
function applyLanguage() {
  if (!window.NZI18N) return;
  NZI18N.apply();
  const lt = $('langToggle');
  if (lt) lt.textContent = NZI18N.lang === 'de' ? '🌐 EN' : '🌐 DE';
}
function toggleLanguage() {
  if (!window.NZI18N) return;
  NZI18N.set(NZI18N.lang === 'de' ? 'en' : 'de');
  applyLanguage();
  // dynamische UI neu aufbauen
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  $('themeToggle').textContent = theme === 'dark' ? t('themeDark') : t('themeLight');
  renderAll();
  updateAccountUI();
  const note = currentNote();
  if (note) {
    renderStatusRow(note.status || 'todo');
    renderSubtasks();
    updateSharedBadge(note);
  }
}

// Live-sync when another window/tab/device changes notes
NZStore.onChanged(async (info) => {
  data = await NZStore.load();
  renderAll();

  // Offene Notiz wurde gelöscht?
  if (activeNoteId && !data.notes.find((n) => n.id === activeNoteId)) {
    closeEditor();
    return;
  }

  // Offene Notiz wurde von jemandem geändert → Teilaufgaben live nachziehen
  // (ohne Titel/Text zu überschreiben, falls gerade getippt wird).
  if (info && info.id && info.id === activeNoteId) {
    const editing = document.activeElement && document.activeElement.classList.contains('sub-text');
    if (!editing) {
      renderSubtasks();
      updateSharedBadge(currentNote());
    }
  }

  // In-App-Hinweis: jemand arbeitet an einer geteilten Notiz.
  notifyShared(info);

  // Zusätzlich System-Benachrichtigung, wenn das Fenster nicht im Fokus ist.
  if (info && info.id && !document.hasFocus()) {
    notifyChange(info.title);
  }
});

// Eingehender Web-Link  …/?join=CODE  → automatisch beitreten (z.B. nach QR-Scan)
(function handleJoinParam() {
  try {
    const j = new URLSearchParams(location.search).get('join');
    if (!j) return;
    history.replaceState(null, '', location.pathname); // URL säubern (kein erneutes Beitreten bei Reload)
    NZStore.ready.then(() => {
      showJoinModal(true); // zuerst öffnen (leert das Feld) …
      $('joinInput').value = j; // … dann Code setzen
      doJoin();
    });
  } catch {}
})();

function persist() {
  NZStore.save(data);
  scheduleReminderRefresh(); // Termin-Erinnerungen an den neuen Stand anpassen
}

// ---- Termin-Erinnerungen (lokale Benachrichtigungen, ganz aufs Gerät geplant) ----
const REM_LEADS = [
  { min: 0, key: 'leadAtTime' },
  { min: 30, key: 'lead30' },
  { min: 60, key: 'lead60' },
  { min: 180, key: 'lead180' },
  { min: 1440, key: 'lead1d' },
  { min: 2880, key: 'lead2d' },
  { min: 10080, key: 'lead7d' }
];

function remOn() {
  return localStorage.getItem('nz_rem_on') !== '0'; // Standard: an
}
function remLeads() {
  try {
    const a = JSON.parse(localStorage.getItem('nz_rem_leads') || '[60,1440]');
    return Array.isArray(a) && a.length ? a : [60, 1440];
  } catch {
    return [60, 1440];
  }
}

// Stabile Ganzzahl-ID pro Notiz+Vorlauf (LocalNotifications braucht int-IDs).
function remId(noteId, lead) {
  const s = noteId + ':' + lead;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2147483647;
}

let remTimer = null;
function scheduleReminderRefresh() {
  clearTimeout(remTimer);
  remTimer = setTimeout(rescheduleReminders, 800);
}

async function rescheduleReminders() {
  if (!(window.NZNative && NZNative.remindersAvailable && NZNative.remindersAvailable())) return;
  // Kein Früh-Aus bei "global aus": Notizen mit EIGENEN Zeiten erinnern trotzdem (haben Prio).
  const now = Date.now();
  const items = [];
  (data.notes || []).forEach((n) => {
    const d = whenDate(n);
    if (!d || n.termDone) return;
    // Individuelle Zeiten der Notiz haben Vorrang vor der globalen Einstellung.
    const custom = Array.isArray(n.remLeads) && n.remLeads.length ? n.remLeads : null;
    if (!custom && !remOn()) return;
    const leads = custom || remLeads();
    leads.forEach((lead) => {
      const at = d.getTime() - lead * 60000;
      if (at <= now) return;
      const leadOpt = REM_LEADS.find((o) => o.min === lead);
      items.push({
        id: remId(n.id, lead),
        title: '📅 ' + (n.title || t('untitled')),
        body: formatWhen(n.when) + (lead ? ' · ' + t(leadOpt ? leadOpt.key : 'lead60') : ''),
        at: new Date(at)
      });
    });
  });

  // ---- "Termin vorbei – erledigt?"-Nachfrage mit Aktions-Buttons ----
  // Kommt nach dem Termin (mit Uhrzeit: +90 Min., ohne: um 20 Uhr desselben Tags).
  // "✓ Erledigt" verschiebt den Termin nach Vergangen, ohne die App zu öffnen.
  if (remOn()) {
    (data.notes || []).forEach((n) => {
      const d = whenDate(n);
      if (!d || n.termDone) return;
      const askAt = new Date(d.getTime());
      if (String(n.when).includes('T')) askAt.setMinutes(askAt.getMinutes() + 90);
      else askAt.setHours(20, 0, 0, 0);
      if (askAt.getTime() <= now) return;
      items.push({
        id: remId(n.id, 999983),
        title: t('termOverTitle'),
        body: t('termOverBody', { title: n.title || t('untitled') }),
        at: askAt,
        actionTypeId: 'TERM_DONE',
        extra: { noteId: n.id }
      });
    });
  }

  // ---- Morgen-Briefing: die nächsten 7 Tage vorausplanen (wird bei jedem Sync aktualisiert) ----
  if (briefOn()) {
    const [bh, bm] = briefTime().split(':').map(Number);
    const openCount = (data.notes || []).reduce(
      (sum, n) => sum + (n.subtasks || []).filter((s) => !s.deleted && (s.status || 'todo') !== 'done').length,
      0
    );
    for (let day = 0; day < 7; day++) {
      const at = new Date();
      at.setDate(at.getDate() + day);
      at.setHours(bh, bm || 0, 0, 0);
      if (at.getTime() <= now) continue;
      const dayTermine = (data.notes || [])
        .filter((n) => {
          const d = whenDate(n);
          return d && !n.termDone && d.toDateString() === at.toDateString();
        })
        .sort((a, b) => whenDate(a) - whenDate(b));
      const parts = dayTermine.slice(0, 3).map((n) => {
        const d = whenDate(n);
        const hm = String(n.when).includes('T')
          ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
          : '';
        return (n.title || t('untitled')) + (hm ? ' ' + hm : '');
      });
      if (dayTermine.length > 3) parts.push('+' + (dayTermine.length - 3));
      if (!parts.length && !openCount) continue; // nichts zu berichten
      const body =
        (parts.length ? t('briefToday') + ': ' + parts.join(' · ') : t('briefNoTermine')) +
        (openCount ? ' · ' + t('briefOpen', { n: openCount }) : '');
      items.push({
        id: remId('briefing', day),
        title: t('briefTitle'),
        body,
        at
      });
    }
  }

  NZNative.replaceReminders(items);

  // Homescreen-Widget mit den nächsten Terminen versorgen
  if (NZNative.updateWidget) {
    const widgetList = (data.notes || [])
      .filter((n) => whenDate(n) && !n.termDone)
      .sort((a, b) => whenDate(a) - whenDate(b))
      .slice(0, 8)
      .map((n) => ({ id: n.id, title: n.title || t('untitled'), when: String(n.when) }));
    NZNative.updateWidget(widgetList);
  }
}

// ---- Morgen-Briefing: Einstellungen ----
function briefOn() {
  return localStorage.getItem('nz_brief_on') !== '0'; // Standard: an
}
function briefTime() {
  return localStorage.getItem('nz_brief_time') || '08:00';
}
function briefSummary() {
  return briefOn() ? briefTime() : t('off');
}

// ---- Filtering ----
function filteredNotes() {
  let list = [...data.notes];
  if (currentFolder !== '__all__') {
    list = list.filter((n) => (n.folder || '') === currentFolder);
  }
  if (currentStatus !== 'all') {
    list = list.filter((n) => (n.status || 'todo') === currentStatus);
  }
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    list = list.filter(
      (n) =>
        (n.title || '').toLowerCase().includes(q) ||
        (n.body || '').toLowerCase().includes(q)
    );
  }
  return list.sort(
    (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0)
  );
}

// ---- Rendering ----
function renderAll() {
  renderFolders();
  renderFolderSelect();
  renderNoteList();
}

function renderFolders() {
  folderListEl.innerHTML = '';
  const items = [{ key: '__all__', label: t('allNotes'), icon: '✦' }];
  data.folders.forEach((f) => items.push({ key: f, label: f, icon: '📁' }));

  items.forEach((it) => {
    const li = document.createElement('li');
    li.className = 'folder-item' + (currentFolder === it.key ? ' active' : '');
    const count =
      it.key === '__all__'
        ? data.notes.length
        : data.notes.filter((n) => (n.folder || '') === it.key).length;
    li.innerHTML = `<span class="ficon">${it.icon}</span><span>${escapeHtml(it.label)}</span><span class="fcount">${count}</span>`;
    li.onclick = () => {
      currentFolder = it.key;
      // Ordner-Klick = Notizen-Ansicht (falls gerade Termine/Einstellungen/Suche offen sind)
      document.body.classList.remove('termine-open', 'settings-open', 'search-open');
      setActiveTab('notes');
      renderAll();
    };
    if (it.key !== '__all__') {
      li.ondblclick = () => deleteFolder(it.key);
      li.title = t('dblClickDelete');
    }
    folderListEl.appendChild(li);
  });
}

function renderFolderSelect() {
  folderSelect.innerHTML = '<option value="">' + t('noFolder') + '</option>';
  data.folders.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    folderSelect.appendChild(opt);
  });
}

// ---- Agenda: Notizen mit Termin als eigene, chronologische Sektion ----
function whenDate(n) {
  if (!n.when) return null;
  const hasTime = String(n.when).includes('T');
  const d = new Date(hasTime ? n.when : n.when + 'T12:00');
  return isNaN(d.getTime()) ? null : d;
}

function agendaBucket(d) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((day - today) / 86400000);
  if (diff < 0) return 'past';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff < 7) return 'week';
  return 'later';
}

function agendaRow(n, d, askDone) {
  const loc = (window.NZI18N && NZI18N.lang === 'en') ? 'en-US' : 'de-DE';
  const wd = d.toLocaleDateString(loc, { weekday: 'short' }).replace('.', '');
  const hasTime = String(n.when).includes('T');
  const time = hasTime ? d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) : '';
  const snippet = stripMd(n.body || '');
  const sub = [time, snippet].filter(Boolean).join(' · ');
  const li = document.createElement('li');
  li.className = 'agenda-item' + (askDone ? ' agenda-ask' : '');
  li.innerHTML = `
    <div class="agenda-tile"><span class="ag-wd">${escapeHtml(wd)}</span><span class="ag-day">${d.getDate()}</span></div>
    <div class="agenda-main">
      <div class="agenda-title">${escapeHtml(n.title) || t('untitled')}</div>
      ${sub ? `<div class="agenda-sub">${escapeHtml(sub)}</div>` : ''}
    </div>
    ${RSVP_ENABLED && n.share && n.share.code && n.rsvp && Object.keys(n.rsvp).length ? `<span class="agenda-rsvp">✓${Object.values(n.rsvp).filter((r) => r.v === 'yes').length}</span>` : ''}
    ${n.share && n.share.code ? '<span class="agenda-share">🔗</span>' : ''}
    ${askDone ? `<button class="agenda-done-btn" title="${t('markDone')}">✓</button>` : ''}`;
  li.onclick = () => openNote(n.id);
  if (askDone) {
    li.querySelector('.agenda-done-btn').onclick = (e) => {
      e.stopPropagation();
      n.termDone = true; // bestätigt → wandert nach "Vergangen"
      n.updatedAt = Date.now();
      persist();
      renderTermine();
    };
  }
  return li;
}

function renderAgenda(dated, withHead) {
  if (!dated.length) return null;
  const wrap = document.createElement('li');
  wrap.className = 'agenda-wrap';
  const buckets = { today: [], tomorrow: [], week: [], later: [], past: [] };
  dated.forEach((n) => buckets[agendaBucket(whenDate(n))].push(n));
  const byWhen = (a, b) => whenDate(a) - whenDate(b);
  const section = document.createElement('div');
  section.className = 'agenda';
  if (withHead) section.innerHTML = `<div class="agenda-head">📅 <span>${t('agendaTitle')}</span></div>`;
  [['today', 'agendaToday'], ['tomorrow', 'agendaTomorrow'], ['week', 'agendaWeek'], ['later', 'agendaLater']].forEach(([key, label]) => {
    const arr = buckets[key].sort(byWhen);
    if (!arr.length) return;
    const g = document.createElement('div');
    g.className = 'agenda-group agenda-' + key;
    g.innerHTML = `<div class="agenda-label">${t(label)}</div>`;
    const ul = document.createElement('ul');
    arr.forEach((n) => ul.appendChild(agendaRow(n, whenDate(n))));
    g.appendChild(ul);
    section.appendChild(g);
  });
  // Vorbei, aber noch nicht bestätigt → erst fragen "erledigt?", dann ab nach Vergangen.
  const pastAll = buckets.past.sort((a, b) => whenDate(b) - whenDate(a));
  const pastOpen = pastAll.filter((n) => !n.termDone);
  const past = pastAll.filter((n) => n.termDone);
  if (pastOpen.length) {
    const g = document.createElement('div');
    g.className = 'agenda-group agenda-askdone';
    g.innerHTML = `<div class="agenda-label">${t('agendaDoneAsk')}</div>`;
    const ul = document.createElement('ul');
    pastOpen.forEach((n) => ul.appendChild(agendaRow(n, whenDate(n), true)));
    g.appendChild(ul);
    section.appendChild(g);
  }
  if (past.length) {
    const det = document.createElement('details');
    det.className = 'agenda-past';
    det.innerHTML = `<summary>${t('agendaPast')} (${past.length})</summary>`;
    const ul = document.createElement('ul');
    past.forEach((n) => ul.appendChild(agendaRow(n, whenDate(n))));
    det.appendChild(ul);
    section.appendChild(det);
  }
  wrap.appendChild(section);
  return wrap;
}

// Neuen Termin manuell anlegen: Notiz mit vorbelegtem Datum (nächste volle Stunde),
// Editor öffnet über dem Termine-Screen – Titel eintippen, Datum ggf. anpassen, fertig.
function newTermin() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  const p = (x) => String(x).padStart(2, '0');
  const when = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':00';
  const note = NZ.makeNote({ title: '', body: '' });
  note.when = when;
  data.notes.unshift(note);
  persist();
  renderAll();
  openNote(note.id);
  titleInput.focus();
}

// Termine-Tab: alle Notizen mit Termin (ordnerübergreifend), gruppiert wie die Agenda.
function renderTermine() {
  const listEl = $('termineList');
  if (!listEl) return;
  listEl.innerHTML = '';
  const dated = (data.notes || []).filter((n) => whenDate(n));
  $('termineEmpty').classList.toggle('hidden', dated.length > 0);
  const agenda = renderAgenda(dated, false);
  if (agenda) listEl.appendChild(agenda);
}

function renderNoteList() {
  const all = filteredNotes();
  $('listTitle').textContent = currentFolder === '__all__' ? t('allNotes') : currentFolder;

  noteListEl.innerHTML = '';

  // Termin-Notizen leben im eigenen "Termine"-Tab – hier nur die normalen Karten.
  const list = all.filter((n) => !whenDate(n));
  $('emptyList').classList.toggle('hidden', list.length > 0);
  $('noteCount').textContent = list.length;
  renderTermine(); // Termine-Tab immer aktuell halten

  list.forEach((n) => {
    const status = deriveStatus(n);
    const hasSubs = (n.subtasks || []).length > 0;
    const li = document.createElement('li');
    li.className = 'note-card status-' + status + (n.pinned ? ' pinned' : '') + (n.id === activeNoteId ? ' active' : '');
    const subs = (n.subtasks || []).filter((s) => !s.deleted); // gelöschte zählen nicht
    const subDone = subs.filter((s) => (s.status || 'todo') === 'done').length;
    const pct = subs.length ? Math.round((subDone / subs.length) * 100) : 0;
    const shareHtml = n.share && n.share.code ? '<span class="card-share">🔗</span>' : '';
    const snippet = escapeHtml(stripMd(n.body || ''));
    const catLabel = n.folder ? escapeHtml(n.folder) : statusLabel(status);
    const whenHtml = n.when ? `<div class="card-when">📅 ${escapeHtml(formatWhen(n.when))}</div>` : '';
    const bodyHtml = subs.length
      ? `<div class="card-progress">
           <div class="prog-row">
             <span class="prog-label">${t('subtasks')}</span>
             <span class="prog-count">${subDone}/${subs.length}</span>
           </div>
           <div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div>
         </div>`
      : `${whenHtml}<div class="snippet">${snippet || t('noContent')}</div>`;
    li.innerHTML = `
      <button class="card-pin" aria-label="${t(n.pinned ? 'unpin' : 'pin')}" title="${t(n.pinned ? 'unpin' : 'pin')}">📌</button>
      <button class="card-delete" aria-label="${t('delete')}" title="${t('delete')}">🗑</button>
      <div class="card-inner">
        <div class="card-top">
          <div class="card-cat">
            <span class="dot dot-${status}" title="${statusLabel(status)}${hasSubs ? ' ' + t('fromSubtasks') : ' ' + t('clickToCycle')}"></span>
            <span class="cat-label">${catLabel}</span>
            ${n.pinned ? '<span class="card-pinned">📌 ' + t('pinned') + '</span>' : ''}
          </div>
          ${shareHtml}
        </div>
        <h3>${escapeHtml(n.title) || t('untitled')}</h3>
        ${bodyHtml}
        <div class="card-meta"><span>${formatDate(n.updatedAt)}</span>${n.folder ? '<span class="card-tag">' + escapeHtml(n.folder) + '</span>' : ''}</div>
      </div>`;
    const inner = li.querySelector('.card-inner');
    inner.querySelector('.dot').onclick = (e) => {
      e.stopPropagation();
      if (li.classList.contains('swiped')) return closeSwipe(li);
      if (hasSubs) {
        openNote(n.id); // status is auto from subtasks → open to edit them
      } else {
        cycleStatus(n.id);
      }
    };
    li.querySelector('.card-delete').onclick = (e) => {
      e.stopPropagation();
      deleteNoteById(n.id);
    };
    li.querySelector('.card-pin').onclick = (e) => {
      e.stopPropagation();
      togglePin(n.id);
    };
    attachSwipe(li, inner, n.id);
    noteListEl.appendChild(li);
  });
}

// ---- Wisch-zum-Löschen auf den Notiz-Karten (Handy-typisch) ----
let openSwipedCard = null;

function closeSwipe(li) {
  if (li) li.classList.remove('swiped');
  if (openSwipedCard === li) openSwipedCard = null;
}
function closeAllSwipes() {
  if (openSwipedCard) closeSwipe(openSwipedCard);
}

function attachSwipe(li, inner, noteId) {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let decided = null; // 'h' | 'v'
  let active = false;
  let suppressClick = false;

  inner.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    active = true;
    decided = null;
    dx = 0;
    startX = e.clientX;
    startY = e.clientY;
  });

  inner.addEventListener('pointermove', (e) => {
    if (!active) return;
    const mx = e.clientX - startX;
    const my = e.clientY - startY;
    if (decided === null) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      decided = Math.abs(mx) > Math.abs(my) ? 'h' : 'v';
      if (decided === 'h') {
        if (openSwipedCard && openSwipedCard !== li) closeSwipe(openSwipedCard);
        li.classList.add('dragging');
        try { inner.setPointerCapture(e.pointerId); } catch {}
      }
    }
    if (decided !== 'h') return;
    suppressClick = true;
    const base = li.classList.contains('swiped') ? -144 : 0;
    dx = Math.max(-158, Math.min(0, base + mx));
    inner.style.transform = 'translateX(' + dx + 'px)';
    e.preventDefault();
  });

  const end = () => {
    if (!active) return;
    active = false;
    li.classList.remove('dragging');
    inner.style.transform = '';
    if (decided === 'h') {
      if (dx < -60) {
        li.classList.add('swiped');
        openSwipedCard = li;
      } else {
        closeSwipe(li);
      }
    }
  };
  inner.addEventListener('pointerup', end);
  inner.addEventListener('pointercancel', end);

  inner.addEventListener('click', (e) => {
    if (suppressClick) {
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (li.classList.contains('swiped')) return closeSwipe(li);
    openNote(noteId);
  });
}

// ---- Note actions ----
function newNote() {
  const note = {
    id: uid(),
    title: '',
    body: '',
    folder: currentFolder === '__all__' ? '' : currentFolder,
    tags: [],
    status: currentStatus !== 'all' ? currentStatus : 'todo',
    subtasks: [],
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  data.notes.unshift(note);
  persist();
  openNote(note.id);
  renderAll();
  titleInput.focus();
}

// Schnellstart-Vorlage vom leeren Startbildschirm: legt eine passende Notiz an
// (Einkauf wird angeheftet) und fragt dann, ob per Sprache oder Tippen gefüllt wird.
function startTemplate(kind) {
  const isShop = kind === 'shop';
  const note = {
    id: uid(),
    title: isShop ? t('tplShopTitle') : t('tplTodoTitle'),
    body: '',
    folder: currentFolder === '__all__' ? '' : currentFolder,
    tags: [],
    status: 'todo',
    subtasks: [],
    pinned: isShop,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  data.notes.unshift(note);
  persist();
  openNote(note.id);
  renderAll();
  showFillChoice(note.id);
}

// Auswahl-Blatt: Liste per Sprache oder selbst tippen füllen.
let fillChoiceNoteId = null;
function showFillChoice(noteId) {
  fillChoiceNoteId = noteId;
  const note = data.notes.find((n) => n.id === noteId);
  $('fillChoiceTitle').textContent = (note && note.title) || t('newList');
  $('fillChoiceVoice').classList.toggle('hidden', !aiAvailable()); // ohne KI keine Sprachfüllung
  $('fillChoicePhoto').classList.toggle('hidden', !(aiAvailable() && window.NZNative && NZNative.cameraAvailable && NZNative.cameraAvailable()));
  $('fillChoiceModal').classList.remove('hidden');
}
function closeFillChoice() {
  $('fillChoiceModal').classList.add('hidden');
  fillChoiceNoteId = null;
}
function fillChoiceVoice() {
  const id = fillChoiceNoteId;
  closeFillChoice();
  if (id) startVoice(id);
}
function fillChoiceType() {
  closeFillChoice();
  focusSubAdd();
}

// Foto → Liste: Foto aufnehmen, KI liest den Inhalt, Vorschau wie bei der Sprachnotiz.
async function fillChoicePhoto() {
  const id = fillChoiceNoteId;
  closeFillChoice();
  let dataUrl = null;
  try {
    dataUrl = await NZNative.takePhoto({
      header: t('fillPhoto'),
      camera: t('photoTake'),
      gallery: t('photoGallery'),
      cancel: t('cancel')
    });
  } catch (e) {
    return; // abgebrochen oder keine Kamera
  }
  if (!dataUrl) return;
  // Verarbeitung im Voice-Modal anzeigen (gleiche Bestätigungs-UI wie bei Sprache)
  voiceTargetId = id || null;
  voiceDraft = null;
  $('voiceError').classList.add('hidden');
  $('voiceRecording').classList.add('hidden');
  $('voiceConfirm').classList.add('hidden');
  $('voiceAnswer').classList.add('hidden');
  $('voiceProcessing').classList.remove('hidden');
  $('voiceModal').classList.remove('hidden');
  try {
    const res = await NZAI.photo(dataUrl, (window.NZI18N && NZI18N.lang) || 'de', new Date().toString());
    voiceDraft = {
      intent: res.intent === 'note' ? 'note' : 'list',
      title: res.title || '',
      items: res.items || [],
      body: res.body || '',
      when: res.when || '',
      answer: '',
      spoken: '',
      matchedIds: [],
      shareWith: '',
      summary: res.summary || ''
    };
    showVoiceConfirm(voiceDraft);
  } catch (e) {
    $('voiceProcessing').classList.add('hidden');
    showVoiceError(t('errGeneric') + (e.message || e));
  }
}

// Eingabefeld fokussieren, OHNE dass iOS den Bildschirm hochscrollt (Leiste unter die Statusleiste).
function focusSubAdd() {
  const inp = $('subAddInput');
  if (!inp) return;
  try {
    inp.focus({ preventScroll: true });
  } catch {
    inp.focus();
  }
}

// ---- Polling-Fallback für offene geteilte Notizen ----
// Realtime verwirft Events still, wenn die Notiz groß ist (z.B. Teilaufgaben-Fotos).
// Deshalb: solange eine geteilte Notiz offen ist, alle 6s frisch aus der Cloud holen.
let sharedPollTimer = null;

function stopSharedPoll() {
  if (sharedPollTimer) {
    clearInterval(sharedPollTimer);
    sharedPollTimer = null;
  }
}

function startSharedPoll(noteId) {
  stopSharedPoll();
  if (!(window.NZShare && NZShare.fetchNote)) return;
  sharedPollTimer = setInterval(async () => {
    const note = currentNote();
    if (!note || note.id !== noteId || !(note.share && note.share.code)) {
      stopSharedPoll();
      return;
    }
    // Nicht reinpfuschen, während hier gerade getippt wird.
    const ae = document.activeElement;
    if (ae && (ae.classList.contains('sub-text') || ae.id === 'titleInput' || ae.id === 'bodyInput')) return;
    try {
      const row = await NZShare.fetchNote(noteId);
      const remote = row && row.data;
      if (!remote || (remote.updatedAt || 0) <= (note.updatedAt || 0)) return;
      ['title', 'body', 'subtasks', 'when', 'termDone', 'rsvp', 'status', 'pinned', 'folder'].forEach((k) => {
        if (remote[k] !== undefined) note[k] = remote[k];
      });
      note.updatedAt = remote.updatedAt;
      if (document.activeElement !== titleInput) titleInput.value = note.title || '';
      renderSubtasks();
      updateSharedBadge(note);
      renderNoteList();
    } catch {}
  }, 6000);
}

function openNote(id) {
  const note = data.notes.find((n) => n.id === id);
  if (!note) return;
  closeAllSwipes();
  // Wechsel von einer leeren Notiz weg → die leere verwerfen.
  if (activeNoteId && activeNoteId !== id) discardIfEmpty(activeNoteId);
  activeNoteId = id;
  if (note.share && note.share.code) startSharedPoll(id);
  else stopSharedPoll();
  doneGroupOpen = false; // erledigte Teilaufgaben starten zugeklappt
  document.body.classList.add('editor-open'); // Handy: Editor-Ebene einblenden
  setNav(false);
  editorEmptyEl.classList.add('hidden');
  editorEl.classList.remove('hidden');
  titleInput.value = note.title || '';
  folderSelect.value = note.folder || '';
  renderStatusRow(note.status || 'todo');
  renderSubtasks();
  updateSharedBadge(note);
  updatePresence(note);
  updatePinBtn(note);
  renderNoteList();
}

function currentNote() {
  return data.notes.find((n) => n.id === activeNoteId);
}

function scheduleSave() {
  const note = currentNote();
  if (!note) return;
  note.title = titleInput.value;
  note.folder = folderSelect.value;
  if (!$('bodyInput').classList.contains('hidden')) note.body = $('bodyInput').value;
  note.updatedAt = Date.now();
  $('savedHint').textContent = t('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persist();
    $('savedHint').textContent = t('savedAutoCheck');
    renderFolders();
    renderNoteList();
  }, 400);
}

// Ist die Notiz komplett leer? (Dann soll sie gar nicht erst bestehen bleiben.)
function isEmptyNote(n) {
  if (!n) return false;
  if (n.share && n.share.code) return false; // geteilte Notizen nie automatisch löschen
  // Ein Datum allein zählt nicht als Inhalt – ein Termin ohne Titel/Text ist wertlos.
  return !(n.title || '').trim() && !(n.body || '').trim() && !(n.subtasks || []).length;
}

// Leere Notiz beim Verlassen verwerfen (Plus gedrückt, nichts eingegeben, zurück).
function discardIfEmpty(noteId) {
  const n = data.notes.find((x) => x.id === noteId);
  if (!n || !isEmptyNote(n)) return false;
  data.notes = data.notes.filter((x) => x.id !== noteId);
  if (activeNoteId === noteId) activeNoteId = null;
  persist();
  return true;
}

// Editor schließen und zurück zur Liste (wichtig fürs Handy: schließt das Overlay).
function closeEditor() {
  const wasActive = activeNoteId;
  activeNoteId = null;
  stopSharedPoll();
  leavePresence();
  editorEl.classList.add('hidden');
  editorEmptyEl.classList.remove('hidden');
  document.body.classList.remove('editor-open');
  if (wasActive && discardIfEmpty(wasActive)) renderAll();
}

// Geteilte Notizen brauchen Sonderbehandlung beim Löschen:
// - Besitzer: löscht für ALLE → klare Warnung.
// - Mitglied: nur die Teilung VERLASSEN (note_members-Eintrag entfernen), sonst
//   bringt der nächste Sync die Notiz als Zombie zurück.
function confirmSharedDelete(note) {
  const shared = !!(note.share && note.share.code);
  if (!shared) return true; // nicht geteilt → keine Extra-Warnung nötig
  const isOwner = note.ownedByMe !== false; // lokal erstellte Notizen gelten als eigene
  return confirm(t(isOwner ? 'deleteSharedOwnerConfirm' : 'deleteSharedMemberConfirm'));
}

function removeNoteEverywhere(note) {
  const shared = !!(note.share && note.share.code);
  const isOwner = note.ownedByMe !== false;
  if (shared && !isOwner && window.NZShare && NZShare.leaveNote) {
    NZShare.leaveNote(note.id).catch(() => {}); // Mitgliedschaft in der Cloud lösen
  }
  data.notes = data.notes.filter((n) => n.id !== note.id);
  persist();
}

function deleteNote() {
  const note = currentNote();
  if (!note) return;
  const shared = !!(note.share && note.share.code);
  if (shared ? !confirmSharedDelete(note) : !confirm(t('deleteNoteConfirm'))) return;
  removeNoteEverywhere(note);
  closeEditor();
  renderAll();
}

// Direkt aus der Liste löschen (per Wischen) – geteilte Notizen fragen nach.
function deleteNoteById(id) {
  const note = data.notes.find((n) => n.id === id);
  if (!note) return;
  if (!confirmSharedDelete(note)) {
    closeAllSwipes();
    return;
  }
  removeNoteEverywhere(note);
  if (openSwipedCard) openSwipedCard = null;
  if (activeNoteId === id) closeEditor();
  renderAll();
}

// Notiz anheften / lösen – angeheftete Notizen bleiben oben in der Liste.
function togglePin(id) {
  const note = data.notes.find((n) => n.id === id);
  if (!note) return;
  note.pinned = !note.pinned;
  closeAllSwipes();
  persist();
  renderNoteList();
  if (activeNoteId === id) updatePinBtn(note);
}

// Zustand des Anheft-Knopfes in der offenen Notiz aktualisieren.
function updatePinBtn(note) {
  const btn = $('pinBtn');
  if (!btn) return;
  const on = !!(note && note.pinned);
  btn.classList.toggle('active', on);
  btn.title = t(on ? 'unpin' : 'pin');
  btn.setAttribute('aria-label', t(on ? 'unpin' : 'pin'));
}

// ---- Status (Logik liegt im Kern: NZ.deriveStatus / NZ.applyAutoStatus) ----
function renderStatusRow(status) {
  const note = currentNote();
  const locked = note && (note.subtasks || []).length > 0;
  const shown = note ? deriveStatus(note) : status;
  document.querySelectorAll('.status-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.status === shown);
  });
  document.querySelector('.status-row').classList.toggle('locked', !!locked);
  $('statusAuto').classList.toggle('hidden', !locked);
}

function setStatus(id, status) {
  const note = data.notes.find((n) => n.id === id);
  if (!note) return;
  note.status = status;
  note.updatedAt = Date.now();
  persist();
  if (id === activeNoteId) renderStatusRow(status);
  renderNoteList();
}

function cycleStatus(id) {
  const note = data.notes.find((n) => n.id === id);
  if (!note) return;
  const next = STATUS_ORDER[(STATUS_ORDER.indexOf(note.status || 'todo') + 1) % STATUS_ORDER.length];
  setStatus(id, next);
}

// ---- Subtasks ----
let doneGroupOpen = false; // erledigte Teilaufgaben: Gruppe auf/zu
let deletedGroupOpen = false; // gelöschte Teilaufgaben: "Papierkorb"-Gruppe auf/zu

// Wischen nach links deckt einen roten Lösch-Knopf auf (wie bei Notizen) – löscht NICHT sofort.
let openSwipedSub = null;
function closeSubSwipe(li) {
  if (!li) return;
  li.classList.remove('swiped');
  if (openSwipedSub === li) openSwipedSub = null;
}
function attachSubSwipe(li, inner, stId) {
  let startX = 0, startY = 0, dx = 0, decided = null, active = false, suppressClick = false;
  inner.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    active = true; decided = null; dx = 0; startX = e.clientX; startY = e.clientY;
  });
  inner.addEventListener('pointermove', (e) => {
    if (!active) return;
    const mx = e.clientX - startX, my = e.clientY - startY;
    if (decided === null) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      decided = Math.abs(mx) > Math.abs(my) ? 'h' : 'v';
      if (decided === 'h') {
        if (openSwipedSub && openSwipedSub !== li) closeSubSwipe(openSwipedSub);
        li.classList.add('dragging');
        try { inner.setPointerCapture(e.pointerId); } catch {}
      }
    }
    if (decided !== 'h') return;
    suppressClick = true;
    const base = li.classList.contains('swiped') ? -72 : 0;
    dx = Math.max(-86, Math.min(0, base + mx));
    inner.style.transform = 'translateX(' + dx + 'px)';
    e.preventDefault();
  });
  const end = () => {
    if (!active) return;
    active = false;
    li.classList.remove('dragging');
    inner.style.transform = '';
    if (decided === 'h') {
      if (dx < -36) { li.classList.add('swiped'); openSwipedSub = li; }
      else closeSubSwipe(li);
    }
  };
  inner.addEventListener('pointerup', end);
  inner.addEventListener('pointercancel', end);
  // Tipp auf die geöffnete Zeile schließt den Swipe wieder (statt zu editieren).
  inner.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; return; }
    if (li.classList.contains('swiped')) { e.preventDefault(); e.stopPropagation(); closeSubSwipe(li); }
  }, true);
}

// Baut eine einzelne Teilaufgaben-Zeile (li) – für offene UND erledigte verwendet.
function buildSubItem(st, note, noteShared) {
  const status = st.status || 'todo';
  const isDeleted = !!st.deleted;
  const readOnly = isDeleted || status === 'done'; // erledigte + gelöschte sind nicht editierbar
  const li = document.createElement('li');
  li.className = 'sub-item' + (status === 'done' ? ' done' : '') + (isDeleted ? ' deleted' : '');
  const actions = isDeleted
    ? `<button class="sub-restore" title="${t('restore')}">↩</button>
       <button class="sub-del" title="${t('deleteForever')}">✕</button>`
    : `<button class="sub-photo" title="${t(st.photo ? 'photo' : 'addPhoto')}">📷</button>`;
  const swipeDel = isDeleted ? '' : `<button class="sub-swipe-del" title="${t('deleteSubtask')}">🗑</button>`;
  li.innerHTML = `
      ${swipeDel}
      <div class="sub-inner">
        <span class="dot dot-${status}" title="${statusLabel(status)} ${t('clickToCycle')}"></span>
        <input class="sub-text" type="text" value="" ${readOnly ? 'readonly' : ''} />
        ${st.photo ? `<img class="sub-thumb" src="${st.photo}" alt="" />` : ''}
        ${noteShared && !isDeleted ? whoBadge(note, st) : ''}
        ${actions}
      </div>`;
  const input = li.querySelector('.sub-text');
  input.value = st.text || '';
  const thumb = li.querySelector('.sub-thumb');
  if (thumb) thumb.onclick = () => openPhoto(st.id);
  if (isDeleted) {
    li.querySelector('.sub-restore').onclick = () => restoreSubtask(st.id);
    li.querySelector('.sub-del').onclick = () => purgeSubtask(st.id);
    return li;
  }
  // Punkt wechselt den Status (bei "erledigt" holt es die Aufgabe zurück zum Bearbeiten).
  li.querySelector('.dot').onclick = () => cycleSubtask(st.id);
  if (!readOnly) {
    input.oninput = () => {
      st.text = input.value;
      note.updatedAt = Date.now();
      scheduleSubSave();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        focusSubAdd();
      }
    };
    // Leere Teilaufgabe (nur Leerzeichen) beim Verlassen entfernen – leer ist nicht erlaubt.
    input.onblur = () => {
      if (!input.value.trim()) purgeSubtask(st.id);
    };
  }
  li.querySelector('.sub-photo').onclick = () => pickSubtaskPhoto(st.id);
  li.querySelector('.sub-swipe-del').onclick = () => deleteSubtask(st.id);
  attachSubSwipe(li, li.querySelector('.sub-inner'), st.id); // Wischen deckt roten Lösch-Knopf auf
  return li;
}

// Einfache Notiz (ohne Teilaufgaben): Textfeld + Termin-Zeile im Editor pflegen.
function updateSimpleNoteUI(note) {
  const bodyEl = $('bodyInput');
  const whenRow = $('whenRow');
  if (!note) {
    bodyEl.classList.add('hidden');
    whenRow.classList.add('hidden');
    return;
  }
  const liveSubs = (note.subtasks || []).filter((s) => !s.deleted);
  // Textfeld zeigen, wenn die Notiz Text hat ODER (noch) keine Teilaufgaben.
  const showBody = !!(note.body || liveSubs.length === 0);
  bodyEl.classList.toggle('hidden', !showBody);
  if (bodyEl.value !== (note.body || '')) bodyEl.value = note.body || '';
  // Datum-Zeile immer anbieten → jede Notiz kann manuell zum Termin werden.
  whenRow.classList.remove('hidden');
  const wi = $('whenInput');
  const val = note.when ? (String(note.when).includes('T') ? String(note.when).slice(0, 16) : note.when + 'T09:00') : '';
  if (wi.value !== val) wi.value = val;
  $('whenClear').classList.toggle('hidden', !note.when);
  // Erinnerungs-Zeile nur bei Terminen: eigene Zeiten oder Standard.
  const remRow = $('noteRemRow');
  if (remRow) {
    remRow.classList.toggle('hidden', !note.when);
    if (note.when) {
      const custom = Array.isArray(note.remLeads) && note.remLeads.length ? note.remLeads : null;
      $('noteRemVal').textContent = custom
        ? REM_LEADS.filter((o) => custom.includes(o.min)).map((o) => t(o.key + 'Short')).join(' · ')
        : t('remStandard') + ' (' + reminderSummary() + ')';
    }
  }
  renderRsvp(note);
}

// ---- "Wer ist dabei?" – Zusagen bei geteilten Terminen ----
// Vorerst deaktiviert (auf Wunsch) – auf true stellen, um es zu aktivieren.
const RSVP_ENABLED = false;

function renderRsvp(note) {
  const box = $('rsvpBox');
  if (!box) return;
  const show = RSVP_ENABLED && !!(note && note.when && note.share && note.share.code);
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const me = NZDevice.getId();
  const mine = note.rsvp && note.rsvp[me] ? note.rsvp[me].v : null;
  $('rsvpYes').classList.toggle('on', mine === 'yes');
  $('rsvpNo').classList.toggle('on', mine === 'no');
  const list = $('rsvpList');
  list.innerHTML = '';
  const entries = Object.values(note.rsvp || {}).sort((a, b) => (a.at || 0) - (b.at || 0));
  entries.forEach((r) => {
    const chip = document.createElement('span');
    chip.className = 'rsvp-chip ' + (r.v === 'yes' ? 'yes' : 'no');
    chip.textContent = (r.v === 'yes' ? '✓ ' : '✗ ') + (r.name || '?');
    list.appendChild(chip);
  });
}

function setRsvp(v) {
  const note = currentNote();
  if (!note) return;
  if (!note.rsvp) note.rsvp = {};
  const me = NZDevice.me();
  const cur = note.rsvp[me.id];
  if (cur && cur.v === v) delete note.rsvp[me.id]; // nochmal tippen = Antwort zurückziehen
  else note.rsvp[me.id] = { v, name: me.nickname, at: Date.now() };
  note.updatedAt = Date.now();
  persist();
  renderRsvp(note);
  renderTermine();
}

function renderSubtasks() {
  const note = currentNote();
  const listEl = $('subList');
  listEl.innerHTML = '';
  updateSimpleNoteUI(note);
  if (!note) return;
  if (!note.subtasks) note.subtasks = [];

  const noteShared = !!(note.share && note.share.code);
  const live = note.subtasks.filter((s) => !s.deleted); // nicht gelöschte
  const active = live.filter((s) => (s.status || 'todo') !== 'done');
  const done = live.filter((s) => (s.status || 'todo') === 'done');
  const deleted = note.subtasks.filter((s) => s.deleted);

  // Offene zuerst, in ihrer normalen Reihenfolge.
  active.forEach((st) => listEl.appendChild(buildSubItem(st, note, noteShared)));

  // Erledigte gebündelt in eine zusammenklappbare Gruppe.
  if (done.length) {
    const header = document.createElement('li');
    header.className = 'done-group' + (doneGroupOpen ? ' open' : '');
    header.innerHTML = `<span class="done-caret">▸</span><span class="done-label">${t('doneGroup', { n: done.length })}</span>`;
    header.onclick = () => {
      doneGroupOpen = !doneGroupOpen;
      renderSubtasks();
    };
    listEl.appendChild(header);
    if (doneGroupOpen) {
      done.forEach((st) => listEl.appendChild(buildSubItem(st, note, noteShared)));
    }
  }

  // Gelöschte ("Papierkorb") gebündelt ganz unten – wiederherstellbar.
  if (deleted.length) {
    const header = document.createElement('li');
    header.className = 'done-group deleted-group' + (deletedGroupOpen ? ' open' : '');
    header.innerHTML = `<span class="done-caret">▸</span><span class="done-label">${t('deletedGroup', { n: deleted.length })}</span>`;
    header.onclick = () => {
      deletedGroupOpen = !deletedGroupOpen;
      renderSubtasks();
    };
    listEl.appendChild(header);
    if (deletedGroupOpen) {
      deleted.forEach((st) => listEl.appendChild(buildSubItem(st, note, noteShared)));
    }
  }

  applyAutoStatus(note);
  updateSubProgress(note);
  renderStatusRow(note.status || 'todo');
  $('sortBtn').classList.toggle('hidden', !(aiAvailable() && note.subtasks.length >= 2));
}

function updateSubProgress(note) {
  const subs = (note.subtasks || []).filter((s) => !s.deleted);
  const done = subs.filter((s) => (s.status || 'todo') === 'done').length;
  $('subProgress').textContent = subs.length ? t('progressDone', { done, total: subs.length }) : '';
}

let subSaveTimer = null;
function scheduleSubSave() {
  clearTimeout(subSaveTimer);
  subSaveTimer = setTimeout(() => {
    persist();
    renderNoteList();
  }, 400);
}

function addSubtask(text) {
  const note = currentNote();
  if (!note) return;
  const t = text.trim();
  if (!t) return;
  if (!note.subtasks) note.subtasks = [];
  note.subtasks.push(NZ.makeSubtask(t, NZDevice.me()));
  note.updatedAt = Date.now();
  applyAutoStatus(note);
  persist();
  renderSubtasks();
  renderNoteList();
}

function cycleSubtask(stId) {
  const note = currentNote();
  if (!note) return;
  const st = note.subtasks.find((s) => s.id === stId);
  if (!st) return;
  st.status = STATUS_ORDER[(STATUS_ORDER.indexOf(st.status || 'todo') + 1) % STATUS_ORDER.length];
  st.updatedBy = NZDevice.me();
  st.updatedAt = Date.now();
  note.updatedAt = Date.now();
  applyAutoStatus(note);
  persist();
  renderSubtasks();
  renderNoteList();
}

function whoBadge(note, st) {
  if (!st.updatedBy) return '';
  const mine = st.updatedBy.id === NZDevice.getId();
  const who = mine ? t('you') : st.updatedBy.nickname || t('someone');
  const color = NZ.noteColorFor(note, st.updatedBy.id) || st.updatedBy.color || 'var(--text-faint)';
  return `<span class="sub-who" style="color:${color}" title="${t('lastChangedBy', { who: escapeHtml(who) })}">● ${escapeHtml(who)}</span>`;
}

function deleteSubtask(stId) {
  // Soft-Delete: Teilaufgabe wandert in die "Gelöscht"-Gruppe (wiederherstellbar), statt weg zu sein.
  const note = currentNote();
  if (!note) return;
  const st = (note.subtasks || []).find((s) => s.id === stId);
  if (!st) return;
  st.deleted = true;
  st.deletedAt = Date.now();
  note.updatedAt = Date.now();
  applyAutoStatus(note);
  persist();
  renderSubtasks();
  renderNoteList();
}
function restoreSubtask(stId) {
  const note = currentNote();
  if (!note) return;
  const st = (note.subtasks || []).find((s) => s.id === stId);
  if (!st) return;
  delete st.deleted;
  delete st.deletedAt;
  note.updatedAt = Date.now();
  applyAutoStatus(note);
  persist();
  renderSubtasks();
  renderNoteList();
}
function purgeSubtask(stId) {
  // Endgültig entfernen (aus der "Gelöscht"-Gruppe).
  const note = currentNote();
  if (!note) return;
  note.subtasks = note.subtasks.filter((s) => s.id !== stId);
  note.updatedAt = Date.now();
  persist();
  renderSubtasks();
  renderNoteList();
}

// ---- Foto pro Teilaufgabe (optional) ----
let photoTargetId = null;

function findSub(stId) {
  const note = currentNote();
  return note && (note.subtasks || []).find((s) => s.id === stId);
}

async function pickSubtaskPhoto(stId) {
  photoTargetId = stId;
  // Handy-App: nativer Dialog „Foto aufnehmen / Aus Galerie".
  if (window.NZNative && NZNative.cameraAvailable && NZNative.cameraAvailable()) {
    try {
      const dataUrl = await NZNative.takePhoto({
        header: t('photoHeader'),
        camera: t('takePhoto'),
        gallery: t('fromGallery'),
        cancel: t('cancel')
      });
      if (dataUrl) storeSubtaskPhoto(stId, dataUrl);
    } catch (e) {
      const msg = (e && e.message) || '';
      if (!/cancel/i.test(msg) && msg !== 'no-camera') alert(t('photoFailed') + msg);
    }
    return;
  }
  // Web/Desktop: Datei-Dialog (am Handy bietet der Browser dort meist auch die Kamera an).
  const inp = $('subPhotoInput');
  inp.value = '';
  inp.click();
}

function storeSubtaskPhoto(stId, dataUrl) {
  const st = findSub(stId);
  if (!st || !dataUrl) return;
  st.photo = dataUrl;
  st.updatedBy = NZDevice.me();
  st.updatedAt = Date.now();
  const note = currentNote();
  if (note) note.updatedAt = Date.now();
  persist();
  renderSubtasks();
}

async function onSubPhotoChosen(file) {
  if (!file || !findSub(photoTargetId)) return;
  try {
    storeSubtaskPhoto(photoTargetId, await downscaleImage(file, 900, 0.5));
  } catch (e) {
    alert(t('photoFailed') + (e.message || e));
  }
}

// Bild verkleinern & als JPEG-DataURL zurückgeben (klein halten → synct mit der Notiz).
function downscaleImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > h && w > maxDim) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else if (h > maxDim) {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        let q = quality;
        let url = canvas.toDataURL('image/jpeg', q);
        while (url.length > 220000 && q > 0.3) {
          q -= 0.1;
          url = canvas.toDataURL('image/jpeg', q);
        }
        resolve(url);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function openPhoto(stId) {
  const st = findSub(stId);
  if (!st || !st.photo) return;
  photoTargetId = stId;
  $('photoImg').src = st.photo;
  $('photoModal').classList.remove('hidden');
}

function removePhoto() {
  const st = findSub(photoTargetId);
  if (st) {
    st.photo = null;
    st.updatedAt = Date.now();
    const note = currentNote();
    if (note) note.updatedAt = Date.now();
    persist();
    renderSubtasks();
  }
  $('photoModal').classList.add('hidden');
}

// ---- Folders ----
function newFolder() {
  const name = prompt(t('newFolderPrompt'));
  if (!name || !name.trim()) return;
  const clean = name.trim();
  if (data.folders.includes(clean)) return;
  data.folders.push(clean);
  persist();
  renderAll();
}

function deleteFolder(name) {
  if (!confirm(t('deleteFolderConfirm', { name }))) return;
  data.folders = data.folders.filter((f) => f !== name);
  data.notes.forEach((n) => {
    if (n.folder === name) n.folder = '';
  });
  if (currentFolder === name) currentFolder = '__all__';
  persist();
  renderAll();
}

// ---- Theme ----
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('themeToggle').textContent = theme === 'dark' ? t('themeDark') : t('themeLight');
  localStorage.setItem('theme', theme);
}

// ---- Helpers liegen jetzt im Kern (NZ.escapeHtml / NZ.stripMd / NZ.formatDate) ----

// ---- Teilen (Phase 3) ----
function cloudReady() {
  return window.NZShare && NZStore.kind === 'supabase';
}
function shareLinkFor(code) {
  const base = (window.NZ_CONFIG && NZ_CONFIG.WEB_URL) || 'https://marour80.github.io/notizapp/';
  return base + '?join=' + encodeURIComponent(code);
}
function showShareModal(show) {
  $('shareModal').classList.toggle('hidden', !show);
}

function renderShareState(note) {
  const shared = !!(note && note.share && note.share.code);
  $('shareUnshared').classList.toggle('hidden', shared);
  $('shareShared').classList.toggle('hidden', !shared);
  if (shared) {
    const code = note.share.code;
    const link = shareLinkFor(code);
    $('shareCode').value = code;
    $('shareLink').value = link;
    if (window.qrcode) {
      const qr = window.qrcode(0, 'M');
      qr.addData(link);
      qr.make();
      $('shareQr').innerHTML = qr.createImgTag(5, 8);
    }
  }
}

async function openShare() {
  const note = currentNote();
  if (!note) return;
  if (!cloudReady()) {
    alert(t('needCloud'));
    return;
  }
  showShareModal(true);
  renderShareState(note);
  $('inviteUser').value = '';
  $('inviteMsg').classList.add('hidden');
  renderFriendChips();
}

// ---- Teilen per @Nutzername (Anfrage senden) ----
function showSmallMsg(el, text, isErr) {
  el.textContent = text;
  el.classList.toggle('err', !!isErr);
  el.classList.remove('hidden');
}

// Einladung an eine konkrete uid senden (von @Name-Eingabe ODER Freund-Chip).
async function doSendInvite(toUid, label) {
  const note = currentNote();
  const msg = $('inviteMsg');
  if (!note || !cloudReady() || !window.NZInvites) return;
  try {
    const myProfile = await NZProfile.getMyProfile();
    const fromName = myProfile && myProfile.username ? '@' + myProfile.username : NZDevice.me().nickname;
    await NZInvites.sendInvite(note, toUid, fromName);
    note.shared = true;
    persist();
    renderShareState(note);
    renderNoteList();
    updateSharedBadge(note);
    showSmallMsg(msg, t('inviteSent', { name: label || '' }), false);
  } catch (e) {
    showSmallMsg(msg, e.message === 'self' ? t('inviteSelf') : t('errGeneric') + (e.message || e), true);
  }
}

async function sendInviteToUser() {
  const msg = $('inviteMsg');
  msg.classList.add('hidden');
  if (!cloudReady() || !window.NZProfile) return;
  if (!NZProfile.cleanUsername($('inviteUser').value)) return showSmallMsg(msg, t('inviteNeedName'), true);
  $('inviteSendBtn').disabled = true;
  try {
    const user = await NZProfile.findUser($('inviteUser').value);
    if (!user) {
      showSmallMsg(msg, t('inviteUserNotFound'), true);
      return;
    }
    await doSendInvite(user.uid, '@' + user.username);
    $('inviteUser').value = '';
  } finally {
    $('inviteSendBtn').disabled = false;
  }
}

// ---- Freundesliste ----
function friendLabel(f) {
  return (f.alias && f.alias.trim()) || '@' + (f.friend_username || '?');
}
async function renderFriendChips() {
  if (!window.NZFriends || !cloudReady()) {
    $('friendsShare').classList.add('hidden');
    return;
  }
  let friends = [];
  try {
    friends = await NZFriends.listFriends();
  } catch {}
  const box = $('friendChips');
  box.innerHTML = '';
  $('friendsShare').classList.toggle('hidden', friends.length === 0);
  friends.forEach((f) => {
    const b = document.createElement('button');
    b.className = 'friend-chip';
    b.textContent = friendLabel(f);
    b.onclick = () => {
      $('inviteMsg').classList.add('hidden');
      doSendInvite(f.friend_uid, friendLabel(f));
    };
    box.appendChild(b);
  });
}

function openFriends() {
  if (!cloudReady()) return alert(t('needCloud'));
  $('addFriendInput').value = '';
  $('addFriendAlias').value = '';
  $('addFriendMsg').classList.add('hidden');
  renderFriendsList();
  $('friendsModal').classList.remove('hidden');
}
async function renderFriendsList() {
  const ul = $('friendsList');
  ul.innerHTML = '';
  let friends = [];
  try {
    friends = await NZFriends.listFriends();
  } catch {}
  if (!friends.length) {
    ul.innerHTML = `<li class="friends-empty">${escapeHtml(t('noFriends'))}</li>`;
    return;
  }
  friends.forEach((f) => {
    const li = document.createElement('li');
    li.className = 'friend-row';
    li.innerHTML = `
      <input class="friend-alias" type="text" />
      <span class="friend-handle">@${escapeHtml(f.friend_username || '')}</span>
      <button class="friend-del" title="${t('remove')}">✕</button>`;
    const inp = li.querySelector('.friend-alias');
    inp.value = f.alias || '';
    inp.placeholder = t('aliasPlaceholder');
    inp.onchange = async () => {
      await NZFriends.setFriendAlias(f.friend_uid, inp.value);
      renderFriendChips();
    };
    li.querySelector('.friend-del').onclick = async () => {
      await NZFriends.removeFriend(f.friend_uid);
      renderFriendsList();
      renderFriendChips();
    };
    ul.appendChild(li);
  });
}
async function addFriendFromInput() {
  const msg = $('addFriendMsg');
  msg.classList.add('hidden');
  if (!window.NZProfile || !NZProfile.cleanUsername($('addFriendInput').value)) return;
  $('addFriendBtn').disabled = true;
  try {
    await NZFriends.addFriend($('addFriendInput').value, $('addFriendAlias').value);
    $('addFriendInput').value = '';
    $('addFriendAlias').value = '';
    renderFriendsList();
    renderFriendChips();
  } catch (e) {
    const m =
      e.message === 'not-found' ? t('inviteUserNotFound') : e.message === 'self' ? t('inviteSelf') : t('errGeneric') + (e.message || e);
    showSmallMsg(msg, m, true);
  } finally {
    $('addFriendBtn').disabled = false;
  }
}

async function doShare() {
  const note = currentNote();
  if (!note || !cloudReady()) return;
  $('shareBusy').classList.remove('hidden');
  $('doShareBtn').disabled = true;
  try {
    await window.NZShare.shareNote(note);
    note.shared = true;
    NZ.claimNoteColor(note, NZDevice.getId()); // feste Farbe für diese Notiz
    persist();
    renderShareState(note);
    renderNoteList();
    updateSharedBadge(note);
  } catch (e) {
    alert(t('shareFailed') + (e.message || e));
  } finally {
    $('shareBusy').classList.add('hidden');
    $('doShareBtn').disabled = false;
  }
}

async function doUnshare() {
  const note = currentNote();
  if (!note || !cloudReady()) return;
  if (!confirm(t('stopSharingConfirm'))) return;
  try {
    await window.NZShare.unshareNote(note);
    note.shared = false;
    persist();
    renderShareState(note);
    renderNoteList();
    updateSharedBadge(note);
  } catch (e) {
    alert(t('errGeneric') + (e.message || e));
  }
}

function updateSharedBadge(note) {
  const shared = !!(note && note.share && note.share.code);
  $('sharedBadge').classList.toggle('hidden', !shared);
  if (!shared) { $('sharedBadge').textContent = ''; return; }
  if (note.ownedByMe === false) {
    // Notiz wurde MIT mir geteilt → Namen des Teilers zeigen (statt "jemand")
    const name = (note.share.createdBy && note.share.createdBy.nickname) || t('someone');
    $('sharedBadge').textContent = t('sharedByName', { name });
  } else {
    $('sharedBadge').textContent = t('shared') + ' · ' + note.share.code;
  }
}

// Live-Präsenz (wer ist gerade in dieser Notiz?)
let presenceHandle = null;
function leavePresence() {
  if (presenceHandle) {
    presenceHandle.leave();
    presenceHandle = null;
  }
  $('presenceRow').classList.add('hidden');
}
async function updatePresence(note) {
  leavePresence();
  if (!note || !cloudReady() || !(note.share && note.share.code)) return;
  presenceHandle = await window.NZShare.joinPresence(note.id, NZDevice.me(), renderPresence);
}
function renderPresence(list) {
  const row = $('presenceRow');
  const seen = {};
  const people = (list || []).filter((p) => p && p.id && !seen[p.id] && (seen[p.id] = 1));
  if (people.length <= 1) {
    row.classList.add('hidden');
    return;
  }
  const note = currentNote();
  const dots = people
    .map((p) => `<span class="pres-dot" style="background:${NZ.noteColorFor(note, p.id) || p.color || '#888'}" title="${escapeHtml(p.nickname || '')}"></span>`)
    .join('');
  row.innerHTML = `${dots}<span class="pres-text">${t('online', { n: people.length })}</span>`;
  row.classList.remove('hidden');
}

// Desktop-Benachrichtigung bei Änderung einer geteilten Notiz.
function notifyChange(title) {
  try {
    new Notification('SmartNote 🔗', {
      body: title ? t('noteUpdated', { title }) : t('genericUpdated')
    });
  } catch {}
}

// Beitreten
function showJoinModal(show) {
  $('joinModal').classList.toggle('hidden', !show);
  if (show) {
    $('joinInput').value = '';
    $('joinError').classList.add('hidden');
    setTimeout(() => $('joinInput').focus(), 50);
  }
}

function parseCode(raw) {
  const v = (raw || '').trim();
  const m = v.match(/(?:join|code)=([^&\s]+)/i);
  return decodeURIComponent(m ? m[1] : v).trim().toUpperCase();
}

async function doJoin() {
  if (!cloudReady()) {
    alert(t('joinNeedCloud'));
    return;
  }
  const code = parseCode($('joinInput').value);
  if (!code) return;
  $('doJoinBtn').disabled = true;
  try {
    const noteId = await window.NZShare.joinByCode(code);
    if (!noteId) {
      $('joinError').classList.remove('hidden');
      return;
    }
    data = await NZStore.load();
    const joined = data.notes.find((n) => n.id === noteId);
    if (joined && joined.share) {
      NZ.claimNoteColor(joined, NZDevice.getId()); // eigene feste Farbe für diese Notiz
      persist();
    }
    renderAll();
    showJoinModal(false);
    openNote(noteId);
  } catch (e) {
    alert(t('joinFailed') + (e.message || e));
  } finally {
    $('doJoinBtn').disabled = false;
  }
}

// ---- Konto / Notizen sichern (optionale E-Mail-Anmeldung) ----
let authMode = 'secure';

function authAvailable() {
  return !!window.NZAuth && NZStore.kind === 'supabase';
}

async function updateAccountUI() {
  if (!authAvailable()) {
    $('accountBtn').classList.add('hidden');
    return;
  }
  try {
    const info = await NZAuth.getAuthInfo();
    $('accountBtn')._secured = info.secured;
    $('accountBtn')._email = info.email;
    $('accountBtn').textContent = info.secured ? '✓ ' + info.email : t('backup');
    $('accountBtn').classList.toggle('secured', info.secured);
    // Beim Start den echten Namen (@Username) als Geräte-Nickname übernehmen →
    // steht dann bei Teilaufgaben/Push statt "Flinker Luchs".
    if (window.NZProfile && NZProfile.getMyProfile) {
      const p = await NZProfile.getMyProfile();
      if (p && p.username && window.NZDevice) NZDevice.setProfile({ nickname: p.username });
    }
  } catch {}
}

function renderAuthMode() {
  const secured = $('accountBtn')._secured;
  const formIds = ['authEmail', 'authPassword', 'authSubmit'];
  if (secured) {
    $('authTitle').textContent = t('securedTitle');
    $('authHint').classList.add('hidden');
    $('oauthRow').classList.add('hidden');
    formIds.forEach((id) => $(id).classList.add('hidden'));
    document.querySelector('.auth-switch').classList.add('hidden');
    $('authSignedIn').classList.remove('hidden');
    $('authSignedInText').textContent = t('signedInAs', { email: $('accountBtn')._email || '' });
    return;
  }
  $('authHint').classList.remove('hidden');
  $('oauthRow').classList.remove('hidden');
  formIds.forEach((id) => $(id).classList.remove('hidden'));
  document.querySelector('.auth-switch').classList.remove('hidden');
  $('authSignedIn').classList.add('hidden');
  $('authError').classList.add('hidden');
  if (authMode === 'secure') {
    $('authTitle').textContent = t('backupTitleModal');
    $('authHint').textContent = t('backupHint');
    $('authSubmit').textContent = t('backupBtn');
    $('authSwitchText').textContent = t('haveAccount');
    $('authSwitchLink').textContent = t('signIn');
  } else {
    $('authTitle').textContent = t('signInTitle');
    $('authHint').textContent = t('signInHint');
    $('authSubmit').textContent = t('signIn');
    $('authSwitchText').textContent = t('noAccountYet');
    $('authSwitchLink').textContent = t('backupBtn');
  }
}

function openAuth() {
  if (!authAvailable()) {
    alert(t('backupNeedCloud'));
    return;
  }
  authMode = 'secure';
  $('authEmail').value = '';
  $('authPassword').value = '';
  $('authError').classList.add('hidden');
  renderAuthMode();
  loadUsernameField();
  $('authModal').classList.remove('hidden');
}

function showAuthError(msg) {
  $('authError').textContent = msg;
  $('authError').classList.remove('hidden');
}

function translateAuthError(e) {
  const m = ((e && e.message) || '').toLowerCase();
  if (m.includes('registered')) return t('errEmailTaken');
  if (m.includes('invalid login') || m.includes('credentials')) return t('errBadLogin');
  if (m.includes('password')) return t('errPw');
  if (m.includes('email')) return t('errEmail');
  return t('errGeneric') + ((e && e.message) || e);
}

async function submitAuth() {
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  if (!email || !password) return showAuthError(t('fillEmailPw'));
  if (password.length < 6) return showAuthError(t('pwTooShort'));
  $('authSubmit').disabled = true;
  try {
    if (authMode === 'secure') {
      await NZAuth.secureWithEmail(email, password);
      $('authModal').classList.add('hidden');
      await updateAccountUI();
      alert(t('backedUp'));
    } else {
      await NZAuth.signInEmail(email, password);
      location.reload(); // mit dem Konto neu laden (lädt dessen Notizen)
    }
  } catch (e) {
    showAuthError(translateAuthError(e));
  } finally {
    $('authSubmit').disabled = false;
  }
}

async function signOutAccount() {
  if (!confirm(t('signOutConfirm'))) return;
  await NZAuth.signOutUser();
  location.reload();
}

// ---- @Nutzername (Profil) ----
async function loadUsernameField() {
  if (!authAvailable() || !window.NZProfile) return;
  $('profileBox').classList.remove('hidden');
  $('usernameMsg').classList.add('hidden');
  try {
    const p = await NZProfile.getMyProfile();
    $('usernameInput').value = p && p.username ? '@' + p.username : '';
    // Echten Namen fuer die "wer war's"-Spur / Push uebernehmen (statt Zufallsname "Flinker Luchs")
    if (p && p.username && window.NZDevice) NZDevice.setProfile({ nickname: p.username });
  } catch {}
}
async function saveUsername() {
  const msg = $('usernameMsg');
  msg.classList.add('hidden');
  $('usernameSave').disabled = true;
  try {
    const info = window.NZAuth ? await NZAuth.getAuthInfo() : null;
    const display = (info && info.email) || NZDevice.me().nickname;
    const uname = await NZProfile.setUsername($('usernameInput').value, display);
    $('usernameInput').value = '@' + uname;
    if (window.NZDevice) NZDevice.setProfile({ nickname: uname }); // Name mit Username syncen
    showSmallMsg(msg, t('usernameSaved'), false);
  } catch (e) {
    const m =
      e.message === 'too-short' ? t('usernameTooShort') : e.message === 'taken' ? t('usernameTaken') : t('errGeneric') + (e.message || e);
    showSmallMsg(msg, m, true);
  } finally {
    $('usernameSave').disabled = false;
  }
}

// ---- Eingehende Notiz-Anfragen ----
let inviteQueue = [];
let inviteShowing = null;
function enqueueInvite(inv) {
  if (!inv) return;
  if ((inviteShowing && inviteShowing.id === inv.id) || inviteQueue.some((i) => i.id === inv.id)) return;
  inviteQueue.push(inv);
  showNextInvite();
}
function showNextInvite() {
  if (inviteShowing || !inviteQueue.length) return;
  inviteShowing = inviteQueue.shift();
  $('inviteText').textContent = t('inviteRequestText', {
    who: inviteShowing.from_name || t('someone'),
    title: (inviteShowing.note_title || '').trim() || t('untitled')
  });
  $('inviteModal').classList.remove('hidden');
}
function closeInvite() {
  $('inviteModal').classList.add('hidden');
  inviteShowing = null;
  setTimeout(showNextInvite, 250);
}
async function acceptCurrentInvite() {
  const inv = inviteShowing;
  if (!inv) return;
  $('inviteAccept').disabled = true;
  try {
    const noteId = await NZInvites.acceptInvite(inv);
    data = await NZStore.load();
    renderAll();
    closeInvite();
    if (noteId) openNote(noteId);
    showToast(t('inviteAcceptedToast', { title: (inv.note_title || '').trim() || t('untitled') }));
  } catch (e) {
    alert(t('errGeneric') + (e.message || e));
  } finally {
    $('inviteAccept').disabled = false;
  }
}
async function declineCurrentInvite() {
  const inv = inviteShowing;
  if (!inv) return;
  try {
    await NZInvites.declineInvite(inv);
  } catch {}
  closeInvite();
}

// ---- Anmelden mit Google / Apple ----
async function signInWithProvider(which) {
  if (!authAvailable()) return alert(t('backupNeedCloud'));
  const btn = which === 'apple' ? $('appleSignInBtn') : $('googleSignInBtn');
  btn.disabled = true;
  $('authError').classList.add('hidden');
  try {
    await (which === 'apple' ? NZAuth.signInWithApple() : NZAuth.signInWithGoogle());
    // Web: Browser leitet weiter (Seite lädt neu zurück). Native: Browser ist nun offen,
    // Rückkehr läuft über onAuthCallback (Erfolg) → location.reload().
  } catch (e) {
    showAuthError(t('oauthFailed') + (e.message || e));
  } finally {
    // Knopf wieder freigeben: bei Erfolg lädt die Seite eh neu, bei Abbruch bleibt er klickbar.
    btn.disabled = false;
  }
}

// Native Rückleitung aus dem Browser (smartnote://login-callback) abschließen.
if (window.NZNative && NZNative.onAuthCallback) {
  NZNative.onAuthCallback(async (url) => {
    if (NZNative.closeBrowser) NZNative.closeBrowser(); // In-App-Safari schließen
    try {
      const ok = await NZAuth.completeOAuth(url);
      if (ok) location.reload(); // mit dem neuen Konto laden
    } catch (e) {
      alert(t('oauthFailed') + (e.message || e));
    }
  });
}

// ---- KI (Einkauf sortieren / Sprachnotiz) ----
function aiAvailable() {
  return !!(window.NZAI && NZAI.available() && NZStore.kind === 'supabase');
}

function createNoteFromAI(title, items) {
  const note = NZ.makeNote({
    title: title || t('newList'),
    folder: currentFolder === '__all__' ? '' : currentFolder,
    tags: []
  });
  note.subtasks = (items || []).map((t) => NZ.makeSubtask(t, NZDevice.me()));
  applyAutoStatus(note);
  data.notes.unshift(note);
  persist();
  renderAll();
  openNote(note.id);
}

async function aiSort() {
  const note = currentNote();
  if (!note || !(note.subtasks || []).length) return;
  const btn = $('sortBtn');
  btn.disabled = true;
  const oldT = btn.textContent;
  btn.textContent = t('sorting');
  try {
    const res = await NZAI.sort(note.subtasks.map((s) => s.text));
    const norm = (s) => (s || '').trim().toLowerCase();
    const pool = note.subtasks.slice();
    const reordered = [];
    (res.groups || []).forEach((g) =>
      (g.items || []).forEach((t) => {
        const i = pool.findIndex((s) => norm(s.text) === norm(t));
        if (i >= 0) reordered.push(pool.splice(i, 1)[0]);
      })
    );
    reordered.push(...pool); // nicht zugeordnete bleiben am Ende
    note.subtasks = reordered;
    note.updatedAt = Date.now();
    persist();
    renderSubtasks();
    renderNoteList();
  } catch (e) {
    alert(t('sortFailed') + (e.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = oldT;
  }
}

// ---- Sprach-Teilen: gesprochenen Namen gegen die Freundesliste matchen ----
function normName(s) {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9äöüß ]/g, '');
}
function lev(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}
function scoreName(cand, q) {
  if (!cand || !q) return 0;
  if (cand === q) return 100;
  if (cand.startsWith(q) || q.startsWith(cand)) return 85;
  if (cand.includes(q) || q.includes(cand)) return 72;
  const dist = lev(cand, q);
  const max = Math.max(cand.length, q.length) || 1;
  return Math.max(0, 100 - (dist / max) * 100);
}
function matchFriend(spoken, friends) {
  const q = normName(spoken);
  if (!q) return null;
  let best = null;
  let bestScore = 0;
  (friends || []).forEach((f) => {
    [f.alias, f.friend_username].filter(Boolean).forEach((c) => {
      const s = scoreName(normName(c), q);
      if (s > bestScore) {
        bestScore = s;
        best = f;
      }
    });
  });
  return bestScore >= 62 ? best : null;
}

// Nach einer Sprachnotiz mit "teile mit X": Dialog zum Bestätigen/Auswählen.
async function promptVoiceShare(spoken) {
  const note = currentNote();
  if (!note || !cloudReady() || !window.NZFriends) return;
  let friends = [];
  try {
    friends = await NZFriends.listFriends();
  } catch {}
  if (!friends.length) return; // keine Freunde → nichts vorzuschlagen
  const matched = matchFriend(spoken, friends);
  $('voiceShareText').textContent = matched
    ? t('voiceShareMatched', { spoken, name: friendLabel(matched) })
    : t('voiceSharePick', { spoken });
  const box = $('voiceShareChips');
  box.innerHTML = '';
  const ordered = matched ? [matched, ...friends.filter((f) => f.friend_uid !== matched.friend_uid)] : friends;
  ordered.forEach((f) => {
    const b = document.createElement('button');
    b.className = 'friend-chip' + (matched && f.friend_uid === matched.friend_uid ? ' matched' : '');
    b.textContent = friendLabel(f);
    b.onclick = async () => {
      closeVoiceShare();
      await doSendInvite(f.friend_uid, friendLabel(f));
      showToast(t('inviteSent', { name: friendLabel(f) }));
    };
    box.appendChild(b);
  });
  $('voiceShareModal').classList.remove('hidden');
}
function closeVoiceShare() {
  $('voiceShareModal').classList.add('hidden');
}

// ---- Sprachnotiz (aufnehmen -> Whisper -> KI-Liste) ----
let mediaRecorder = null;
let audioChunks = [];
let voiceTimer = null;
let voiceSeconds = 0;
let voiceTargetId = null; // null = neue Notiz; sonst füllt es diese offene Notiz
let voiceDraft = null; // von der KI verstandene Liste, noch vom Nutzer zu bestätigen
let nativeRecording = false; // läuft gerade eine native iOS-Aufnahme?

// Ergebnis in eine bestehende, offene Notiz einfüllen (Titel nur wenn leer; Punkte anhängen).
function fillNoteFromVoice(noteId, title, items) {
  const note = data.notes.find((n) => n.id === noteId);
  if (!note) return createNoteFromAI(title, items);
  if (!note.title || !note.title.trim()) note.title = title || '';
  if (!note.subtasks) note.subtasks = [];
  (items || []).forEach((text) => note.subtasks.push(NZ.makeSubtask(text, NZDevice.me())));
  applyAutoStatus(note);
  note.updatedAt = Date.now();
  persist();
  if (activeNoteId === noteId) {
    titleInput.value = note.title || '';
    renderSubtasks();
  }
  renderNoteList();
}

function micSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}
function showVoiceError(msg) {
  stopVoiceOrb();
  $('voiceError').textContent = msg;
  $('voiceError').classList.remove('hidden');
}

async function startVoice(targetId) {
  if (!aiAvailable()) return;
  voiceTargetId = typeof targetId === 'string' ? targetId : null;
  voiceDraft = null; // frischer Start
  beginRecording();
}
function adjustVoice() {
  // Nachbessern: erneut aufnehmen, aber den aktuellen Entwurf als Kontext behalten.
  beginRecording();
}

// ---- Voice-Orb: pulsierende Kugel während der Aufnahme (à la ChatGPT-Voice) ----
// Reagiert auf die echte Mikrofon-Lautstärke (Web/Android via AnalyserNode).
// Auf iOS läuft die Aufnahme nativ (kein Web-Audio-Pegel) → lebendige Sprech-Simulation.
let voiceOrb = null; // { raf, gl, actx }

function startVoiceOrb(stream) {
  stopVoiceOrb();
  const canvas = $('voiceOrb');
  const fallback = $('voicePulse');
  if (!canvas) return;
  let gl = null;
  try { gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false }); } catch {}
  if (!gl) {
    canvas.classList.add('hidden');
    if (fallback) fallback.classList.remove('hidden');
    return;
  }
  canvas.classList.remove('hidden');
  if (fallback) fallback.classList.add('hidden');

  const vs = 'attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }';
  const fs =
    'precision highp float;\n' +
    'uniform float u_time; uniform float u_level; uniform vec2 u_res;\n' +
    'void main(){\n' +
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res) / min(u_res.x,u_res.y);\n' +
    '  float d = length(uv);\n' +
    '  float lv = clamp(u_level, 0.0, 1.0);\n' +
    '  float R = 0.38 + lv*0.09;\n' +                 // Kugel atmet mit der Lautstärke
    '  float sphere = smoothstep(R, R-0.02, d);\n' +
    '  float w1 = abs(sin(d*14.0 - u_time*5.0)) * (0.03+lv*0.09) / max(abs(d-R-0.08), 0.02);\n' +
    '  float w2 = abs(sin(d*9.0 - u_time*2.5)) * (0.015+lv*0.05) / max(abs(d-R-0.22), 0.03);\n' +
    '  float glow = (0.04+lv*0.09) / max(d, 0.05);\n' +
    '  float mesh = abs(sin(uv.x*18.0 + u_time*0.6)) * abs(sin(uv.y*18.0 - u_time*0.4));\n' +
    '  vec3 teal = vec3(0.329, 0.859, 0.784);\n' +   // App-Akzent #54dbc8
    '  vec3 col = teal * (w1 + w2 + glow) + teal * mesh * 0.10 * sphere;\n' +
    '  col += vec3(1.0) * sphere * (0.03 + lv*0.05);\n' +
    // Vignette: alles läuft deutlich VOR dem Canvas-Rand weich aus → keine sichtbare Box
    '  float vign = smoothstep(0.95, 0.55, d);\n' +
    '  col *= vign;\n' +
    '  float a = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0) * vign;\n' +
    '  gl_FragColor = vec4(col, a);\n' +
    '}';
  function sh(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    canvas.classList.add('hidden');
    if (fallback) fallback.classList.remove('hidden');
    return;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const pLoc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(pLoc);
  gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);
  const uTime = gl.getUniformLocation(prog, 'u_time');
  const uLevel = gl.getUniformLocation(prog, 'u_level');
  const uRes = gl.getUniformLocation(prog, 'u_res');

  // Echt-Pegel: Web/Android über AnalyserNode (Stream), iOS über das native
  // NZRecorder-Metering (gepollt). Nur wenn beides fehlt → Sprech-Simulation.
  let analyser = null;
  let dataArr = null;
  let actx = null;
  if (stream && (window.AudioContext || window.webkitAudioContext)) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      const src = actx.createMediaStreamSource(stream);
      analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      dataArr = new Uint8Array(analyser.frequencyBinCount);
    } catch {}
  }
  // iOS: nativen Pegel regelmäßig abfragen (AVAudioRecorder-Metering, wie beim Sprachmemo-Recorder)
  let nativeRaw = -1; // -1 = (noch) kein nativer Pegel verfügbar
  let levelTimer = null;
  if (!stream && window.NZNative && NZNative.getRecordingLevel) {
    levelTimer = setInterval(async () => {
      const lv = await NZNative.getRecordingLevel();
      if (lv === null) {
        clearInterval(levelTimer);
        levelTimer = null;
        nativeRaw = -1; // Plugin fehlt (alte App) → Simulation
        return;
      }
      // Sprache liegt linear grob bei 0.01–0.35 → verstärken, damit es sichtbar schwingt
      nativeRaw = Math.min(1, Math.pow(lv, 0.6) * 1.6);
    }, 66);
  }
  let level = 0;
  let silentMs = 0;
  let last = performance.now();
  function frame(t) {
    const dt = t - last;
    last = t;
    let raw = -1;
    if (analyser) {
      analyser.getByteTimeDomainData(dataArr);
      let sum = 0;
      for (let i = 0; i < dataArr.length; i++) {
        const v = (dataArr[i] - 128) / 128;
        sum += v * v;
      }
      raw = Math.min(1, Math.sqrt(sum / dataArr.length) * 4);
    } else if (nativeRaw >= 0) {
      raw = nativeRaw;
    }
    if (raw >= 0 && raw < 0.03) silentMs += dt; else silentMs = 0;
    let target = Math.max(raw, 0.06); // nie ganz tot – leichter Grundpuls
    if (raw < 0 || silentMs > 4000) {
      // Kein echter Pegel verfügbar (oder sehr lange still) → dezente Sprech-Simulation
      target = 0.3 + 0.18 * Math.sin(t * 0.004) + 0.14 * Math.sin(t * 0.011 + 1.7) + 0.1 * Math.sin(t * 0.023 + 0.5);
      target = Math.max(0.08, target);
    }
    level += (target - level) * 0.35; // schnell folgen → schwingt WIE die Stimme, nicht hinterher
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uTime, t * 0.001);
    gl.uniform1f(uLevel, level);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    voiceOrb.raf = requestAnimationFrame(frame);
  }
  voiceOrb = { raf: requestAnimationFrame(frame), gl, actx, levelTimer: () => levelTimer };
}

function stopVoiceOrb() {
  if (!voiceOrb) return;
  cancelAnimationFrame(voiceOrb.raf);
  try { voiceOrb.actx && voiceOrb.actx.close(); } catch {}
  try { const lt = voiceOrb.levelTimer && voiceOrb.levelTimer(); if (lt) clearInterval(lt); } catch {}
  voiceOrb = null;
}

async function beginRecording() {
  $('voiceError').classList.add('hidden');
  $('voiceProcessing').classList.add('hidden');
  $('voiceConfirm').classList.add('hidden');
  $('voiceAnswer').classList.add('hidden');
  $('voiceRecording').classList.remove('hidden');
  $('voiceTimer').textContent = '0:00';
  $('voiceModal').classList.remove('hidden');

  // iOS: nativer Recorder (Web-Aufnahme liefert dort stilles Audio → "You"-Halluzination).
  if (window.NZNative && NZNative.nativeRecordAvailable && NZNative.nativeRecordAvailable()) {
    const ok = await NZNative.startNativeRecording();
    if (!ok) {
      $('voiceRecording').classList.add('hidden');
      showVoiceError(t('micDenied'));
      return;
    }
    nativeRecording = true;
    startVoiceOrb(null); // nativer Recorder liefert keinen Web-Pegel → Simulation
    startVoiceTimer();
    return;
  }

  // Web/Android: MediaRecorder
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    startVoiceOrb(stream); // Orb reagiert auf die echte Lautstärke
    audioChunks = [];
    const useWebm = window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm');
    mediaRecorder = useWebm ? new MediaRecorder(stream, { mimeType: 'audio/webm' }) : new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      await processVoice(new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' }));
    };
    mediaRecorder.start();
    startVoiceTimer();
  } catch (e) {
    $('voiceRecording').classList.add('hidden');
    showVoiceError(t('micDenied'));
  }
}

function startVoiceTimer() {
  voiceSeconds = 0;
  voiceTimer = setInterval(() => {
    voiceSeconds++;
    const m = Math.floor(voiceSeconds / 60);
    const s = voiceSeconds % 60;
    $('voiceTimer').textContent = m + ':' + String(s).padStart(2, '0');
    if (voiceSeconds >= 120) stopVoice(); // Sicherheitslimit 2 Min
  }, 1000);
}

function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime || 'audio/aac' });
}

function stopVoice() {
  if (voiceTimer) {
    clearInterval(voiceTimer);
    voiceTimer = null;
  }
  if (nativeRecording) {
    nativeRecording = false;
    NZNative.stopNativeRecording().then((d) => {
      if (d && d.base64) processVoice(base64ToBlob(d.base64, d.mimeType));
      else {
        $('voiceRecording').classList.add('hidden');
        showVoiceError(t('micDenied'));
      }
    });
  } else if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function closeVoice() {
  if (voiceTimer) {
    clearInterval(voiceTimer);
    voiceTimer = null;
  }
  if (nativeRecording) {
    nativeRecording = false;
    try {
      NZNative.cancelNativeRecording ? NZNative.cancelNativeRecording() : NZNative.stopNativeRecording();
    } catch {}
  } else if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.onstop = null; // verwerfen, nicht verarbeiten
    try {
      mediaRecorder.stop();
    } catch {}
  }
  voiceDraft = null;
  stopVoiceOrb();
  try { window.speechSynthesis && speechSynthesis.cancel(); } catch {}
  $('voiceAnswer').classList.add('hidden');
  $('voiceModal').classList.add('hidden');
}

// Kompakte Übersicht aller Notizen für die KI (Fragen beantworten, Termine finden).
function notesDigest() {
  return (data.notes || []).slice(0, 150).map((n) => ({
    id: n.id,
    title: n.title || '',
    when: n.when || null,
    body: (n.body || '').slice(0, 300),
    items: (n.subtasks || [])
      .filter((s) => !s.deleted)
      .slice(0, 40)
      .map((s) => s.text + ((s.status || 'todo') === 'done' ? ' ✓' : ''))
  }));
}

// Antwort laut vorlesen (Sprachantwort) – eingebaute System-Stimme, kein Netz nötig.
// Wählt die beste verfügbare Stimme (Enhanced/Premium/Siri klingen deutlich natürlicher
// als die Standard-Roboterstimme – auf iOS je nach heruntergeladenen Stimmen).
function pickVoice(langPrefix) {
  try {
    const voices = speechSynthesis.getVoices() || [];
    const mine = voices.filter((v) => (v.lang || '').toLowerCase().startsWith(langPrefix));
    if (!mine.length) return null;
    return (
      mine.find((v) => /siri/i.test(v.name)) ||
      mine.find((v) => /premium|enhanced|erweitert/i.test(v.name)) ||
      mine.find((v) => /anna|helena|samantha|ava/i.test(v.name)) ||
      mine[0]
    );
  } catch {
    return null;
  }
}

function speak(text) {
  try {
    if (!text || !window.speechSynthesis) return;
    speechSynthesis.cancel();
    const en = window.NZI18N && NZI18N.lang === 'en';
    const u = new SpeechSynthesisUtterance(text);
    u.lang = en ? 'en-US' : 'de-DE';
    const v = pickVoice(en ? 'en' : 'de');
    if (v) u.voice = v;
    u.rate = 1.04; // minimal flotter → klingt weniger leiernd
    speechSynthesis.speak(u);
  } catch {}
}

async function processVoice(blob) {
  stopVoiceOrb();
  $('voiceRecording').classList.add('hidden');
  $('voiceConfirm').classList.add('hidden');
  $('voiceAnswer').classList.add('hidden');
  $('voiceProcessing').classList.remove('hidden');
  try {
    const tp = blob.type || '';
    const ext = /m4a|aac/.test(tp) ? 'm4a' : /mp4|mpeg/.test(tp) ? 'mp4' : /ogg/.test(tp) ? 'ogg' : /wav/.test(tp) ? 'wav' : 'webm';
    const fd = new FormData();
    fd.append('file', blob, 'audio.' + ext);
    fd.append('notes', JSON.stringify(notesDigest()));
    fd.append('now', new Date().toString());
    fd.append('lang', (window.NZI18N && NZI18N.lang) || 'de');
    if (voiceDraft) {
      fd.append(
        'context',
        JSON.stringify({
          intent: voiceDraft.intent,
          title: voiceDraft.title,
          items: voiceDraft.items,
          body: voiceDraft.body,
          when: voiceDraft.when,
          shareWith: voiceDraft.shareWith
        })
      );
    }
    const res = await NZAI.voice(fd);
    voiceDraft = {
      intent: res.intent || 'list',
      title: res.title || '',
      items: res.items || [],
      body: res.body || '',
      when: res.when || '',
      answer: res.answer || '',
      spoken: res.spoken || '',
      matchedIds: res.matchedIds || [],
      targetId: res.targetId || '',
      shareWith: (res.shareWith || '').trim(),
      summary: res.summary || ''
    };
    if (voiceDraft.intent === 'query') showVoiceAnswer(voiceDraft);
    else showVoiceConfirm(voiceDraft);
  } catch (e) {
    $('voiceProcessing').classList.add('hidden');
    showVoiceError(t('errGeneric') + (e.message || e));
  }
}

// Frage-Modus: Antwort anzeigen (+ vorlesen) statt eine Notiz zu erstellen.
function showVoiceAnswer(draft) {
  $('voiceProcessing').classList.add('hidden');
  $('voiceRecording').classList.add('hidden');
  $('voiceConfirm').classList.add('hidden');
  $('voiceAnswerText').textContent = draft.answer || t('queryNoAnswer');
  const chips = $('voiceAnswerNotes');
  chips.innerHTML = '';
  (draft.matchedIds || []).forEach((id) => {
    const n = data.notes.find((x) => x.id === id);
    if (!n) return;
    const b = document.createElement('button');
    b.className = 'friend-chip';
    b.textContent = '📄 ' + (n.title || t('untitled'));
    b.onclick = () => {
      closeVoice();
      openNote(n.id);
    };
    chips.appendChild(b);
  });
  $('voiceAnswer').classList.remove('hidden');
  // Kurzfassung sprechen (nicht den ganzen Text) – klingt knackiger.
  speak(draft.spoken || draft.answer);
}

// Zeigt, was die KI verstanden hat → der Nutzer bestätigt oder bessert nach.
function showVoiceConfirm(draft) {
  $('voiceProcessing').classList.add('hidden');
  $('voiceRecording').classList.add('hidden');
  $('voiceSummary').textContent = draft.summary || '';
  const isNote = draft.intent === 'note';
  const isEdit = draft.intent === 'edit';
  const target = isEdit ? data.notes.find((n) => n.id === draft.targetId) : null;
  $('voicePreviewTitle').textContent = draft.title || (target && target.title) || t('newList');
  // Bei "edit" sind items die NEU hinzuzufügenden Punkte – auch anzeigen.
  $('voicePreviewItems').innerHTML = isNote ? '' : (draft.items || []).map((it) => `<li>${escapeHtml(it)}</li>`).join('');
  const bodyEl = $('voicePreviewBody');
  if ((isNote || isEdit) && draft.body) {
    bodyEl.textContent = draft.body;
    bodyEl.classList.remove('hidden');
  } else {
    bodyEl.classList.add('hidden');
  }
  const whenEl = $('voicePreviewWhen');
  if ((isNote || isEdit) && draft.when) {
    whenEl.textContent = '📅 ' + formatWhen(draft.when);
    whenEl.classList.remove('hidden');
  } else {
    whenEl.classList.add('hidden');
  }
  $('voiceConfirmBtn').textContent = isEdit ? t('voiceConfirmEdit') : t('voiceConfirm');
  const shareEl = $('voicePreviewShare');
  if (draft.shareWith) {
    shareEl.textContent = '🔗 ' + t('voiceShareLine', { who: draft.shareWith });
    shareEl.classList.remove('hidden');
  } else {
    shareEl.classList.add('hidden');
  }
  $('voiceConfirm').classList.remove('hidden');
}

// "2026-07-15T20:00" → "Mi., 15. Juli, 20:00" (bzw. nur Datum ohne Uhrzeit).
function formatWhen(when) {
  if (!when) return '';
  try {
    const hasTime = when.includes('T');
    const d = new Date(hasTime ? when : when + 'T12:00');
    if (isNaN(d.getTime())) return when;
    const loc = (window.NZI18N && NZI18N.lang === 'en') ? 'en-US' : 'de-DE';
    const date = d.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'long' });
    if (!hasTime) return date;
    return date + ', ' + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return when;
  }
}

// Einfache Notiz (ohne Teilaufgaben) aus der KI-Antwort erstellen.
// Termin-Notizen werden NUR eingefügt (nicht geöffnet) – sie landen im Termine-Tab.
function createSimpleNoteFromAI(title, body, when) {
  const note = NZ.makeNote({
    title: title || t('untitled'),
    body: body || '',
    folder: currentFolder === '__all__' ? '' : currentFolder
  });
  if (when) note.when = when;
  data.notes.unshift(note);
  persist();
  renderAll();
  if (when) {
    // kurz den Termine-Tab zeigen, damit man sieht, wo der Termin gelandet ist
    document.body.classList.remove('search-open');
    closeEditor(); // Editor-Spalte (Tablet) nicht mit alter Notiz stehen lassen
    renderTermine();
    document.body.classList.add('termine-open');
    setActiveTab('termine');
  } else {
    openNote(note.id);
  }
}

function confirmVoice() {
  const draft = voiceDraft;
  if (!draft) return;
  $('voiceModal').classList.add('hidden');
  if (draft.intent === 'edit') {
    // Bestehenden Termin/Notiz ändern – nur die Felder, die die KI neu geliefert hat.
    const target = data.notes.find((n) => n.id === draft.targetId);
    if (target) {
      if (draft.when) target.when = draft.when;
      if (draft.title) target.title = draft.title;
      if (draft.body) target.body = draft.body;
      // Neue Teilaufgaben anhängen ("füge Butter zur Einkaufsliste hinzu")
      const addedItems = (draft.items || []).filter((s) => s && s.trim());
      if (addedItems.length) {
        if (!target.subtasks) target.subtasks = [];
        addedItems.forEach((s) => target.subtasks.push(NZ.makeSubtask(s, NZDevice.me())));
        applyAutoStatus(target);
      }
      target.termDone = false; // geänderter Termin ist wieder "offen"
      target.updatedAt = Date.now();
      persist();
      renderAll();
      if (addedItems.length) {
        openNote(target.id); // direkt zeigen, was dazugekommen ist
      } else if (target.when) {
        document.body.classList.remove('search-open');
        closeEditor(); // Editor-Spalte (Tablet) nicht mit alter Notiz stehen lassen
        renderTermine();
        document.body.classList.add('termine-open');
        setActiveTab('termine');
      }
    }
    voiceDraft = null;
    return;
  }
  if (draft.intent === 'note') {
    createSimpleNoteFromAI(draft.title, draft.body, draft.when);
  } else if (voiceTargetId && data.notes.find((n) => n.id === voiceTargetId)) {
    fillNoteFromVoice(voiceTargetId, draft.title, draft.items);
  } else {
    createNoteFromAI(draft.title, draft.items);
  }
  const shareWith = draft.shareWith;
  voiceDraft = null;
  if (shareWith) promptVoiceShare(shareWith);
}

// ---- Events ----
$('newNoteBtn').onclick = newNote;
$('fabNew').onclick = newNote;
$('voiceBtn').onclick = () => startVoice(null);
$('fabVoice').onclick = () => startVoice(null);
$('editVoiceBtn').onclick = () => startVoice(activeNoteId);
$('voiceStop').onclick = stopVoice;
$('voiceConfirmBtn').onclick = confirmVoice;
$('voiceAdjustBtn').onclick = adjustVoice;
$('voiceClose').onclick = closeVoice;
$('voiceAnswerOk').onclick = closeVoice;
$('termineAddBtn').onclick = newTermin;
$('termineVoiceBtn').onclick = () => startVoice();
$('voiceAnswerAgain').onclick = () => {
  voiceDraft = null; // neue Frage, kein Anpassungs-Kontext
  beginRecording();
};
$('sortBtn').onclick = aiSort;
$('newFolderBtn').onclick = newFolder;
$('deleteBtn').onclick = deleteNote;
$('pinBtn').onclick = () => togglePin(activeNoteId);
document.querySelectorAll('#emptyList .tpl-tile').forEach((b) => {
  b.onclick = () => startTemplate(b.dataset.tpl);
});
$('fillChoiceVoice').onclick = fillChoiceVoice;
$('fillChoicePhoto').onclick = fillChoicePhoto;
$('fillChoiceType').onclick = fillChoiceType;
$('fillChoiceClose').onclick = closeFillChoice;
$('fillChoiceModal').addEventListener('click', (e) => {
  if (e.target === $('fillChoiceModal')) closeFillChoice();
});
$('themeToggle').onclick = () =>
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
if ($('langToggle')) $('langToggle').onclick = toggleLanguage;

titleInput.oninput = scheduleSave;
folderSelect.onchange = scheduleSave;
$('bodyInput').oninput = scheduleSave;
$('whenInput').onchange = () => {
  const note = currentNote();
  if (!note) return;
  note.when = $('whenInput').value || null;
  updateSimpleNoteUI(note); // Erinnerungs-Zeile + ✕ mitziehen
  scheduleSave();
};
$('whenClear').onclick = () => {
  const note = currentNote();
  if (!note) return;
  note.when = null;
  $('whenInput').value = '';
  $('whenClear').classList.add('hidden');
  $('noteRemRow').classList.add('hidden');
  scheduleSave();
};
$('noteRemRow').onclick = () => {
  const note = currentNote();
  if (note && note.when) openReminderModal(note);
};
$('rsvpYes').onclick = () => setRsvp('yes');
$('rsvpNo').onclick = () => setRsvp('no');

$('searchInput').oninput = (e) => {
  searchTerm = e.target.value;
  renderNoteList();
};

function submitSubtask() {
  const inp = $('subAddInput');
  addSubtask(inp.value);
  inp.value = '';
  focusSubAdd(); // gleich die naechste eingeben koennen – ohne iOS-Hochscrollen (preventScroll)
  const l = $('subList'); // neueste Teilaufgabe sichtbar halten (oberhalb der Tastatur)
  if (l) l.scrollTop = l.scrollHeight;
}
$('subAddInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitSubtask();
});
$('subAddBtn').onclick = submitSubtask;

// Foto pro Teilaufgabe
$('subPhotoInput').onchange = (e) => onSubPhotoChosen(e.target.files && e.target.files[0]);
$('photoClose').onclick = () => $('photoModal').classList.add('hidden');
$('photoRemove').onclick = removePhoto;
$('photoModal').addEventListener('click', (e) => {
  if (e.target === $('photoModal')) $('photoModal').classList.add('hidden');
});

document.querySelectorAll('.status-opt').forEach((btn) => {
  btn.onclick = () => {
    if (activeNoteId) setStatus(activeNoteId, btn.dataset.status);
  };
});

document.querySelectorAll('.status-filter button').forEach((btn) => {
  btn.onclick = () => {
    currentStatus = btn.dataset.filter;
    document.querySelectorAll('.status-filter button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    renderNoteList();
  };
});

// ---- Teilen-Events ----
$('shareBtn').onclick = openShare;
$('shareClose').onclick = () => showShareModal(false);
$('doShareBtn').onclick = doShare;
$('unshareBtn').onclick = doUnshare;
$('joinBtn').onclick = () => showJoinModal(true);
$('joinClose').onclick = () => showJoinModal(false);
$('doJoinBtn').onclick = doJoin;
$('joinInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doJoin();
});

// ---- Native: QR-Scan + Tiefen-Link ----
if (window.NZNative && NZNative.scanAvailable()) {
  $('scanBtn').classList.remove('hidden');
  $('scanBtn').onclick = async () => {
    try {
      const raw = await NZNative.scanQR();
      const code = NZNative.parseCode(raw);
      if (code) {
        $('joinInput').value = code;
        doJoin();
      }
    } catch (e) {
      if ((e.message || '') !== 'no-scanner') alert(t('scanCancelled'));
    }
  };
}

// Tiefen-Link notizapp://join?code=… → Dialog öffnen + automatisch beitreten
if (window.NZNative && NZNative.isNative()) {
  if (NZNative.initKeyboard) NZNative.initKeyboard(); // Tastatur schiebt nicht mehr den ganzen Screen

  NZNative.onDeepLink((code) => {
    showJoinModal(true);
    $('joinInput').value = code;
    doJoin();
  });

  // Widget-Tipps: Sperrbildschirm-Widget → direkt Sprachaufnahme, Homescreen-Widget → Termine-Tab.
  if (NZNative.onAppRoute) {
    NZNative.onAppRoute({
      voice: () => NZStore.ready.then(() => startVoice()),
      termine: () => NZStore.ready.then(() => {
        renderTermine();
        document.body.classList.remove('editor-open', 'search-open', 'settings-open');
        document.body.classList.add('termine-open');
        setActiveTab('termine');
      })
    });
  }

  // Push registrieren – ABER nur wenn Firebase eingerichtet ist (sonst nativer Absturz).
  if (window.NZ_CONFIG && NZ_CONFIG.PUSH) {
    const plat = (window.Capacitor && Capacitor.getPlatform && Capacitor.getPlatform()) || 'android';
    NZStore.ready.then(() => {
      NZNative.registerPush((token) => {
        if (window.NZShare && NZShare.savePushToken) NZShare.savePushToken(token, plat);
      }).catch(() => {});
    });
  }
}

document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.onclick = async () => {
    const el = $(btn.dataset.copy);
    try {
      await navigator.clipboard.writeText(el.value);
    } catch {
      el.select();
      document.execCommand('copy');
    }
    btn.classList.add('copied');
    const old = btn.textContent;
    btn.textContent = t('copied');
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.textContent = old;
    }, 1500);
  };
});

// Klick auf den dunklen Hintergrund schließt Dialoge
[$('shareModal'), $('joinModal')].forEach((ov) => {
  ov.addEventListener('click', (e) => {
    if (e.target === ov) ov.classList.add('hidden');
  });
});

// ---- Konto-Events ----
$('accountBtn').onclick = openAuth;
$('authClose').onclick = () => $('authModal').classList.add('hidden');
$('googleSignInBtn').onclick = () => signInWithProvider('google');
$('appleSignInBtn').onclick = () => signInWithProvider('apple');
$('authSubmit').onclick = submitAuth;
$('authSignout').onclick = signOutAccount;
$('authSwitchLink').onclick = (e) => {
  e.preventDefault();
  authMode = authMode === 'secure' ? 'signin' : 'secure';
  renderAuthMode();
};
$('authPassword').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitAuth();
});
$('authModal').addEventListener('click', (e) => {
  if (e.target === $('authModal')) $('authModal').classList.add('hidden');
});

// ---- Teilen-per-Nutzername-Events ----
$('usernameSave').onclick = saveUsername;
$('inviteSendBtn').onclick = sendInviteToUser;
$('inviteClose').onclick = closeInvite;
$('inviteAccept').onclick = acceptCurrentInvite;
$('inviteDecline').onclick = declineCurrentInvite;
$('inviteUser').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendInviteToUser();
});
$('manageFriendsBtn').onclick = openFriends;
$('friendsBtn').onclick = openFriends;
$('addFriendBtn').onclick = addFriendFromInput;
$('addFriendAlias').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addFriendFromInput();
});
$('friendsClose').onclick = () => $('friendsModal').classList.add('hidden');
$('addFriendInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addFriendFromInput();
});
$('friendsModal').addEventListener('click', (e) => {
  if (e.target === $('friendsModal')) $('friendsModal').classList.add('hidden');
});
$('voiceShareClose').onclick = closeVoiceShare;
$('voiceShareSkip').onclick = closeVoiceShare;
$('voiceShareModal').addEventListener('click', (e) => {
  if (e.target === $('voiceShareModal')) closeVoiceShare();
});
$('usernameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveUsername();
});

NZStore.ready.then(async () => {
  await updateAccountUI();
  if (window.NZAI && NZAI.available() && NZStore.kind === 'supabase') {
    // Auf iOS meldet die WebView micSupported() oft false, kann aber trotzdem aufnehmen
    // (mit Mikrofon-Berechtigung) → auf nativen Geräten den Knopf zeigen.
    if (micSupported() || (window.NZNative && NZNative.isNative())) {
      $('voiceBtn').classList.remove('hidden');
      $('editVoiceBtn').classList.remove('hidden');
      $('fabVoice').classList.remove('hidden');
    }
  }
  if (NZStore.kind === 'supabase' && window.NZFriends) $('friendsBtn').classList.remove('hidden');
  // Eingehende Notiz-Anfragen: offene laden + live lauschen.
  if (authAvailable() && window.NZInvites) {
    try {
      (await NZInvites.pendingInvites()).forEach(enqueueInvite);
    } catch {}
    NZInvites.onInvites((inv) => enqueueInvite(inv));
  }
  // Falls von iOS abgemeldet, aber E-Mail bekannt → freundlich zum Anmelden auffordern
  const remembered = window.NZAuth && NZAuth.lastEmail ? NZAuth.lastEmail() : null;
  if (authAvailable() && !$('accountBtn')._secured && remembered) {
    authMode = 'signin';
    $('authEmail').value = remembered;
    $('authPassword').value = '';
    renderAuthMode();
    $('authHint').textContent = t('welcomeBack');
    $('authModal').classList.remove('hidden');
    setTimeout(() => $('authPassword').focus(), 150);
  }
});

// ---- Handy-Navigation ----
function setNav(open) {
  document.body.classList.toggle('nav-open', open);
  $('scrim').classList.toggle('hidden', !open);
}
// ---- Bottom-Navigation (mobil) – ersetzt das ☰-Menü ----
function setActiveTab(name) {
  document.querySelectorAll('#bottomNav .bnav-item, .side-nav .side-nav-item').forEach((b) => b.classList.toggle('active', b.dataset.nav === name));
}
document.querySelectorAll('#bottomNav .bnav-item, .side-nav .side-nav-item').forEach((btn) => {
  btn.onclick = () => {
    const nav = btn.dataset.nav;
    if (nav === 'notes') {
      document.body.classList.remove('editor-open', 'search-open', 'termine-open', 'settings-open');
      setNav(false);
      setActiveTab('notes');
    } else if (nav === 'termine') {
      document.body.classList.remove('search-open', 'settings-open');
      closeEditor(); // rechts nicht die zuletzt offene Notiz stehen lassen (Tablet: Editor-Spalte bleibt sichtbar)
      renderTermine();
      document.body.classList.add('termine-open');
      setNav(false);
      setActiveTab('termine');
    } else if (nav === 'friends') {
      const fb = $('friendsBtn');
      if (fb && !fb.classList.contains('hidden')) fb.click();
      else $('joinBtn').click();
    } else if (nav === 'search') {
      document.body.classList.remove('termine-open', 'settings-open');
      const on = document.body.classList.toggle('search-open');
      setActiveTab(on ? 'search' : 'notes');
      if (on) setTimeout(() => { const s = $('searchInput'); if (s) s.focus(); }, 60);
    } else if (nav === 'settings') {
      openSettings();
    }
  };
});

// ---- Termin-Erinnerungen: Einstellungs-Dialog ----
function reminderSummary() {
  if (!remOn()) return t('off');
  const leads = remLeads();
  const labels = REM_LEADS.filter((o) => leads.includes(o.min)).map((o) => t(o.key + 'Short'));
  return labels.length ? labels.join(' · ') : t('off');
}

// Das Modal arbeitet in zwei Modi: global (aus den Einstellungen) oder pro Termin
// (aus dem Editor). Pro-Termin-Zeiten (note.remLeads) haben Vorrang vor der globalen Einstellung.
let remModalNote = null; // null = globaler Modus

function renderReminderModal() {
  const tgl = $('reminderToggle');
  const box = $('reminderChips');
  box.innerHTML = '';
  if (remModalNote) {
    // Pro-Termin: Switch = "Standardeinstellung verwenden"
    const usingDefault = !(Array.isArray(remModalNote.remLeads) && remModalNote.remLeads.length);
    $('reminderToggleLbl').textContent = t('useDefault');
    tgl.classList.toggle('on', usingDefault);
    tgl.setAttribute('aria-checked', usingDefault ? 'true' : 'false');
    const leads = usingDefault ? (remOn() ? remLeads() : []) : remModalNote.remLeads;
    REM_LEADS.forEach((o) => {
      const b = document.createElement('button');
      b.className = 'rchip' + (leads.includes(o.min) ? ' on' : '');
      b.textContent = t(o.key);
      b.onclick = () => {
        if (usingDefault) return; // erst den Standard-Schalter ausschalten
        let cur = remModalNote.remLeads || [];
        if (cur.includes(o.min)) cur = cur.filter((x) => x !== o.min);
        else cur = [...cur, o.min];
        remModalNote.remLeads = cur;
        remModalNote.updatedAt = Date.now();
        persist();
        renderReminderModal();
      };
      box.appendChild(b);
    });
    box.classList.toggle('dimmed', usingDefault);
  } else {
    $('reminderToggleLbl').textContent = t('remindersOn');
    tgl.classList.toggle('on', remOn());
    tgl.setAttribute('aria-checked', remOn() ? 'true' : 'false');
    const leads = remLeads();
    REM_LEADS.forEach((o) => {
      const b = document.createElement('button');
      b.className = 'rchip' + (leads.includes(o.min) ? ' on' : '');
      b.textContent = t(o.key);
      b.onclick = () => {
        let cur = remLeads();
        if (cur.includes(o.min)) cur = cur.filter((x) => x !== o.min);
        else cur.push(o.min);
        localStorage.setItem('nz_rem_leads', JSON.stringify(cur));
        renderReminderModal();
        scheduleReminderRefresh();
      };
      box.appendChild(b);
    });
    box.classList.toggle('dimmed', !remOn());
  }
}

function openReminderModal(note) {
  remModalNote = note || null;
  renderReminderModal();
  $('reminderPermHint').classList.add('hidden');
  $('reminderModal').classList.remove('hidden');
}

$('setReminderRow').onclick = () => openReminderModal();

// ---- Morgen-Briefing: Dialog ----
function renderBriefModal() {
  $('briefToggle').classList.toggle('on', briefOn());
  $('briefTime').value = briefTime();
}
$('setBriefRow').onclick = () => {
  renderBriefModal();
  $('briefingModal').classList.remove('hidden');
};
$('briefClose').onclick = () => {
  $('briefingModal').classList.add('hidden');
  if ($('setBriefVal')) $('setBriefVal').textContent = briefSummary();
};
$('briefToggle').onclick = async () => {
  const turningOn = !briefOn();
  localStorage.setItem('nz_brief_on', turningOn ? '1' : '0');
  if (turningOn && window.NZNative && NZNative.requestReminderPermission) await NZNative.requestReminderPermission();
  renderBriefModal();
  scheduleReminderRefresh();
};
$('briefTime').onchange = () => {
  localStorage.setItem('nz_brief_time', $('briefTime').value || '08:00');
  scheduleReminderRefresh();
};
$('reminderClose').onclick = () => {
  $('reminderModal').classList.add('hidden');
  if ($('setReminderVal')) $('setReminderVal').textContent = reminderSummary();
  if (remModalNote) updateSimpleNoteUI(currentNote());
  remModalNote = null;
};
$('reminderToggle').onclick = async () => {
  if (remModalNote) {
    // Pro-Termin: Standard verwenden <-> eigene Zeiten
    const usingDefault = !(Array.isArray(remModalNote.remLeads) && remModalNote.remLeads.length);
    if (usingDefault) remModalNote.remLeads = remOn() ? [...remLeads()] : [60];
    else remModalNote.remLeads = null;
    remModalNote.updatedAt = Date.now();
    persist();
    renderReminderModal();
    return;
  }
  const turningOn = !remOn();
  localStorage.setItem('nz_rem_on', turningOn ? '1' : '0');
  if (turningOn && window.NZNative && NZNative.requestReminderPermission) {
    const ok = await NZNative.requestReminderPermission();
    $('reminderPermHint').classList.toggle('hidden', ok);
  }
  renderReminderModal();
  scheduleReminderRefresh();
};

// ---- Einstellungen-Screen (nutzt die bestehende Theme-/Sprache-/Konto-Logik) ----
function openSettings() {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  if ($('setThemeVal')) $('setThemeVal').textContent = isDark ? t('themeDark') : t('themeLight');
  if ($('setReminderVal')) $('setReminderVal').textContent = reminderSummary();
  if ($('setBriefVal')) $('setBriefVal').textContent = briefSummary();
  if ($('setLangVal')) {
    const lang = (window.NZI18N && typeof NZI18N.lang === 'function') ? NZI18N.lang() : (document.documentElement.lang || 'de');
    $('setLangVal').textContent = String(lang).toUpperCase();
  }
  // Profil-Karte: Name + Avatar-Initiale + E-Mail/@username
  const nick = (window.NZDevice && NZDevice.getProfile().nickname) || '';
  if ($('setPName')) $('setPName').textContent = nick || t('untitled');
  if ($('setAvatar')) $('setAvatar').textContent = (nick.trim()[0] || '?').toUpperCase();
  if ($('setAccountSub')) {
    const acc = $('accountBtn');
    const email = (acc && acc._email) || '';
    $('setAccountSub').textContent = email || 'Nicht angemeldet';
    // Name/@username ergaenzen, falls Cloud-Profil vorhanden
    if (window.NZProfile && NZProfile.getMyProfile) {
      NZProfile.getMyProfile().then((p) => {
        if (p && p.username && $('setAccountSub')) {
          $('setAccountSub').textContent = (email ? email + '  ·  ' : '') + '@' + p.username;
        }
      }).catch(() => {});
    }
  }
  if ($('setVersion') && $('appVersion')) $('setVersion').textContent = $('appVersion').textContent;
  // Vollbild-Screen einblenden (wie Termine-Tab)
  document.body.classList.remove('editor-open', 'search-open', 'termine-open');
  document.body.classList.add('settings-open');
  setActiveTab('settings');
}
function closeSettings() { document.body.classList.remove('settings-open'); }
$('setThemeRow').onclick = () => { $('themeToggle').click(); openSettings(); };
$('setLangRow').onclick = () => { if ($('langToggle')) $('langToggle').click(); openSettings(); };
$('setAccountRow').onclick = () => { $('accountBtn').click(); };

// ---- Suche schließen / Tastatur wegtippen ----
if ($('searchClose')) $('searchClose').onclick = () => {
  const s = $('searchInput');
  if (s) { s.value = ''; s.dispatchEvent(new Event('input')); s.blur(); }
  document.body.classList.remove('search-open');
  setActiveTab('notes');
};
if ($('searchInput')) $('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } // Enter schließt die Tastatur
});
$('scrim').onclick = () => setNav(false);
$('backBtn').onclick = () => {
  document.body.classList.remove('editor-open');
  // Plus gedrückt, nichts eingegeben, zurück → leere Notiz gar nicht erst behalten.
  if (activeNoteId && discardIfEmpty(activeNoteId)) {
    closeEditor();
    renderAll();
  }
};

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    newNote();
  }
});
