let data = { notes: [], folders: [] };
let filter = 'open';

// Kern-Aliase (plattformunabhängig, siehe src/core/)
const { uid, deriveStatus, applyAutoStatus, escapeHtml, makeNote } = NZ;
const STATUS_ORDER = NZ.STATUS_ORDER;

const $ = (id) => document.getElementById(id);
const listEl = $('wList');

async function refresh() {
  data = await NZStore.load();
  render();
}

function persist() {
  NZStore.save(data);
}

function visibleNotes() {
  let list = [...data.notes];
  if (filter === 'open') list = list.filter((n) => deriveStatus(n) !== 'done');
  else if (filter === 'done') list = list.filter((n) => deriveStatus(n) === 'done');
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function render() {
  const list = visibleNotes();
  listEl.innerHTML = '';
  $('wEmpty').classList.toggle('hidden', list.length > 0);

  list.forEach((n) => {
    const status = deriveStatus(n);
    const subs = n.subtasks || [];
    const hasSubs = subs.length > 0;

    const li = document.createElement('li');
    li.className = 'w-note';

    // main note row
    const row = document.createElement('div');
    row.className = 'w-row' + (status === 'done' ? ' is-done' : '');
    const doneCount = subs.filter((s) => (s.status || 'todo') === 'done').length;
    row.innerHTML = `
      <span class="w-dot ${status}" title="${hasSubs ? 'Status aus Teilaufgaben' : 'Status wechseln'}"></span>
      <span class="w-name">${escapeHtml(n.title) || 'Ohne Titel'}</span>
      ${hasSubs ? `<span class="w-count">${doneCount}/${subs.length}</span>` : ''}`;
    row.querySelector('.w-dot').onclick = (e) => {
      e.stopPropagation();
      if (!hasSubs) cycleStatus(n.id);
    };
    row.onclick = () => window.api.openFull();
    li.appendChild(row);

    // subtask rows
    subs.forEach((st) => {
      const sStatus = st.status || 'todo';
      const sub = document.createElement('div');
      sub.className = 'w-subrow' + (sStatus === 'done' ? ' is-done' : '');
      sub.innerHTML = `
        <span class="w-dot sm ${sStatus}" title="Status wechseln"></span>
        <span class="w-subname">${escapeHtml(st.text) || ''}</span>`;
      sub.querySelector('.w-dot').onclick = (e) => {
        e.stopPropagation();
        cycleSubtask(n.id, st.id);
      };
      li.appendChild(sub);
    });

    listEl.appendChild(li);
  });
}

function cycleStatus(id) {
  const note = data.notes.find((n) => n.id === id);
  if (!note) return;
  if ((note.subtasks || []).length) return; // auto-derived, not manual
  note.status = STATUS_ORDER[(STATUS_ORDER.indexOf(note.status || 'todo') + 1) % STATUS_ORDER.length];
  note.updatedAt = Date.now();
  persist();
  render();
}

function cycleSubtask(noteId, stId) {
  const note = data.notes.find((n) => n.id === noteId);
  if (!note) return;
  const st = (note.subtasks || []).find((s) => s.id === stId);
  if (!st) return;
  st.status = STATUS_ORDER[(STATUS_ORDER.indexOf(st.status || 'todo') + 1) % STATUS_ORDER.length];
  applyAutoStatus(note);
  note.updatedAt = Date.now();
  persist();
  render();
}

function quickAdd(title) {
  const t = title.trim();
  if (!t) return;
  data.notes.unshift(makeNote({ title: t }));
  persist();
  render();
}

// ---- Events ----
$('pinBtn').onclick = async () => {
  const pinned = await window.api.togglePin();
  $('pinBtn').classList.toggle('pinned', pinned);
};
$('openBtn').onclick = () => window.api.openFull();
$('closeBtn').onclick = () => window.api.closeWidget();

$('wAddInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    quickAdd(e.target.value);
    e.target.value = '';
  }
});

document.querySelectorAll('.w-filter button').forEach((btn) => {
  btn.onclick = () => {
    filter = btn.dataset.filter;
    document.querySelectorAll('.w-filter button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    render();
  };
});

NZStore.onChanged(() => refresh());

(async function init() {
  const pinned = await window.api.isPinned();
  $('pinBtn').classList.toggle('pinned', pinned);
  refresh();
})();
