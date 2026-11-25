import { schedule, bucket, pack, unpack, dayNumber, dateOfDay, newCardOrder, AGAIN } from './srs.js';
import {
  KEYS, emptyProgress, loadProgress, saveProgress, loadSettings, saveSettings,
  sanitizeProgress, sanitizeSettings, requestPersistence,
} from './store.js';
import {
  DECK, STRINGS, STRING_NAME, isNatural, noteName, shortName, sharpName, flatName,
  placeName, pitchName, ordinal, unisons, sameNote, LETTERS, NATURALS,
} from './notes.js';
import { drawFretboard } from './fretboard.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const nf = new Intl.NumberFormat('en');

// ───────── State ─────────
const deck = DECK;
const byId = new Map(deck.map((c, i) => [c.id, i]));
let settings = loadSettings();
let progress = emptyProgress();
let today = dayNumber();
let queue = [];            // [{ id: deck index, kind: 'new' | 'learning' | 'review' }]
let flipped = false;

let undoState = null;

const cardState = (i) => progress.cards[deck[i].id];
const active = (i) => {
  const c = deck[i];
  return c.f <= settings.frets && settings.strings.includes(c.s) && (settings.accidentals || isNatural(c.pc));
};
const activeCount = () => deck.reduce((n, _, i) => n + (active(i) ? 1 : 0), 0);

// Narrow (portrait phone) screens get a chunkier neck on cards, and a vertical,
// scrolling one on the Neck tab.
const narrow = matchMedia('(max-width: 34rem)');

// ───────── Boot ─────────
function init() {
  wireEvents();
  progress = loadProgress();
  fillSettingsForm();
  buildKeys();
  startSession();
  route();
  registerServiceWorker();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW registration failed', err));
  }
}

// ───────── Session / queue ─────────
function ensureToday() {
  today = dayNumber();
  if (progress.daily.day !== today) {
    progress.daily = { day: today, new: 0, rev: 0, done: 0, extra: 0 };
  }
}

function startSession() {
  ensureToday();
  undoState = null;
  const { daily } = progress;
  const learning = [];
  const due = [];
  for (const [id, c] of Object.entries(progress.cards)) {
    const i = byId.get(id);
    if (i === undefined || !active(i)) continue;
    if (c[0] === 0) learning.push(i);
    else if (c[2] <= today) due.push(i);
  }
  due.sort((a, b) => cardState(a)[2] - cardState(b)[2] || a - b);
  due.length = Math.min(due.length, Math.max(0, settings.maxReviews - daily.rev));

  const fresh = pickNew(Math.max(0, settings.newPerDay + daily.extra - daily.new));

  // Spread new cards evenly among the reviews so a session doesn't front-load them.
  const mixed = due.map((id) => ({ id, kind: 'review' }));
  const gap = (mixed.length + fresh.length) / (fresh.length || 1);
  fresh.forEach((id, k) => mixed.splice(Math.min(mixed.length, Math.round(k * gap)), 0, { id, kind: 'new' }));

  queue = [...learning.map((id) => ({ id, kind: 'learning' })), ...mixed];
  renderStudy();
}

const orderCache = {};

/** The next `count` unseen cards that are being studied, in the chosen order. */
function pickNew(count) {
  if (count <= 0) return [];
  const order = (orderCache[settings.order] ??= newCardOrder(settings.order, deck));
  const picked = [];
  for (const i of order) {
    if (cardState(i) || !active(i)) continue;
    picked.push(i);
    if (picked.length === count) break;
  }
  return picked;
}

const unseenCount = () => deck.reduce((n, c, i) => n + (active(i) && !progress.cards[c.id] ? 1 : 0), 0);

function answer(rating) {
  const item = queue[0];
  if (!item || !flipped) return;
  ensureToday();
  const key = deck[item.id].id;
  const prev = progress.cards[key];
  undoState = {
    key,
    prev: prev ? [...prev] : null,
    daily: { ...progress.daily },
    logged: progress.log[today] ?? 0,
    queue: queue.map((q) => ({ ...q })),
  };

  const next = schedule(unpack(prev), rating, today, settings.pace);
  progress.cards[key] = pack(next);
  if (!prev) progress.daily.new += 1;
  else if (prev[0] > 0) progress.daily.rev += 1;
  progress.log[today] = (progress.log[today] ?? 0) + 1;

  queue.shift();
  if (next.i === 0) {
    // Forgotten: show it again a few cards later in this same session.
    queue.splice(Math.min(queue.length, 4), 0, { id: item.id, kind: 'learning' });
  } else {
    progress.daily.done += 1;
  }
  persist();
  if (rating !== AGAIN) requestPersistence();
  renderStudy();
}

function undo() {
  if (!undoState) return;
  const u = undoState;
  if (u.prev) progress.cards[u.key] = u.prev;
  else delete progress.cards[u.key];
  progress.daily = u.daily;
  if (u.logged) progress.log[today] = u.logged;
  else delete progress.log[today];
  queue = u.queue;
  undoState = null;
  persist();
  renderStudy();
}

function persist() {
  if (!saveProgress(progress)) toast('Could not save — browser storage is unavailable.');
}

// ───────── Study view ─────────
/** Big note name: "C", or "C♯" with "/ D♭" beside it. */
function fillName(target, pc) {
  target.replaceChildren(sharpName(pc));
  if (!isNatural(pc)) target.append(el('span', 'alt', ` / ${flatName(pc)}`));
}

function sameText(card) {
  const others = sameNote(card, settings.frets).length;
  const all = `Every ${noteName(card.pc)} on the neck is ringed (${others + 1} in all).`;
  const same = unisons(card, settings.frets);
  if (!same.length) return all;
  const where = same.map((c) => (c.f === 0 ? `open ${ordinal(c.s)} string` : `${ordinal(c.s)} string ${ordinal(c.f)} fret`));
  return `${all} Solid rings are the very same pitch, ${pitchName(card.midi)}: ${where.join(', ')}.`;
}

function answerMarks(card) {
  return [
    ...sameNote(card, settings.frets).map((c) => ({
      s: c.s, f: c.f, type: 'same', label: shortName(c.pc), cls: c.midi === card.midi ? 'unison' : '',
    })),
    { s: card.s, f: card.f, type: 'answer', label: shortName(card.pc) },
  ];
}

function drawCard(card) {
  const base = { frets: settings.frets, thick: narrow.matches, wood: settings.wood, numbers: true };
  drawFretboard($('fb-front'), { ...base, marks: [{ s: card.s, f: card.f, type: 'target' }] });
  drawFretboard($('fb-back'), { ...base, names: true, marks: answerMarks(card) });
}

function renderStudy() {
  const item = queue[0];
  $('undo').hidden = !undoState;
  $('session').hidden = !item;
  $('done').hidden = !!item;
  if (!item) return renderDone();

  const count = (kind) => queue.filter((q) => q.kind === kind).length;
  $('count-new').textContent = count('new');
  $('count-learning').textContent = count('learning');
  $('count-review').textContent = count('review');
  const bar = $('session-bar');
  bar.max = progress.daily.done + queue.length;
  bar.value = progress.daily.done;

  const card = deck[item.id];
  const node = $('card');

  // Reset to the front without animating (which would flash the next answer).
  node.classList.add('instant');

  setFlipped(false);
  drawCard(card);
  fillName($('name'), card.pc);
  $('where').textContent = placeName(card);
  $('same').textContent = sameText(card);
  $('badge-new').hidden = item.kind !== 'new';
  void node.offsetWidth;
  node.classList.remove('instant');
  if (!reducedMotion.matches) {
    node.animate(
      [{ opacity: 0, transform: 'translateY(14px) scale(0.98)' }, { opacity: 1, transform: 'none' }],
      { duration: 240, easing: 'ease-out' },
    );
  }

  const current = unpack(cardState(item.id));
  for (const btn of document.querySelectorAll('.rate')) {
    const next = schedule(current, +btn.dataset.rating, today, settings.pace);
    btn.querySelector('small').textContent = fmtInterval(next.i);
  }
}

function fmtInterval(days) {
  const f = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
  if (days <= 0) return 'today';
  if (days < 30) return `${days} d`;
  if (days < 365) return `${f.format(days / 30)} mo`;
  return `${f.format(days / 365)} y`;
}

function setFlipped(value) {
  flipped = value;
  // Don't leave focus on a button that is about to be hidden, or the next
  // Space press would be swallowed by it instead of revealing the next card.
  const focusOut = value ? $('pick') : $('ratings');
  if (focusOut.contains(document.activeElement)) document.activeElement.blur();
  $('card').classList.toggle('flipped', value);
  $('face-front').inert = value;
  $('face-back').inert = !value;
  $('pick').hidden = value;
  $('ratings').hidden = !value;
}

/** Flip the card; `pc` is the note the learner picked, if they picked one. */
function reveal(pc = null) {
  const item = queue[0];
  if (!item || flipped) return;
  const card = deck[item.id];

  const verdict = $('verdict');
  verdict.hidden = pc === null;
  if (pc !== null) {
    const right = pc === card.pc;
    verdict.className = `verdict ${right ? 'right' : 'wrong'}`;
    verdict.textContent = right ? '✓ Right' : `✗ You picked ${noteName(pc)}`;
  }
  setFlipped(true);
  const focus = pc !== null && pc !== card.pc ? '.rate-1' : '.rate-3';
  $('ratings').querySelector(focus).focus({ preventScroll: true });
}

// The note keys under the card: seven naturals, with the sharps and flats above
// them where a piano has its black keys.
function buildKeys() {
  const keys = $('keys');
  keys.classList.toggle('chromatic', settings.accidentals);
  const pcs = settings.accidentals ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : NATURALS;
  keys.replaceChildren(...pcs.map((pc) => {
    const btn = el('button', isNatural(pc) ? 'key white' : 'key black');
    btn.type = 'button';
    btn.dataset.pc = pc;
    btn.style.setProperty('--col', KEY_COLUMN[pc]);
    if (isNatural(pc)) btn.textContent = sharpName(pc);
    else btn.append(el('span', '', sharpName(pc)), el('span', '', flatName(pc)));
    btn.setAttribute('aria-label', noteName(pc));
    return btn;
  }));
}
// Grid column (of 14 half-columns) where each key starts.
const KEY_COLUMN = { 0: 1, 2: 3, 4: 5, 5: 7, 7: 9, 9: 11, 11: 13, 1: 2, 3: 4, 6: 8, 8: 10, 10: 12 };

function renderDone() {
  const tomorrow = Object.entries(progress.cards)
    .filter(([id, c]) => byId.has(id) && active(byId.get(id)) && c[0] > 0 && c[2] <= today + 1).length;
  const unseen = unseenCount();
  $('done-today').textContent = progress.daily.done;
  $('done-streak').textContent = streak();
  $('done-tomorrow').textContent = tomorrow + Math.min(settings.newPerDay, unseen);
  const extra = Math.min(unseen, Math.max(5, settings.newPerDay));
  $('more').hidden = unseen === 0;
  $('more').textContent = `Learn ${extra} more new note${extra === 1 ? '' : 's'}`;
  $('more').dataset.extra = extra;
  $('done-sub').textContent = unseen === 0
    ? 'You have seen every note you’re studying! Add frets, strings, or sharps and flats in Settings for more.'
    : 'Nice work. Come back tomorrow to keep your memory fresh.';
}

function streak() {
  let day = progress.log[today] ? today : today - 1;
  let n = 0;
  while (progress.log[day]) { n += 1; day -= 1; }
  return n;
}

// ───────── Neck view ─────────
const BUCKETS = { new: 'Not seen', learning: 'Learning', young: 'Young', mature: 'Mastered' };

function renderNeck() {
  const filter = $('note-filter').value;
  const hideNames = document.querySelector('input[name="labels"]:checked')?.value === 'hidden';
  const marks = [];
  deck.forEach((c, i) => {
    if (c.f > settings.frets) return;
    const on = active(i);
    const b = bucket(unpack(cardState(i)));
    const match = filter === 'all' || +filter === c.pc;
    marks.push({
      s: c.s, f: c.f, type: 'status', id: c.id,
      label: hideNames && filter === 'all' ? '' : shortName(c.pc),
      small: !on || !match,
      cls: `b-${b}${on ? '' : ' off'}${match ? '' : ' dim'}`,
      title: `${noteName(c.pc)}: ${placeName(c)}. ${on ? BUCKETS[b] : 'Not being studied'}`,
    });
  });
  drawFretboard($('fb-neck'), { frets: settings.frets, vertical: narrow.matches, thick: true, wood: settings.wood, names: true, marks });
  $('neck-legend').replaceChildren(...['new', 'learning', 'young', 'mature'].map((b) => {
    const li = el('li');
    li.append(el('span', `dot b-${b}`), BUCKETS[b]);
    return li;
  }));
}

function openPreview(i) {
  const c = deck[i];
  drawFretboard($('fb-preview'), { frets: settings.frets, thick: narrow.matches, wood: settings.wood, names: true, marks: answerMarks(c) });
  fillName($('preview-name'), c.pc);
  $('preview-where').textContent = placeName(c);
  $('preview-same').textContent = sameText(c);
  const s = unpack(cardState(i));
  let status = BUCKETS[bucket(s)];
  if (s && s.i > 0) {
    const days = s.d - today;
    status += days <= 0 ? ' · due today' : ` · next review in ${fmtInterval(days)}`;
  }
  if (!active(i)) status += ' · not being studied';
  $('preview-status').textContent = status;
  $('preview').showModal();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// ───────── Progress view ─────────
function renderProgress() {
  const counts = { new: 0, learning: 0, young: 0, mature: 0 };
  const perString = Object.fromEntries(STRINGS.map((s) => [s, { total: 0, learned: 0 }]));
  const forecast = new Array(14).fill(0);
  deck.forEach((card, i) => {
    if (!active(i)) return;
    const c = unpack(cardState(i));
    const b = bucket(c);
    counts[b] += 1;
    perString[card.s].total += 1;
    if (b === 'young' || b === 'mature') perString[card.s].learned += 1;
    if (c) {
      const offset = Math.max(0, c.d - today);
      if (offset < 14) forecast[offset] += 1;
    }
  });
  const reviews = Object.values(progress.log).reduce((a, b) => a + b, 0);
  $('st-streak').textContent = nf.format(streak());
  $('st-learned').textContent = nf.format(counts.young + counts.mature);
  $('st-mature').textContent = nf.format(counts.mature);
  $('st-reviews').textContent = nf.format(reviews);

  const order = ['mature', 'young', 'learning', 'new'];
  $('mastery-bar').replaceChildren(...order.filter((b) => counts[b]).map((b) => {
    const seg = el('span', `b-${b}`);
    seg.style.flexGrow = counts[b];
    return seg;
  }));
  $('mastery-legend').replaceChildren(...order.map((b) => {
    const li = el('li');
    li.append(el('span', `dot b-${b}`), BUCKETS[b], el('b', '', nf.format(counts[b])));
    return li;
  }));

  $('string-bars').replaceChildren(...STRINGS.map((s) => {
    const { total, learned } = perString[s];
    const li = el('li');
    const label = el('span', 'label', `${ordinal(s)} string · ${STRING_NAME[s]}`);
    if (!settings.strings.includes(s)) label.append(el('span', 'paused', 'paused'));
    const meter = el('span', 'meter');
    const fill = el('span');
    fill.style.inlineSize = `${(learned / Math.max(1, total)) * 100}%`;
    meter.append(fill);
    li.append(label, el('b', '', `${nf.format(learned)} / ${nf.format(total)}`), meter);
    return li;
  }));

  const peak = Math.max(1, ...forecast);
  const dayFmt = new Intl.DateTimeFormat('en', { weekday: 'narrow' });
  const fullFmt = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' });
  $('forecast').replaceChildren(...forecast.map((n, k) => {
    const date = dateOfDay(today + k);
    const li = el('li');
    li.setAttribute('aria-label', `${fullFmt.format(date)}: ${n}`);
    const col = el('span', 'col');
    col.style.setProperty('--v', n / peak);
    const num = el('span', 'n', n || '');
    const day = el('span', 'day', dayFmt.format(date));
    num.ariaHidden = day.ariaHidden = 'true';
    li.append(num, col, day);
    return li;
  }));
}

// ───────── Routing ─────────
const VIEWS = ['study', 'neck', 'progress'];
const currentView = () => (VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'study');

function route() {
  const name = currentView();
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (name === 'neck') renderNeck();
  if (name === 'progress') renderProgress();
  if (name === 'study' && dayNumber() !== today) startSession();
}

function refreshAll() {
  startSession();
  route();
}

// ───────── Theme ─────────
const schemeMeta = document.querySelector('meta[name="color-scheme"]');
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function setScheme(value) {
  schemeMeta.content = value;
  try {
    // Saved even when it's System: with nothing saved, the app starts in Light.
    localStorage.setItem(KEYS.scheme, JSON.stringify(value));
  } catch { /* theme still applies for this visit */ }
  syncSchemeControl();
}

function syncSchemeControl() {
  const value = ['light', 'dark'].includes(schemeMeta.content) ? schemeMeta.content : 'light dark';
  for (const input of document.querySelectorAll('input[name="scheme"]')) input.checked = input.value === value;
}

function updateSchemeLabel() {
  $('scheme-system').textContent = `System (currently ${darkQuery.matches ? 'dark' : 'light'})`;
}

// ───────── Settings ─────────
function fillSettingsForm() {
  if (!$('string-checks').children.length) {
    $('string-checks').replaceChildren(...STRINGS.map((s) => {
      const label = el('label', 'string-check');
      const input = el('input');
      input.type = 'checkbox';
      input.name = 'string';
      input.value = s;
      label.title = `${ordinal(s)} string (${STRING_NAME[s]})`;
      label.append(input, el('b', '', s), el('span', '', s === 1 ? 'e' : { 6: 'E', 5: 'A', 4: 'D', 3: 'G', 2: 'B' }[s]));
      return label;
    }));
    $('note-filter').append(...Array.from({ length: 12 }, (_, pc) => {
      const o = el('option', '', `Every ${noteName(pc)}`);
      o.value = pc;
      return o;
    }));
  }
  for (const input of document.querySelectorAll('input[name="string"]')) input.checked = settings.strings.includes(+input.value);
  $('frets').value = settings.frets;
  $('accidentals').checked = settings.accidentals;
  for (const input of document.querySelectorAll('input[name="wood"]')) input.checked = input.value === settings.wood;
  $('newPerDay').value = settings.newPerDay;
  $('maxReviews').value = settings.maxReviews;
  for (const input of document.querySelectorAll('input[name="order"]')) input.checked = input.value === settings.order;
  $('pace').value = String(settings.pace);
  syncSchemeControl();
  updateSchemeLabel();
}

function updateSettings(patch) {
  settings = sanitizeSettings({ ...settings, ...patch });
  if (!saveSettings(settings)) toast('Could not save — browser storage is unavailable.');
}

/** Settings that change which cards are studied or how the neck looks. */
function settingsChanged() {
  buildKeys();
  refreshAll();
}

function exportBackup() {
  const blob = new Blob(
    [JSON.stringify({ app: 'frets', v: 1, exportedAt: new Date().toISOString(), settings, progress })],
    { type: 'application/json' },
  );
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `frets-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Backup downloaded.');
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data?.app !== 'frets' || typeof data.progress?.cards !== 'object') throw new Error('shape');
    progress = sanitizeProgress(data.progress, new Set(byId.keys()));
    persist();
    if (data.settings) {
      updateSettings(data.settings);
      fillSettingsForm();
    }
    settingsChanged();
    toast('Backup restored.');
  } catch {
    toast('That file is not a valid backup.');
  }
}

let toastTimer;
function toast(message, ms = 2600) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), ms);
}

// ───────── Events ─────────
function wireEvents() {
  addEventListener('hashchange', route);

  // Study
  $('card').addEventListener('click', (e) => { if (!e.target.closest('button')) reveal(); });
  $('show').addEventListener('click', () => reveal());
  $('keys').addEventListener('click', (e) => {
    const key = e.target.closest('.key');
    if (key) reveal(+key.dataset.pc);
  });
  $('ratings').addEventListener('click', (e) => {
    const btn = e.target.closest('.rate');
    if (btn) answer(+btn.dataset.rating);
  });
  $('undo').addEventListener('click', undo);
  $('more').addEventListener('click', () => {
    progress.daily.extra += +$('more').dataset.extra;
    persist();
    startSession();
  });

  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if ($('view-study').hidden || document.querySelector('dialog[open]')) return;
    if (e.target.closest('input, select, textarea')) return;
    const control = e.target.closest('button, a');
    const onButton = control && (control.checkVisibility?.() ?? true);
    const key = e.key.toLowerCase();
    if ((e.key === ' ' || e.key === 'Enter') && !flipped && !onButton) { e.preventDefault(); reveal(); }
    else if (!flipped && key in LETTERS && queue[0]) {
      // A letter names a natural note; with Shift, the sharp above it.
      let pc = LETTERS[key];
      if (e.shiftKey) {
        if (!settings.accidentals || pc === 4 || pc === 11) return;
        pc += 1;
      }
      e.preventDefault();
      reveal(pc);
    } else if (flipped && e.key >= '1' && e.key <= '4') { e.preventDefault(); answer(+e.key); }
    else if (key === 'z' && undoState) undo();
  });

  // Redraw the card when it switches between a vertical and a horizontal neck.
  narrow.addEventListener('change', () => {
    if (queue[0]) drawCard(deck[queue[0].id]);
    if (currentView() === 'neck') renderNeck();
  });

  // Neck
  $('note-filter').addEventListener('change', renderNeck);
  $('label-mode').addEventListener('change', renderNeck);
  const openFromNeck = (e) => {
    const mark = e.target.closest('.fb-mark[data-id]');
    if (mark) openPreview(byId.get(mark.dataset.id));
  };
  $('fb-neck').addEventListener('click', openFromNeck);
  $('fb-neck').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFromNeck(e); }
  });

  // Settings
  $('string-checks').addEventListener('change', (e) => {
    const chosen = [...document.querySelectorAll('input[name="string"]:checked')].map((i) => +i.value);
    if (!chosen.length) {
      e.target.checked = true;
      toast('Keep at least one string.');
      return;
    }
    updateSettings({ strings: chosen });
    settingsChanged();
  });
  $('frets').addEventListener('change', (e) => {
    updateSettings({ frets: e.target.value });
    e.target.value = String(settings.frets);
    settingsChanged();
  });
  $('accidentals').addEventListener('change', (e) => {
    updateSettings({ accidentals: e.target.checked });
    settingsChanged();
  });
  $('wood').addEventListener('change', (e) => {
    updateSettings({ wood: e.target.value });
    if (queue[0]) drawCard(deck[queue[0].id]);
    if (currentView() === 'neck') renderNeck();
  });
  $('scheme').addEventListener('change', (e) => setScheme(e.target.value));
  darkQuery.addEventListener('change', updateSchemeLabel);
  $('order').addEventListener('change', (e) => {
    updateSettings({ order: e.target.value });
    refreshAll();
  });
  for (const id of ['newPerDay', 'maxReviews', 'pace']) {
    $(id).addEventListener('change', (e) => {
      updateSettings({ [id]: e.target.value });
      e.target.value = String(settings[id]);
      refreshAll();
    });
  }
  $('export').addEventListener('click', exportBackup);
  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importBackup(file);
    e.target.value = '';
  });
  $('reset').addEventListener('close', (e) => {
    const confirmed = e.target.returnValue === 'reset';
    e.target.returnValue = '';
    if (!confirmed) return;
    progress = emptyProgress();
    persist();
    refreshAll();
    toast('Progress erased.');
  });

  // Stay in sync with other tabs, and roll over to a new day while left open.
  addEventListener('storage', (e) => {
    if (e.key === KEYS.scheme) {
      try { schemeMeta.content = JSON.parse(e.newValue) ?? 'light'; } catch { schemeMeta.content = 'light'; }
      syncSchemeControl();
    }
    if (e.key === KEYS.progress) { progress = loadProgress(); refreshAll(); }
    if (e.key === KEYS.settings) { settings = loadSettings(); fillSettingsForm(); settingsChanged(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && dayNumber() !== today) refreshAll();
  });

  syncSchemeControl();
  updateSchemeLabel();
  wireDialogFallbacks();
  wireInstall();
}

// Invoker commands and closedby are progressive enhancements; cover browsers without them.
function wireDialogFallbacks() {
  if (!('commandForElement' in HTMLButtonElement.prototype)) {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button[commandfor]');
      const target = btn && document.getElementById(btn.getAttribute('commandfor'));
      if (!(target instanceof HTMLDialogElement)) return;
      if (btn.getAttribute('command') === 'show-modal') target.showModal();
      else if (btn.getAttribute('command') === 'close') target.close();
    });
  }
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const outside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener('pointerdown', (e) => { pressedOutside = e.target === dialog && outside(e, dialog); });
      dialog.addEventListener('pointerup', (e) => { if (pressedOutside && e.target === dialog && outside(e, dialog)) dialog.close(); });
    }
  }
}

function wireInstall() {
  const button = $('install');
  const supportsWebInstall = typeof Navigator.prototype.install === 'function';
  let deferredPrompt;
  if (matchMedia('(display-mode: standalone)').matches) return;
  if (supportsWebInstall) button.hidden = false;

  addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (!supportsWebInstall) button.hidden = false;
  });
  addEventListener('appinstalled', () => { button.hidden = true; });

  button.addEventListener('click', async () => {
    if (button.getAttribute('aria-disabled') === 'true') return;
    button.setAttribute('aria-disabled', 'true');
    try {
      if (supportsWebInstall) {
        await navigator.install();
        toast('App installed.');
        button.hidden = true;
      } else if (deferredPrompt) {
        const promptEvent = deferredPrompt;
        deferredPrompt = undefined;
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        toast(outcome === 'accepted' ? 'App installed.' : 'Installation was cancelled.');
        if (!deferredPrompt) button.hidden = true;
      }
    } catch (error) {
      if (error.name === 'AbortError') toast('Installation was cancelled.');
      else console.error(error);
    } finally {
      button.removeAttribute('aria-disabled');
    }
  });
}

init();
