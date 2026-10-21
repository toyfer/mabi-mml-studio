import { parseMML, parseScore } from '../src/core/mml.js';
import { encodePart } from '../src/core/encode.js';
import { WHOLE, decompose, DURATIONS } from '../src/core/spec.js';

let pass = 0;
const fails = [];
const eq = (actual, expected, name) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else fails.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const ok = (cond, name, extra = '') => (cond ? pass++ : fails.push(`${name} ${extra}`));

// --- length syntax ---
eq(parseMML('l8c.').events[0].dur, 720, 'dot on default length');
eq(parseMML('l4..c').events[0].dur, 1680, 'double dot');
eq(parseMML('l8c.c').events.map((e) => e.dur), [720, 480], 'dot does not leak to next note');
eq(parseMML('l8.c').events[0].dur, 720, 'dotted l command');
eq(parseMML('c4c8c16c32c64').events.map((e) => e.dur), [960, 480, 240, 120, 60], 'plain lengths');

// --- parsing safety ---
eq(parseMML('o9c').events[0].pitch, 108, 'o9 clamps');
eq(parseMML('o0<<<c').events[0].pitch, 12, 'octave underflow clamps');
eq(parseMML('n200c').events[0].pitch, 127, 'n overflow clamps');
eq(parseMML('').events.length, 0, 'empty input');
eq(parseScore('MML@;')[0].events.length, 0, 'MML@;');
eq(parseMML('r1'.repeat(70) + 'c').events[0].start, 70 * 3840, 'long rest');
eq(parseMML('c4&c4').events.length, 1, 'tie merges');
eq(parseMML('c4&r4').events.map((e) => [e.start, e.dur]), [[0, 960]], 'tie stops at rest');
eq(parseMML('c4&d4').events.map((e) => e.pitch), [60, 62], 'tie with different pitch splits');

// --- exact decomposition ---
let bad = [];
for (let t = 10; t <= 4000; t += 10) if (!decompose(t, 5)) bad.push(t);
ok(bad.length === 0, 'every multiple of 10 decomposes', `missing ${bad.slice(0, 8)}`);
for (const t of [50, 70, 100, 130, 150, 290]) {
  const terms = decompose(t, 5);
  eq(terms.reduce((a, d) => a + d.ticks, 0), t, `decompose(${t}) sums exactly`);
}

// --- encode/decode round trip (non-overlapping) ---
const rnd = (n) => Math.floor(Math.random() * n);
let worst = 0;
let worstInfo = '';
for (let trial = 0; trial < 600; trial++) {
  const grid = [20, 30, 40, 48, 60][rnd(5)];
  const gap = [120, 240, 480][rnd(3)];
  const pool = DURATIONS.filter((d) => d.ticks <= gap);
  const notes = [];
  let cur = 0;
  for (let i = 0; i < 12; i++) {
    cur += gap;
    notes.push({ start: cur, dur: pool[rnd(pool.length)].ticks, pitch: 40 + rnd(40), vel: 40 + rnd(80) });
  }
  for (const ties of [true, false]) {
    const enc = encodePart(notes, { bpm: 120, ties, minDur: 10 });
    const back = parseMML(enc.text).events;
    if (back.length !== notes.length) {
      fails.push(`count ${notes.length}->${back.length} ties=${ties} grid=${grid} :: ${enc.text.slice(0, 70)}`);
      continue;
    }
    for (let i = 0; i < notes.length; i++) {
      const ds = Math.abs(back[i].start - notes[i].start);
      if (ds > worst) {
        worst = ds;
        worstInfo = `grid=${grid} ties=${ties} #${i} ${notes[i].start}->${back[i].start}`;
      }
      if (back[i].pitch !== notes[i].pitch) fails.push(`pitch ${notes[i].pitch}->${back[i].pitch} :: ${enc.text.slice(0, 70)}`);
      const tol = Math.max(12, notes[i].dur * 0.34);
      if (Math.abs(back[i].dur - notes[i].dur) > tol) {
        fails.push(`dur ${notes[i].dur}->${back[i].dur} :: ${enc.text.slice(0, 70)}`);
      }
      if (back[i].start + back[i].dur > (notes[i + 1] ? notes[i + 1].start : Infinity)) {
        fails.push(`overlap at #${i} :: ${enc.text.slice(0, 70)}`);
      }
    }
  }
}
ok(worst === 0, 'no start drift', worstInfo);

// --- idempotence: encode(parse(x)) == x in timing ---
const sample = 't120v12o4l8cdefgab>c<b4.&b16r4a8a8';
const toNotes = (evs) => evs.map((e) => ({ start: e.start, dur: e.dur, pitch: e.pitch, vel: Math.round(((e.vel / 15) ** 2) * 127) }));
const first = parseMML(encodePart(toNotes(parseMML(sample).events), { ties: true, minDur: 10 }).text).events;
const second = parseMML(encodePart(toNotes(first), { ties: true, minDur: 10 }).text).events;
eq(second.map((e) => [e.start, e.dur, e.pitch]), first.map((e) => [e.start, e.dur, e.pitch]), 're-encode is idempotent');

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log(fails.slice(0, 10).join('\n'));
  process.exit(1);
}
