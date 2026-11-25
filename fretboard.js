// Draws an electric guitar fretboard as inline SVG: wood with grain, binding,
// pearl inlays, nickel frets, a bone nut, and plain and wound strings.
//
// Everything is laid out in a "neck frame": `a` runs along the neck (0 at the
// headstock end) and `c` across it. A horizontal neck maps (a, c) to (x, y),
// with the high E string on top, as in tab. A vertical neck maps it to (y, x),
// nut at the top and the low E on the left, as in a chord chart.

const NS = 'http://www.w3.org/2000/svg';
const INLAYS = new Set([3, 5, 7, 9, 15, 17, 19, 21]);
const DOUBLE_INLAYS = new Set([12, 24]);
export const MARKED_FRETS = new Set([...INLAYS, ...DOUBLE_INLAYS]);

// Fret spacing follows the real rule of eighteen (each fret 2^(-1/12) of the one
// before) but softened, so the high frets stay big enough to read on a phone.
const TAPER = 20;

const WOODS = {
  rosewood: { base: ['#5a3524', '#3f2418', '#4c2c1e'], grain: [0.12, 0.05, 0.02], alpha: 0.55, inlay: 'pearl', binding: '#efe4c9' },
  ebony: { base: ['#2b2624', '#181514', '#221d1b'], grain: [0.35, 0.3, 0.27], alpha: 0.28, inlay: 'pearl', binding: '#efe4c9' },
  maple: { base: ['#f1d39a', '#e3bb78', '#ecc98a'], grain: [0.62, 0.42, 0.2], alpha: 0.38, inlay: 'black', binding: null },
};

let uid = 0;

function node(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  if (parent) parent.append(el);
  return el;
}

/**
 * Geometry for a neck, shared by drawing and hit-testing.
 * @param {number} frets
 * @param {boolean} vertical
 */
export function layout(frets, vertical, { names = false, numbers = true, thick = false } = {}) {
  const W = vertical ? 250 : thick ? 290 : 222;  // board width across (thicker on phones, to fit bigger dots)
  const B = 1000;                               // nut to last fret
  const names0 = names ? (thick ? 44 : 34) : 10;               // room for string names at the headstock end
  const open = vertical ? 66 : thick ? 74 : 58;              // open-string zone before the nut
  const nut = vertical ? 13 : 11;
  const nutA = names0 + open;                   // where the nut starts
  const boardA = nutA + nut;
  const taper = thick ? TAPER * 1.5 : TAPER;
  const p = (n) => 1 - 2 ** (-n / taper);
  const fretA = Array.from({ length: frets + 1 }, (_, n) => boardA + (B * p(n)) / p(frets));
  const last = fretA[frets] - fretA[frets - 1 > 0 ? frets - 1 : 0] || B;
  const tail = Math.max(16, last * 0.55);
  const endA = fretA[frets] + tail;
  const edge = 10;                              // gap above the board
  const numZone = numbers ? (vertical ? 34 : thick ? 48 : 30) : 10;
  const sp = W / 6;
  return {
    vertical, frets, W, sp, nutA, nut, boardA, fretA, endA, edge, names0, open,
    totalA: endA + 8,
    totalC: edge + W + numZone,
    /** Across-position of a string's center. */
    c: (s) => edge + ((vertical ? 6 - s : s - 1) + 0.5) * sp,
    /** Along-position of the middle of a fret's space (open strings sit before the nut). */
    a: (f) => (f === 0 ? names0 + open * 0.5 : (fretA[f - 1] + fretA[f]) / 2 + (f === 1 ? nut / 2 : 0)),
    /** Length of that space, for sizing dots. */
    room: (f) => (f === 0 ? open : fretA[f] - fretA[f - 1] - (f === 1 ? nut : 0)),
    xy: (a, c) => (vertical ? [c, a] : [a, c]),
  };
}

/**
 * @param {SVGSVGElement} svg
 * @param {object} o
 * @param {number} o.frets
 * @param {boolean} [o.vertical]
 * @param {'rosewood'|'ebony'|'maple'} [o.wood]
 * @param {boolean} [o.names]   label the strings at the headstock
 * @param {boolean} [o.numbers] number the marked frets
 * @param {boolean} [o.thick]   a chunkier neck with gentler fret taper, for small screens
 * @param {Array<{s:number,f:number,type:string,label?:string,cls?:string,id?:string,title?:string}>} [o.marks]
 */
export function drawFretboard(svg, o) {
  const L = layout(o.frets, !!o.vertical, o);
  const { xy, vertical } = L;
  const wood = WOODS[o.wood] ?? WOODS.rosewood;
  const id = `fb${++uid}`;
  const [vbW, vbH] = xy(L.totalA, L.totalC);
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${vbW} ${vbH}`);
  svg.classList.add('fretboard');
  svg.classList.toggle('vertical', vertical);
  svg.dataset.wood = o.wood ?? 'rosewood';

  // Rectangle from along a0..a1 and across c0..c1.
  const rect = (a0, a1, c0, c1, attrs, parent) => {
    const [x0, y0] = xy(a0, c0);
    const [x1, y1] = xy(a1, c1);
    return node('rect', { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0), ...attrs }, parent);
  };
  // A gradient that runs across the given axis ('a' along the neck, 'c' across it).
  const gradient = (name, axis, stops, parent) => {
    const alongX = (axis === 'a') !== vertical;
    const g = node('linearGradient', { id: `${id}-${name}`, x1: 0, y1: 0, x2: alongX ? 1 : 0, y2: alongX ? 0 : 1 }, parent);
    for (const [off, color, op] of stops) node('stop', { offset: off, 'stop-color': color, 'stop-opacity': op }, g);
    return `url(#${id}-${name})`;
  };

  const defs = node('defs', {}, svg);
  const woodFill = gradient('wood', 'c', [[0, wood.base[0]], [0.5, wood.base[2]], [1, wood.base[1]]], defs);
  const fretFill = gradient('fret', 'a', [[0, '#8d8f94'], [0.35, '#f4f5f7'], [0.6, '#c9cbd0'], [1, '#6f7176']], defs);
  const plain = gradient('plain', 'c', [[0, '#8a8c90'], [0.4, '#ffffff'], [1, '#7b7d82']], defs);
  const wound = gradient('wound', 'c', [[0, '#8a7f6c'], [0.38, '#fff6e2'], [1, '#6e6352']], defs);
  const nutFill = gradient('nut', 'c', [[0, '#f7f1e3'], [1, '#ddd2bb']], defs);
  const pearl = node('radialGradient', { id: `${id}-pearl`, cx: 0.38, cy: 0.35, r: 0.75 }, defs);
  for (const [off, color] of [[0, '#ffffff'], [0.45, '#eef0ea'], [0.75, '#d9dfe3'], [1, '#c8cdd3']]) node('stop', { offset: off, 'stop-color': color }, pearl);
  // Wood grain: stretched noise turned into translucent dark streaks.
  const grain = node('filter', { id: `${id}-grain`, x: 0, y: 0, width: 1, height: 1 }, defs);
  node('feTurbulence', { type: 'fractalNoise', baseFrequency: vertical ? '0.09 0.0035' : '0.0035 0.09', numOctaves: 3, seed: 7 }, grain);
  const [r, g, b] = wood.grain;
  node('feColorMatrix', { type: 'matrix', values: `0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  0 0 0 ${-wood.alpha * 2.2} ${wood.alpha * 1.25}` }, grain);
  node('feComposite', { in2: 'SourceGraphic', operator: 'in' }, grain);
  const glow = node('filter', { id: `${id}-glow`, x: -1, y: -1, width: 3, height: 3 }, defs);
  node('feGaussianBlur', { stdDeviation: 5 }, glow);
  const shadow = node('filter', { id: `${id}-shadow`, x: -0.05, y: -0.3, width: 1.1, height: 1.6 }, defs);
  node('feDropShadow', { dx: vertical ? 3 : 0, dy: vertical ? 0 : 3, stdDeviation: 3, 'flood-color': '#000', 'flood-opacity': 0.45 }, shadow);

  const { edge, W, boardA, endA, fretA } = L;

  // Board, grain and binding
  rect(boardA, endA, edge, edge + W, { fill: woodFill, filter: `url(#${id}-shadow)`, class: 'fb-board' }, svg);
  rect(boardA, endA, edge, edge + W, { fill: '#000', filter: `url(#${id}-grain)` }, svg);
  if (wood.binding) {
    rect(boardA, endA, edge, edge + 3.2, { fill: wood.binding }, svg);
    rect(boardA, endA, edge + W - 3.2, edge + W, { fill: wood.binding }, svg);
  }

  // Inlays
  const inlayFill = wood.inlay === 'pearl' ? `url(#${id}-pearl)` : '#1c1714';
  for (let f = 1; f <= o.frets; f++) {
    const room = L.room(f);
    const rad = Math.min(L.sp * 0.36, room * 0.26);
    const a = L.a(f);
    const across = DOUBLE_INLAYS.has(f) ? [edge + L.sp * 1.5, edge + W - L.sp * 1.5] : INLAYS.has(f) ? [edge + W / 2] : [];
    for (const c of across) {
      const [x, y] = xy(a, c);
      node('circle', { cx: x, cy: y, r: rad, fill: inlayFill, opacity: wood.inlay === 'pearl' ? 0.92 : 0.85 }, svg);
    }
  }

  // Frets
  const fretW = vertical ? 4.2 : 3.8;
  for (let f = 1; f <= o.frets; f++) {
    rect(fretA[f] - fretW / 2, fretA[f] + fretW / 2, edge - 0.5, edge + W + 0.5, { fill: fretFill, rx: 1 }, svg);
  }

  // Nut
  rect(L.nutA, L.nutA + L.nut, edge - 1.5, edge + W + 1.5, { fill: nutFill, rx: 2, class: 'fb-nut' }, svg);

  // Strings: a soft shadow on the board, then the string with a round sheen.
  const gauge = { 1: 1.6, 2: 2.0, 3: 2.6, 4: 3.3, 5: 4.1, 6: 5.0 };
  const startA = L.names0 + 2;
  // Strings fade in from the headstock side, as if running off toward the tuners.
  const fade = node('linearGradient', { id: `${id}-fade`, gradientUnits: 'userSpaceOnUse', ...Object.fromEntries(
    [['x1', 'y1'], ['x2', 'y2']].flatMap(([kx, ky], k) => {
      const [x, y] = xy(k ? L.nutA : startA, 0);
      return [[kx, x], [ky, y]];
    })) }, defs);
  node('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0 }, fade);
  node('stop', { offset: 0.55, 'stop-color': '#fff', 'stop-opacity': 1 }, fade);
  const mask = node('mask', { id: `${id}-mask`, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: vbW, height: vbH }, defs);
  const [mx0, my0] = xy(0, 0);
  const [mx1, my1] = xy(L.nutA, L.totalC);
  node('rect', { x: mx0, y: my0, width: mx1 - mx0, height: my1 - my0, fill: `url(#${id}-fade)` }, mask);
  const [bx0, by0] = xy(L.nutA, 0);
  node('rect', { x: bx0, y: by0, width: vbW, height: vbH, fill: '#fff' }, mask);
  const shadows = node('g', { opacity: 0.32 }, svg);
  const strings = node('g', { mask: `url(#${id}-mask)` }, svg);
  for (let s = 1; s <= 6; s++) {
    const c = L.c(s);
    const t = gauge[s] * (vertical ? 1.15 : 1);
    rect(boardA, endA, c - t / 2 + 2.2, c + t / 2 + 2.6, { fill: '#000' }, shadows);
    rect(startA, endA - 4, c - t / 2, c + t / 2, { fill: s >= 4 ? wound : plain, class: 'fb-string' }, strings);
    if (s >= 4) {
      // The winding: fine dark ridges along a wound string.
      const [x0, y0] = xy(startA, c);
      const [x1, y1] = xy(endA - 4, c);
      node('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: '#3b3328', 'stroke-width': t * 0.9, 'stroke-dasharray': '0.7 1.3', opacity: 0.45 }, strings);
    }
  }

  // String names at the headstock end
  if (o.names) {
    for (let s = 1; s <= 6; s++) {
      const [x, y] = xy(L.names0 / 2 + 1, L.c(s));
      node('text', { x, y, class: 'fb-name', style: o.thick ? 'font-size:30px' : null, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, svg).textContent = { 6: 'E', 5: 'A', 4: 'D', 3: 'G', 2: 'B', 1: 'e' }[s];
    }
  }

  // Fret numbers beside the marked frets
  if (o.numbers !== false) {
    for (let f = 1; f <= o.frets; f++) {
      if (!MARKED_FRETS.has(f) && f !== 1) continue;
      const [x, y] = xy(L.a(f), edge + W + (vertical ? 18 : o.thick ? 26 : 17));
      node('text', { x, y, class: 'fb-num', style: o.thick ? 'font-size:28px' : null, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, svg).textContent = f;
    }
  }

  // Marks
  const markLayer = node('g', { class: 'fb-marks' }, svg);
  for (const m of o.marks ?? []) drawMark(markLayer, L, m, id);
  return L;
}

function drawMark(parent, L, m, id) {
  const [x, y] = L.xy(L.a(m.f), L.c(m.s));
  const big = Math.min(L.sp * 0.43, L.room(m.f) * 0.47);
  const g = node('g', { class: `fb-mark fb-${m.type}${m.cls ? ` ${m.cls}` : ''}` }, parent);
  if (m.id) {
    g.dataset.id = m.id;
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', '0');
    if (m.title) g.setAttribute('aria-label', m.title);
  }
  if (m.type === 'target' || m.type === 'answer') {
    node('circle', { cx: x, cy: y, r: big * 1.05, class: 'fb-glow', filter: `url(#${id}-glow)` }, g);
    if (m.type === 'target') node('circle', { cx: x, cy: y, r: big, class: 'fb-pulse' }, g);
    node('circle', { cx: x, cy: y, r: big, class: 'fb-dot' }, g);
  } else if (m.type === 'same') {
    node('circle', { cx: x, cy: y, r: big * 0.86, class: 'fb-ring' }, g);
  } else {
    // 'status': a position on the overview neck
    node('circle', { cx: x, cy: y, r: big * (m.small ? 0.5 : 0.9), class: 'fb-spot' }, g);
  }
  if (m.label && !m.small) {
    const size = big * (m.label.length > 1 ? 0.92 : 1.12) * (m.type === 'same' ? 0.85 : 1);
    node('text', { x, y: y + size * 0.04, class: 'fb-label', 'font-size': size.toFixed(1), 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g).textContent = m.label;
  }
}
