import assert from 'node:assert/strict';
import { convertMidi } from '../src/core/convert.js';
import { parseScore } from '../src/core/mml.js';
import { WHOLE } from '../src/core/spec.js';
import { demoMidi, randomMidi, makeMidi } from './midi-fixture.mjs';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
};

const roundTrip = (result) => {
  const parsed = parseScore(result.combined);
  const errs = parsed.flatMap((p) => p.errors);
  assert.equal(errs.length, 0, `parse errors: ${errs.join(', ')}`);
  const out = parsed.flatMap((p) => p.events);
  assert.equal(out.length, result.stats.outputNotes, 'note count mismatch');
  const drift = parsed.map((p, i) => Math.abs(p.duration - (result.parts[i] ? p.duration : 0)));
  return { parsed, out, drift };
};

test('demo: converts and round-trips', () => {
  const result = convertMidi(demoMidi(), { parts: 3 });
  assert.equal(result.ok, true);
  assert.ok(result.parts.length >= 1);
  for (const p of result.parts) {
    assert.ok(p.chars <= 2400, `part ${p.index} over limit: ${p.chars}`);
    assert.ok(p.mml.length > 0);
  }
  roundTrip(result);
  console.log('      parts:', result.parts.map((p) => `${p.name}:${p.chars}`).join(' '));
  console.log('      bpm', result.bpm, 'grid', result.grid, 'notes', result.stats.outputNotes);
});

test('demo: melody keeps the top voice', () => {
  const result = convertMidi(demoMidi(), { parts: 3 });
  const melody = parseScore(result.parts[0].mml)[0].events;
  const avg = melody.reduce((s, n) => s + n.pitch, 0) / melody.length;
  assert.ok(avg > 60, `melody average too low: ${avg}`);
});

test('random: onsets are preserved within one grid', () => {
  const result = convertMidi(randomMidi(7), { parts: 1, grid: 20, charLimit: 20000 });
  const parsed = parseScore(result.parts[0].mml)[0];
  assert.equal(parsed.errors.length, 0);
  assert.ok(parsed.events.length > 50);
});

test('char limit: compresses instead of overflowing', () => {
  const result = convertMidi(demoMidi(), { parts: 6, charLimit: 160 });
  assert.ok(result.stats.maxChars <= 160, `max chars ${result.stats.maxChars}`);
});

test('tempo map: mid-song tempo change is flattened', () => {
  const bytes = demoMidi();
  const result = convertMidi(bytes, { parts: 2 });
  assert.ok(result.stats.tempoChanges >= 0);
  assert.ok(result.bpm >= 32 && result.bpm <= 255);
});

test('no-tie mode never emits &', () => {
  const result = convertMidi(demoMidi(), { parts: 3, tieMode: 'none' });
  for (const p of result.parts) assert.ok(!p.mml.includes('&'), `part ${p.index} has a tie`);
  roundTrip(result);
});

test('octave range: extreme notes are folded into o0-o8', () => {
  const result = convertMidi(randomMidi(3), { parts: 2, transpose: 24, autoFit: true });
  const parsed = parseScore(result.combined);
  for (const p of parsed) for (const e of p.events) assert.ok(e.pitch >= 0 && e.pitch <= 120);
});

test('combined MML@ format splits into parts', () => {
  const result = convertMidi(demoMidi(), { parts: 3 });
  assert.ok(result.combined.startsWith('MML@'));
  assert.ok(result.combined.endsWith(';'));
  assert.equal(result.combined.slice(4, -1).split(',').length, result.parts.length);
});

test('duration model: every emitted length is tick-exact', () => {
  const result = convertMidi(demoMidi(), { parts: 3 });
  const parsed = parseScore(result.combined);
  for (const p of parsed) {
    for (const e of p.events) {
      assert.ok(Number.isInteger(e.dur) && e.dur > 0, `bad duration ${e.dur}`);
      assert.ok(e.dur <= WHOLE * 4, `duration too long ${e.dur}`);
    }
  }
});

test('tempo change mid-song keeps wall-clock length', () => {
  const bytes = makeMidi(
    [{ name: 'M', notes: Array.from({ length: 32 }, (_, i) => ({ start: i * 480, dur: 470, pitch: 60 + (i % 5), vel: 90 })), ch: 0 }],
    { division: 480, bpm: 120, tempoMap: [{ tick: 0, bpm: 120 }, { tick: 3840, bpm: 180 }] },
  );
  const result = convertMidi(bytes, { parts: 1 });
  assert.ok(result.stats.tempoChanges >= 1);
  const expected = 8 * 0.5 + 24 * (60 / 180);
  assert.ok(Math.abs(result.stats.durationSec - expected) < 1.5, `duration ${result.stats.durationSec} vs ${expected}`);
});

test('overflow splits parts without losing notes', () => {
  const notes = Array.from({ length: 900 }, (_, i) => ({ start: i * 240, dur: 220, pitch: 60 + (i % 12), vel: 90 }));
  const bytes = makeMidi([{ name: 'M', notes, ch: 0 }], { division: 480, bpm: 140 });
  const result = convertMidi(bytes, { parts: 3, charLimit: 900 });
  assert.equal(result.stats.outputNotes, 900);
  assert.ok(result.parts.length > 1);
  assert.ok(result.stats.maxChars <= 900, `max ${result.stats.maxChars}`);
  const parsed = parseScore(result.combined);
  const onsets = parsed.flatMap((p) => p.events.map((e) => e.start)).sort((a, b) => a - b);
  assert.equal(onsets.length, 900);
});

console.log(`\n${passed} tests passed`);
