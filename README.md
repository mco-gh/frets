# Frets

Fretboard flashcards with spaced repetition. Each card shows an electric guitar neck
in standard tuning (E A D G B E) with one spot highlighted; name the note by tapping
it on the keys under the card (or typing it), or just flip the card. The back names
the note and rings every other place on the neck with the same pitch.

A sibling of [Words](https://github.com/mco-gh/words) and
[Geo](https://github.com/mco-gh/geo): the same scheduler, layout and behavior, in its
own "Sunburst" color scheme. A fully static, offline-capable progressive web app: no
server code, no build step, no login, all progress in the browser's localStorage.

## Settings

- **Number of frets**: 1–24, default 22. Positions above it are paused.
- **Include sharps and flats**: off by default, so only the natural notes A–G are
  asked (84 positions on a 22-fret neck; 138 with sharps and flats).
- **Strings**: study any subset of the six.
- **Fretboard**: rosewood, ebony or maple.
- The usual Words/Geo spaced-repetition settings, with three new-card orders:
  random (the default), up the neck (open strings first, then three frets at a
  time), or one string at a time.

## Where it lives

Published at https://mco.dev/frets/. This repo is mounted in
[mco-gh/mco.dev](https://github.com/mco-gh/mco.dev) (a Hugo site) as a git submodule
at `static/frets`, so **everything in this repo is public** at `https://mco.dev/frets/...`.

## Run it locally

From a checkout of mco.dev, serve the site's `static/` folder so URLs match production:

    python3 -m http.server 4174 --directory static

Then open http://localhost:4174/frets/. The service worker caches everything, so while
developing, unregister it (DevTools → Application) or reloads may show old files.

## Files

| File | What it does |
|---|---|
| `index.html`, `styles.css` | the page and its look |
| `app.js` | sessions, the note keys, the Neck and Progress views, settings, backup |
| `srs.js` | the SM-2-style scheduler (shared with Words and Geo) and new-card orders |
| `store.js` | localStorage persistence (`frets:settings`, `frets:progress`, `frets:scheme`) |
| `notes.js` | tuning, note names, and the deck: every position on a 24-fret neck |
| `fretboard.js` | draws a fretboard as inline SVG, horizontal or vertical |

Progress is keyed by position id: `"5-3"` is the 5th string (A), 3rd fret. Ids never
change, so settings can be changed freely without losing progress.

## How the fretboard is drawn

Everything is laid out along the neck (`a`) and across it (`c`), then mapped to x/y
for a horizontal neck (high E on top, as in tab) or a vertical one (nut at the top, low
E on the left, as in a chord chart). Cards always use a horizontal neck, drawn
chunkier on phones; the Neck tab turns vertical on phones and scrolls. Fret spacing
follows the real rule (each fret 2^(-1/12) of the one before) but softened, so the
high frets stay big enough to read. The wood grain is an SVG `feTurbulence` filter.

## Updating

Bump `VERSION` in `sw.js` whenever any file changes, so installed copies pick it up.
Icons are rendered from `icons/icon.svg` and `build/icons/full-bleed.svg` with
`bash build/icons/render.sh`.
