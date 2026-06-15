// ---- State ----
let data = { notes: [], folders: [] };
let activeNoteId = null;
let currentFolder = '__all__';
let currentTag = null;
let currentStatus = 'all';
let searchTerm = '';
let saveTimer = null;

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const noteListEl = $('noteList');
const folderListEl = $('folderList');
const tagListEl = $('tagList');
const editorEl = $('editor');
const editorEmptyEl = $('editorEmpty');
const titleInput = $('titleInput');
const bodyInput = $('bodyInput');
const tagsInput = $('tagsInput');
const folderSelect = $('folderSelect');
const previewEl = $('preview');

// ---- Core aliases (plattformunabhängig, siehe src/core/) ----
const { uid, deriveStatus, applyAutoStatus, statusLabel, escapeHtml, stripMd, formatDate } = NZ;
const STATUS_ORDER = NZ.STATUS_ORDER;

// ---- Init ----
(async function init() {
  data = await NZStore.load();
  const theme = localStorage.getItem('theme') || 'dark';
  applyTheme(theme);
  renderAll();
})();

// Live-sync when another window/tab/device changes notes
NZStore.onChanged(async (info) => {
  data = await NZStore.load();
  renderAll();

  // Offene Notiz wurde gelöscht?
  if (activeNoteId && !data.notes.find((n) => n.id === activeNoteId)) {
    activeNoteId = null;
    leavePresence();
    editorEl.classList.add('hidden');
    editorEmptyEl.classList.remove('hidden');
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

  // Benachrichtigung, wenn Fenster nicht im Fokus ist.
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
}

// ---- Filtering ----
function filteredNotes() {
  let list = [...data.notes];
  if (currentFolder !== '__all__') {
    list = list.filter((n) => (n.folder || '') === currentFolder);
  }
  if (currentTag) {
    list = list.filter((n) => (n.tags || []).includes(currentTag));
  }
  if (currentStatus !== 'all') {
    list = list.filter((n) => (n.status || 'todo') === currentStatus);
  }
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    list = list.filter(
      (n) =>
        (n.title || '').toLowerCase().includes(q) ||
        (n.body || '').toLowerCase().includes(q) ||
        (n.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// ---- Rendering ----
function renderAll() {
  renderFolders();
  renderTags();
  renderFolderSelect();
  renderNoteList();
}

function renderFolders() {
  folderListEl.innerHTML = '';
  const items = [{ key: '__all__', label: 'Alle Notizen', icon: '✦' }];
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
      currentTag = null;
      renderAll();
    };
    if (it.key !== '__all__') {
      li.ondblclick = () => deleteFolder(it.key);
      li.title = 'Doppelklick zum Löschen';
    }
    folderListEl.appendChild(li);
  });
}

function renderTags() {
  const allTags = new Set();
  data.notes.forEach((n) => (n.tags || []).forEach((t) => allTags.add(t)));
  tagListEl.innerHTML = '';
  if (allTags.size === 0) {
    tagListEl.innerHTML = '<span style="font-size:11px;color:var(--text-faint);padding:4px 6px;">Noch keine Tags</span>';
    return;
  }
  [...allTags].sort().forEach((t) => {
    const li = document.createElement('li');
    li.className = 'tag-chip' + (currentTag === t ? ' active' : '');
    li.textContent = '#' + t;
    li.onclick = () => {
      currentTag = currentTag === t ? null : t;
      renderAll();
    };
    tagListEl.appendChild(li);
  });
}

function renderFolderSelect() {
  folderSelect.innerHTML = '<option value="">Kein Ordner</option>';
  data.folders.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    folderSelect.appendChild(opt);
  });
}

function renderNoteList() {
  const list = filteredNotes();
  $('noteCount').textContent = list.length;
  $('listTitle').textContent =
    currentTag ? '#' + currentTag : currentFolder === '__all__' ? 'Alle Notizen' : currentFolder;

  noteListEl.innerHTML = '';
  $('emptyList').classList.toggle('hidden', list.length > 0);

  list.forEach((n) => {
    const status = deriveStatus(n);
    const hasSubs = (n.subtasks || []).length > 0;
    const li = document.createElement('li');
    li.className = 'note-card status-' + status + (n.id === activeNoteId ? ' active' : '');
    const tagHtml = (n.tags || [])
      .slice(0, 2)
      .map((t) => `<span class="card-tag">#${escapeHtml(t)}</span>`)
      .join('');
    const subs = n.subtasks || [];
    const subDone = subs.filter((s) => (s.status || 'todo') === 'done').length;
    const subHtml = subs.length
      ? `<span class="card-sub">☑ ${subDone}/${subs.length}</span>`
      : '';
    const shareHtml = n.share && n.share.code ? '<span class="card-share">🔗</span>' : '';
    const snippet = escapeHtml(stripMd(n.body || ''));
    li.innerHTML = `
      <div class="card-title-row">
        <span class="dot dot-${status}" title="${statusLabel(status)}${hasSubs ? ' (aus Teilaufgaben)' : ' – Klick zum Wechseln'}"></span>
        <h3>${escapeHtml(n.title) || 'Ohne Titel'}</h3>
      </div>
      <div class="snippet">${snippet || (subs.length ? subs.map((s) => '• ' + escapeHtml(s.text)).join('  ') : 'Keine weiteren Inhalte')}</div>
      <div class="card-meta">${shareHtml}${subHtml}${tagHtml}<span>${formatDate(n.updatedAt)}</span></div>`;
    li.querySelector('.dot').onclick = (e) => {
      e.stopPropagation();
      if (hasSubs) {
        openNote(n.id); // status is auto from subtasks → open to edit them
      } else {
        cycleStatus(n.id);
      }
    };
    li.onclick = () => openNote(n.id);
    noteListEl.appendChild(li);
  });
}

// ---- Note actions ----
function newNote() {
  const note = {
    id: uid(),
    title: '',
    body: '',
    folder: currentFolder === '__all__' ? '' : currentFolder,
    tags: currentTag ? [currentTag] : [],
    status: currentStatus !== 'all' ? currentStatus : 'todo',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  data.notes.unshift(note);
  persist();
  openNote(note.id);
  renderAll();
  titleInput.focus();
}

function openNote(id) {
  const note = data.notes.find((n) => n.id === id);
  if (!note) return;
  activeNoteId = id;
  document.body.classList.add('editor-open'); // Handy: Editor-Ebene einblenden
  setNav(false);
  editorEmptyEl.classList.add('hidden');
  editorEl.classList.remove('hidden');
  titleInput.value = note.title || '';
  bodyInput.value = note.body || '';
  tagsInput.value = (note.tags || []).join(', ');
  folderSelect.value = note.folder || '';
  renderStatusRow(note.status || 'todo');
  renderSubtasks();
  updateSharedBadge(note);
  updatePresence(note);
  showEditMode();
  renderNoteList();
}

function currentNote() {
  return data.notes.find((n) => n.id === activeNoteId);
}

function scheduleSave() {
  const note = currentNote();
  if (!note) return;
  note.title = titleInput.value;
  note.body = bodyInput.value;
  note.folder = folderSelect.value;
  note.tags = tagsInput.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  note.updatedAt = Date.now();
  $('savedHint').textContent = 'Speichern…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persist();
    $('savedHint').textContent = 'Automatisch gespeichert ✓';
    renderFolders();
    renderTags();
    renderNoteList();
  }, 400);
}

function deleteNote() {
  const note = currentNote();
  if (!note) return;
  if (!confirm('Diese Notiz wirklich löschen?')) return;
  data.notes = data.notes.filter((n) => n.id !== note.id);
  activeNoteId = null;
  leavePresence();
  persist();
  editorEl.classList.add('hidden');
  editorEmptyEl.classList.remove('hidden');
  renderAll();
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
function renderSubtasks() {
  const note = currentNote();
  const listEl = $('subList');
  listEl.innerHTML = '';
  if (!note) return;
  if (!note.subtasks) note.subtasks = [];

  const noteShared = !!(note.share && note.share.code);
  note.subtasks.forEach((st) => {
    const status = st.status || 'todo';
    const li = document.createElement('li');
    li.className = 'sub-item' + (status === 'done' ? ' done' : '');
    li.innerHTML = `
      <span class="dot dot-${status}" title="${statusLabel(status)} – Klick zum Wechseln"></span>
      <input class="sub-text" type="text" value="" />
      ${noteShared ? whoBadge(st) : ''}
      <button class="sub-del" title="Teilaufgabe löschen">✕</button>`;
    const input = li.querySelector('.sub-text');
    input.value = st.text || '';
    li.querySelector('.dot').onclick = () => cycleSubtask(st.id);
    input.oninput = () => {
      st.text = input.value;
      note.updatedAt = Date.now();
      scheduleSubSave();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('subAddInput').focus();
      }
    };
    li.querySelector('.sub-del').onclick = () => deleteSubtask(st.id);
    listEl.appendChild(li);
  });

  applyAutoStatus(note);
  updateSubProgress(note);
  renderStatusRow(note.status || 'todo');
  $('sortBtn').classList.toggle('hidden', !(aiAvailable() && note.subtasks.length >= 2));
}

function updateSubProgress(note) {
  const subs = note.subtasks || [];
  const done = subs.filter((s) => (s.status || 'todo') === 'done').length;
  $('subProgress').textContent = subs.length ? `${done}/${subs.length} erledigt` : '';
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

function whoBadge(st) {
  if (!st.updatedBy) return '';
  const mine = st.updatedBy.id === NZDevice.getId();
  const who = mine ? 'du' : st.updatedBy.nickname || 'jemand';
  const color = st.updatedBy.color || 'var(--text-faint)';
  return `<span class="sub-who" style="color:${color}" title="zuletzt geändert von ${escapeHtml(who)}">● ${escapeHtml(who)}</span>`;
}

function deleteSubtask(stId) {
  const note = currentNote();
  if (!note) return;
  note.subtasks = note.subtasks.filter((s) => s.id !== stId);
  note.updatedAt = Date.now();
  applyAutoStatus(note);
  persist();
  renderSubtasks();
  renderNoteList();
}

// ---- Folders ----
function newFolder() {
  const name = prompt('Name des neuen Ordners:');
  if (!name || !name.trim()) return;
  const clean = name.trim();
  if (data.folders.includes(clean)) return;
  data.folders.push(clean);
  persist();
  renderAll();
}

function deleteFolder(name) {
  if (!confirm(`Ordner "${name}" löschen? (Notizen bleiben erhalten)`)) return;
  data.folders = data.folders.filter((f) => f !== name);
  data.notes.forEach((n) => {
    if (n.folder === name) n.folder = '';
  });
  if (currentFolder === name) currentFolder = '__all__';
  persist();
  renderAll();
}

// ---- Markdown / preview ----
function showEditMode() {
  bodyInput.classList.remove('hidden');
  previewEl.classList.add('hidden');
  $('previewToggle').classList.remove('active');
}

function togglePreview() {
  const isPreview = !previewEl.classList.contains('hidden');
  if (isPreview) {
    showEditMode();
  } else {
    previewEl.innerHTML = renderMarkdown(bodyInput.value);
    bodyInput.classList.add('hidden');
    previewEl.classList.remove('hidden');
    $('previewToggle').classList.add('active');
  }
}

function renderMarkdown(src) {
  let html = escapeHtml(src);
  html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');
  html = html.replace(/^[-*] (.*)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  html = html
    .split(/\n{2,}/)
    .map((block) =>
      /^\s*<(h1|h2|ul|li)/.test(block.trim()) ? block : `<p>${block.replace(/\n/g, '<br/>')}</p>`
    )
    .join('');
  return html;
}

function applyFormat(fmt) {
  const ta = bodyInput;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const sel = ta.value.slice(start, end);
  const wraps = {
    bold: ['**', '**'],
    italic: ['*', '*'],
    code: ['`', '`']
  };
  const lines = {
    h1: '# ',
    list: '- '
  };
  let newText;
  let cursor;
  if (wraps[fmt]) {
    const [a, b] = wraps[fmt];
    newText = ta.value.slice(0, start) + a + (sel || 'Text') + b + ta.value.slice(end);
    cursor = start + a.length + (sel || 'Text').length + b.length;
  } else if (lines[fmt]) {
    const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
    newText = ta.value.slice(0, lineStart) + lines[fmt] + ta.value.slice(lineStart);
    cursor = end + lines[fmt].length;
  }
  ta.value = newText;
  ta.focus();
  ta.setSelectionRange(cursor, cursor);
  scheduleSave();
}

// ---- Theme ----
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('themeToggle').textContent = theme === 'dark' ? '🌙 Dark' : '☀️ Light';
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
    alert('Teilen braucht Internet/Cloud. Sobald du online bist, wird die Notiz geteilt.');
    return;
  }
  showShareModal(true);
  renderShareState(note);
}

async function doShare() {
  const note = currentNote();
  if (!note || !cloudReady()) return;
  $('shareBusy').classList.remove('hidden');
  $('doShareBtn').disabled = true;
  try {
    await window.NZShare.shareNote(note);
    note.shared = true;
    persist();
    renderShareState(note);
    renderNoteList();
    updateSharedBadge(note);
  } catch (e) {
    alert('Teilen fehlgeschlagen: ' + (e.message || e));
  } finally {
    $('shareBusy').classList.add('hidden');
    $('doShareBtn').disabled = false;
  }
}

async function doUnshare() {
  const note = currentNote();
  if (!note || !cloudReady()) return;
  if (!confirm('Teilen beenden? Andere verlieren den Zugriff.')) return;
  try {
    await window.NZShare.unshareNote(note);
    note.shared = false;
    persist();
    renderShareState(note);
    renderNoteList();
    updateSharedBadge(note);
  } catch (e) {
    alert('Fehler: ' + (e.message || e));
  }
}

function updateSharedBadge(note) {
  const shared = !!(note && note.share && note.share.code);
  $('sharedBadge').classList.toggle('hidden', !shared);
  $('sharedBadge').textContent = shared
    ? (note.ownedByMe === false ? '🔗 Geteilt (von jemandem)' : '🔗 Geteilt · ' + note.share.code)
    : '';
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
  const dots = people
    .map((p) => `<span class="pres-dot" style="background:${p.color || '#888'}" title="${escapeHtml(p.nickname || '')}"></span>`)
    .join('');
  row.innerHTML = `${dots}<span class="pres-text">${people.length} online</span>`;
  row.classList.remove('hidden');
}

// Desktop-Benachrichtigung bei Änderung einer geteilten Notiz.
function notifyChange(title) {
  try {
    new Notification('NotizApp 🔗', {
      body: (title ? '„' + title + '" ' : 'Eine geteilte Notiz ') + 'wurde aktualisiert.'
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
    alert('Beitreten braucht Internet/Cloud.');
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
    renderAll();
    showJoinModal(false);
    openNote(noteId);
  } catch (e) {
    alert('Beitreten fehlgeschlagen: ' + (e.message || e));
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
    $('accountBtn').textContent = info.secured ? '✓ ' + info.email : '🔒 Notizen sichern';
    $('accountBtn').classList.toggle('secured', info.secured);
  } catch {}
}

function renderAuthMode() {
  const secured = $('accountBtn')._secured;
  const formIds = ['authEmail', 'authPassword', 'authSubmit'];
  if (secured) {
    $('authTitle').textContent = '✓ Notizen gesichert';
    $('authHint').classList.add('hidden');
    formIds.forEach((id) => $(id).classList.add('hidden'));
    document.querySelector('.auth-switch').classList.add('hidden');
    $('authSignedIn').classList.remove('hidden');
    $('authSignedInText').textContent =
      'Angemeldet als ' + ($('accountBtn')._email || '') + '. Deine Notizen sind gesichert und auf allen Geräten gleich.';
    return;
  }
  $('authHint').classList.remove('hidden');
  formIds.forEach((id) => $(id).classList.remove('hidden'));
  document.querySelector('.auth-switch').classList.remove('hidden');
  $('authSignedIn').classList.add('hidden');
  $('authError').classList.add('hidden');
  if (authMode === 'secure') {
    $('authTitle').textContent = '🔒 Notizen sichern';
    $('authHint').textContent =
      'Sichere deine Notizen mit E-Mail + Passwort. So bleiben sie dauerhaft erhalten – auch nach Neustart oder Neuinstallation – und sind auf allen deinen Geräten gleich.';
    $('authSubmit').textContent = 'Notizen sichern';
    $('authSwitchText').textContent = 'Schon ein Konto?';
    $('authSwitchLink').textContent = 'Anmelden';
  } else {
    $('authTitle').textContent = '⮕ Anmelden';
    $('authHint').textContent = 'Melde dich an, um deine gesicherten Notizen auf diesem Gerät zu laden.';
    $('authSubmit').textContent = 'Anmelden';
    $('authSwitchText').textContent = 'Noch kein Konto?';
    $('authSwitchLink').textContent = 'Notizen sichern';
  }
}

function openAuth() {
  if (!authAvailable()) {
    alert('Sichern braucht Internet/Cloud.');
    return;
  }
  authMode = 'secure';
  $('authEmail').value = '';
  $('authPassword').value = '';
  $('authError').classList.add('hidden');
  renderAuthMode();
  $('authModal').classList.remove('hidden');
}

function showAuthError(msg) {
  $('authError').textContent = msg;
  $('authError').classList.remove('hidden');
}

function translateAuthError(e) {
  const m = ((e && e.message) || '').toLowerCase();
  if (m.includes('registered')) return 'Diese E-Mail ist schon vergeben. Nutze unten „Anmelden".';
  if (m.includes('invalid login') || m.includes('credentials')) return 'E-Mail oder Passwort falsch.';
  if (m.includes('password')) return 'Passwort zu kurz (mind. 6 Zeichen).';
  if (m.includes('email')) return 'Bitte eine gültige E-Mail eingeben.';
  return 'Fehler: ' + ((e && e.message) || e);
}

async function submitAuth() {
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  if (!email || !password) return showAuthError('Bitte E-Mail und Passwort eingeben.');
  if (password.length < 6) return showAuthError('Passwort muss mind. 6 Zeichen haben.');
  $('authSubmit').disabled = true;
  try {
    if (authMode === 'secure') {
      await NZAuth.secureWithEmail(email, password);
      $('authModal').classList.add('hidden');
      await updateAccountUI();
      alert('✓ Notizen gesichert! Du kannst dich jetzt auf anderen Geräten mit dieser E-Mail anmelden.');
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
  if (!confirm('Abmelden? Auf diesem Gerät startest du dann wieder anonym.')) return;
  await NZAuth.signOutUser();
  location.reload();
}

// ---- KI (Liste erstellen / Einkauf sortieren) ----
function aiAvailable() {
  return !!(window.NZAI && NZAI.available() && NZStore.kind === 'supabase');
}

function createNoteFromAI(title, items) {
  const note = NZ.makeNote({
    title: title || 'Neue Liste',
    folder: currentFolder === '__all__' ? '' : currentFolder,
    tags: currentTag ? [currentTag] : []
  });
  note.subtasks = (items || []).map((t) => NZ.makeSubtask(t, NZDevice.me()));
  applyAutoStatus(note);
  data.notes.unshift(note);
  persist();
  renderAll();
  openNote(note.id);
}

async function aiGenerate() {
  const prompt = $('aiInput').value.trim();
  if (!prompt) return;
  $('aiSubmit').disabled = true;
  const oldT = $('aiSubmit').textContent;
  $('aiSubmit').textContent = '✨ Erstelle…';
  $('aiError').classList.add('hidden');
  try {
    const res = await NZAI.generate(prompt);
    $('aiModal').classList.add('hidden');
    createNoteFromAI(res.title, res.items);
  } catch (e) {
    $('aiError').textContent = 'Fehler: ' + (e.message || e);
    $('aiError').classList.remove('hidden');
  } finally {
    $('aiSubmit').disabled = false;
    $('aiSubmit').textContent = oldT;
  }
}

async function aiSort() {
  const note = currentNote();
  if (!note || !(note.subtasks || []).length) return;
  const btn = $('sortBtn');
  btn.disabled = true;
  const oldT = btn.textContent;
  btn.textContent = '✨ …';
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
    alert('Sortieren fehlgeschlagen: ' + (e.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = oldT;
  }
}

// ---- Events ----
$('newNoteBtn').onclick = newNote;
$('fabNew').onclick = newNote;
$('aiBtn').onclick = () => {
  $('aiInput').value = '';
  $('aiError').classList.add('hidden');
  $('aiModal').classList.remove('hidden');
  setTimeout(() => $('aiInput').focus(), 50);
};
$('aiClose').onclick = () => $('aiModal').classList.add('hidden');
$('aiSubmit').onclick = aiGenerate;
$('aiInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') aiGenerate();
});
$('sortBtn').onclick = aiSort;
$('aiModal').addEventListener('click', (e) => {
  if (e.target === $('aiModal')) $('aiModal').classList.add('hidden');
});
$('newFolderBtn').onclick = newFolder;
$('deleteBtn').onclick = deleteNote;
$('previewToggle').onclick = togglePreview;
$('themeToggle').onclick = () =>
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

titleInput.oninput = scheduleSave;
bodyInput.oninput = scheduleSave;
tagsInput.oninput = scheduleSave;
folderSelect.onchange = scheduleSave;

$('searchInput').oninput = (e) => {
  searchTerm = e.target.value;
  renderNoteList();
};

function submitSubtask() {
  const inp = $('subAddInput');
  addSubtask(inp.value);
  inp.value = '';
  inp.focus(); // gleich die nächste eingeben können
}
$('subAddInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitSubtask();
});
$('subAddBtn').onclick = submitSubtask;

document.querySelectorAll('.editor-toolbar [data-fmt]').forEach((btn) => {
  btn.onclick = () => applyFormat(btn.dataset.fmt);
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
      if ((e.message || '') !== 'no-scanner') alert('Scan abgebrochen oder fehlgeschlagen.');
    }
  };
}

// Tiefen-Link notizapp://join?code=… → Dialog öffnen + automatisch beitreten
if (window.NZNative && NZNative.isNative()) {
  NZNative.onDeepLink((code) => {
    showJoinModal(true);
    $('joinInput').value = code;
    doJoin();
  });

  // Push registrieren – ABER nur wenn Firebase eingerichtet ist (sonst nativer Absturz).
  if (window.NZ_CONFIG && NZ_CONFIG.PUSH) {
    NZStore.ready.then(() => {
      NZNative.registerPush((token) => {
        if (window.NZShare && NZShare.savePushToken) NZShare.savePushToken(token, 'android');
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
    btn.textContent = 'Kopiert ✓';
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
NZStore.ready.then(async () => {
  await updateAccountUI();
  if (window.NZAI && NZAI.available() && NZStore.kind === 'supabase') {
    $('aiBtn').classList.remove('hidden');
  }
  // Falls von iOS abgemeldet, aber E-Mail bekannt → freundlich zum Anmelden auffordern
  const remembered = window.NZAuth && NZAuth.lastEmail ? NZAuth.lastEmail() : null;
  if (authAvailable() && !$('accountBtn')._secured && remembered) {
    authMode = 'signin';
    $('authEmail').value = remembered;
    $('authPassword').value = '';
    renderAuthMode();
    $('authHint').textContent =
      'Willkommen zurück! Melde dich an, um deine gesicherten Notizen zu laden.';
    $('authModal').classList.remove('hidden');
    setTimeout(() => $('authPassword').focus(), 150);
  }
});

// ---- Handy-Navigation ----
function setNav(open) {
  document.body.classList.toggle('nav-open', open);
  $('scrim').classList.toggle('hidden', !open);
}
$('menuBtn').onclick = () => setNav(!document.body.classList.contains('nav-open'));
$('scrim').onclick = () => setNav(false);
$('backBtn').onclick = () => document.body.classList.remove('editor-open');

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    newNote();
  }
  if ((e.ctrlKey || e.metaKey) && document.activeElement === bodyInput) {
    if (e.key === 'b') { e.preventDefault(); applyFormat('bold'); }
    if (e.key === 'i') { e.preventDefault(); applyFormat('italic'); }
  }
});
