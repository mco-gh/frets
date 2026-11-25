// A plucked electric-guitar note, synthesized in the browser (Karplus–Strong):
// a burst of noise circulating in a delay line one period long, softened a
// little on every pass, the way a real string loses its brightness.

let ctx;
const cache = new Map();

function render(midi) {
  const sr = ctx.sampleRate;
  const freq = 440 * 2 ** ((midi - 69) / 12);
  const len = Math.floor(sr * 2.6);
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);

  // The loop below delays by N - 0.5 samples (it averages the oldest sample with
  // the next one); a first-order allpass adds the fraction left over, so high
  // notes stay in tune. Its delay is kept between 0.1 and 1.1 samples, where it's stable.
  const period = sr / freq + 0.5;
  let N = Math.floor(period);
  let frac = period - N;
  if (frac < 0.1) { N -= 1; frac += 1; }
  const C = (1 - frac) / (1 + frac);
  const line = new Float32Array(N);

  // Pluck: noise, smoothed (a pick, not a hammer) and with the pick position's comb.
  let prev = 0;
  for (let i = 0; i < N; i++) {
    prev = 0.55 * prev + 0.45 * (Math.random() * 2 - 1);
    line[i] = prev;
  }
  const pick = Math.max(1, Math.round(N * 0.18));
  const plucked = line.map((v, i) => v - 0.6 * line[(i - pick + N) % N]);
  line.set(plucked);

  // Lower notes ring longer, as on a real guitar.
  const loss = 0.9965 + Math.min(0.0032, (82 / freq) * 0.003);
  let idx = 0, apX = 0, apY = 0, peak = 0;
  for (let i = 0; i < len; i++) {
    const a = line[idx];
    const b = line[(idx + 1) % N];
    const avg = loss * 0.5 * (a + b);
    const y = C * avg + apX - C * apY;      // allpass for the fractional delay
    apX = avg; apY = y;
    line[idx] = y;
    idx = (idx + 1) % N;
    out[i] = a;
    peak = Math.max(peak, Math.abs(a));
  }
  // Normalize, warm it up with a touch of pickup saturation, and fade the tail.
  const fade = Math.floor(sr * 0.25);
  for (let i = 0; i < len; i++) {
    let v = Math.tanh((out[i] / (peak || 1)) * 1.6) / Math.tanh(1.6);
    if (i < 32) v *= i / 32;
    if (i > len - fade) v *= (len - i) / fade;
    out[i] = v;
  }
  return buf;
}

/** Play a MIDI note. Must first be called from a user gesture (a tap or key press). */
export function playNote(midi) {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    if (!cache.has(midi)) cache.set(midi, render(midi));
    const src = ctx.createBufferSource();
    src.buffer = cache.get(midi);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 4200;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    src.connect(tone).connect(gain).connect(ctx.destination);
    src.start();
  } catch (err) {
    console.warn('Could not play the note', err);
  }
}
