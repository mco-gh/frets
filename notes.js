// The music: standard tuning, note names, and the deck of fretboard positions.

/** Open-string pitches in standard tuning (MIDI numbers), by string number. */
export const OPEN = Object.freeze({ 6: 40, 5: 45, 4: 50, 3: 55, 2: 59, 1: 64 }); // E2 A2 D3 G3 B3 E4
export const STRINGS = Object.freeze([6, 5, 4, 3, 2, 1]);
export const STRING_NOTE = Object.freeze({ 6: 'E', 5: 'A', 4: 'D', 3: 'G', 2: 'B', 1: 'E' });
export const STRING_NAME = Object.freeze({ 6: 'Low E', 5: 'A', 4: 'D', 3: 'G', 2: 'B', 1: 'High E' });

const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
export const NATURALS = Object.freeze([0, 2, 4, 5, 7, 9, 11]);  // C D E F G A B
export const LETTERS = Object.freeze({ c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 });

export const isNatural = (pc) => NATURALS.includes(pc);
export const sharpName = (pc) => SHARP[pc];
export const flatName = (pc) => FLAT[pc];
/** "C", or "C♯ / D♭" for a black-key note. */
export const noteName = (pc) => (isNatural(pc) ? SHARP[pc] : `${SHARP[pc]} / ${FLAT[pc]}`);
/** Short label that fits in a dot: "C", "C♯". */
export const shortName = (pc) => SHARP[pc];
/** Scientific pitch name: A2, C♯4. Middle C is C4. */
export const pitchName = (midi) => `${SHARP[midi % 12]}${Math.floor(midi / 12) - 1}`;

export function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  return `${n}${s}`;
}

/** "5th string (A), 3rd fret" or "Low E string, open". */
export function placeName({ s, f }) {
  const string = `${ordinal(s)} string (${STRING_NAME[s]})`;
  return f === 0 ? `${string}, open` : `${string}, ${ordinal(f)} fret`;
}

export const MAX_FRETS = 24;

/** Every position on a 24-fret neck. Ids ("5-3") are stored with progress: never change them. */
export const DECK = Object.freeze(STRINGS.flatMap((s) =>
  Array.from({ length: MAX_FRETS + 1 }, (_, f) => {
    const midi = OPEN[s] + f;
    return Object.freeze({ id: `${s}-${f}`, s, f, midi, pc: midi % 12 });
  })));

/** Other places on the neck (up to `frets`) that sound the very same pitch. */
export const unisons = (card, frets) =>
  DECK.filter((c) => c.midi === card.midi && c.id !== card.id && c.f <= frets);
