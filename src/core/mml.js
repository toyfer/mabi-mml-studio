import { TPQN, WHOLE, octaveOf, noteNumberOf, clamp } from './spec.js';

const SEMITONE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const NAMES = ['c', 'c+', 'd', 'd+', 'e', 'f', 'f+', 'g', 'g+', 'a', 'a+', 'b'];

export function parseScore(text, opts = {}) {
  const cleaned = String(text || '')
    .replace(/MML@/gi, '')
    .replace(/;+\s*$/, '');
  const chunks = cleaned.split(',');
  return chunks.map((chunk, i) => parseMML(chunk, { ...opts, part: i }));
}

export function parseMML(text, opts = {}) {
  const src = String(text || '').replace(/\s+/g, '');
  const events = [];
  const errors = [];
  const tempos = [];
  let tick = 0;
  let octave = 4;
  let lengthTicks = TPQN;
  let vel = 12;
  let tempo = 120;
  let last = null;
  let i = 0;

  const num = () => {
    let s = '';
    while (i < src.length && src[i] >= '0' && src[i] <= '9') s += src[i++];
    return s ? parseInt(s, 10) : null;
  };

  const readLength = (fallback) => {
    const explicit = num();
    let dotted = false;
    if (src[i] === '.') {
      dotted = true;
      i++;
    }
    if (!explicit) return fallback;
    return Math.max(1, Math.round((WHOLE / explicit) * (dotted ? 1.5 : 1)));
  };

  const readNote = () => {
    const ch = src[i] ? src[i].toLowerCase() : '';
    let midi = null;
    if (ch in SEMITONE) {
      i++;
      midi = (octave + 1) * 12 + SEMITONE[ch];
      if (src[i] === '+' || src[i] === '#') {
        midi++;
        i++;
      } else if (src[i] === '-') {
        midi--;
        i++;
      }
    } else if (ch === 'n') {
      i++;
      const v = num();
      if (v === null) {
        errors.push('nコマンドに番号がありません');
        return null;
      }
      midi = v + 12;
    } else {
      return null;
    }
    return { midi, ticks: readLength(lengthTicks) };
  };

  while (i < src.length) {
    const ch = src[i].toLowerCase();
    if (ch === 't') {
      i++;
      const v = num();
      if (v) {
        tempo = clamp(v, 1, 999);
        tempos.push({ tick, bpm: tempo });
      }
      continue;
    }
    if (ch === 'v') {
      i++;
      const v = num();
      if (v !== null) vel = clamp(v, 0, 15);
      continue;
    }
    if (ch === 'o') {
      i++;
      const v = num();
      if (v !== null) octave = clamp(v, 0, 8);
      continue;
    }
    if (ch === 'l') {
      i++;
      lengthTicks = readLength(lengthTicks);
      continue;
    }
    if (ch === '<') {
      octave = clamp(octave - 1, 0, 8);
      i++;
      continue;
    }
    if (ch === '>') {
      octave = clamp(octave + 1, 0, 8);
      i++;
      continue;
    }
    if (ch === 'r') {
      i++;
      tick += readLength(lengthTicks);
      last = null;
      continue;
    }
    if (ch === '&') {
      i++;
      const next = readNote();
      if (!next) {
        errors.push('タイ（&）の後に音符がありません');
        continue;
      }
      if (last) {
        last.dur += next.ticks;
        last.end = last.start + last.dur;
        tick += next.ticks;
      } else {
        errors.push('タイ（&）の前に対象の音符がありません');
        tick += next.ticks;
      }
      continue;
    }
    if (ch === 'n' || ch in SEMITONE) {
      const note = readNote();
      if (!note) {
        i++;
        continue;
      }
      const ev = { start: tick, dur: note.ticks, end: tick + note.ticks, pitch: note.midi, vel, part: opts.part || 0 };
      events.push(ev);
      tick += note.ticks;
      last = ev;
      continue;
    }
    i++;
  }

  return {
    events,
    tempos: tempos.length ? tempos : [{ tick: 0, bpm: 120 }],
    errors,
    chars: src.length,
    duration: tick,
  };
}

export function scoreStats(parsed) {
  const events = parsed.flatMap((p) => p.events);
  return {
    notes: events.length,
    chars: parsed.map((p) => p.chars),
    duration: Math.max(0, ...parsed.map((p) => p.duration)),
    errors: parsed.flatMap((p) => p.errors),
  };
}

export function describeNote(midi) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[((midi % 12) + 12) % 12]}${octaveOf(midi)}`;
}

export const absoluteNoteNumber = (midi) => noteNumberOf(midi);
export const noteName = (midi) => NAMES[((midi % 12) + 12) % 12];
