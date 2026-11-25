// localStorage persistence. Falls back to memory when storage is blocked,
// so the app still works for the session.
import { DEFAULT_SETTINGS } from './srs.js';

export const KEYS = Object.freeze({
  settings: 'frets:settings',
  progress: 'frets:progress',
  scheme: 'frets:scheme',
});

export const MAX_FRETS = 24;
export const WOODS = Object.freeze(['rosewood', 'ebony', 'maple']);

const memory = new Map();

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return memory.get(key);
  }
}

function write(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const emptyProgress = () => ({
  v: 1,
  cards: {},                                    // card id ("5-3" = 5th string, 3rd fret) -> packed card
  daily: { day: -1, new: 0, rev: 0, done: 0, extra: 0 },
  log: {},                                      // day number -> answers given
});

const num = (v, min, max, fallback) =>
  v !== '' && v !== null && Number.isFinite(+v) ? Math.min(max, Math.max(min, +v)) : fallback;

export function sanitizeSettings(s = {}) {
  const d = DEFAULT_SETTINGS;
  const strings = Array.isArray(s.strings) ? d.strings.filter((n) => s.strings.map(Number).includes(n)) : [];
  return {
    newPerDay: Math.round(num(s.newPerDay, 0, 100, d.newPerDay)),
    maxReviews: Math.round(num(s.maxReviews, 10, 500, d.maxReviews)),
    order: ['neck', 'string', 'random'].includes(s.order) ? s.order : d.order,
    pace: num(s.pace, 0.5, 2, d.pace),
    frets: Math.round(num(s.frets, 1, MAX_FRETS, d.frets)),
    accidentals: typeof s.accidentals === 'boolean' ? s.accidentals : d.accidentals,
    strings: strings.length ? strings : [...d.strings],
    wood: WOODS.includes(s.wood) ? s.wood : d.wood,
  };
}

/** @param {Set<string>|null} ids  known card ids, or null to keep any id */
export function sanitizeProgress(p, ids) {
  const out = emptyProgress();
  if (!p || typeof p !== 'object') return out;
  for (const [id, a] of Object.entries(p.cards ?? {})) {
    if (ids && !ids.has(id)) continue;
    if (!Array.isArray(a) || a.length !== 5 || !a.every(Number.isFinite)) continue;
    out.cards[id] = a;
  }
  for (const [day, count] of Object.entries(p.log ?? {})) {
    if (Number.isFinite(+day) && Number.isFinite(count)) out.log[day] = count;
  }
  if (p.daily && Number.isFinite(p.daily.day)) out.daily = { ...out.daily, ...p.daily };
  return out;
}

export const loadSettings = () => sanitizeSettings(read(KEYS.settings));
export const saveSettings = (s) => write(KEYS.settings, s);
export const loadProgress = () => sanitizeProgress(read(KEYS.progress), null);
export const saveProgress = (p) => write(KEYS.progress, p);

/** Ask the browser not to evict our data under storage pressure. */
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}
