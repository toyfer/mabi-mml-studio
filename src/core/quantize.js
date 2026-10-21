import { TPQN, clamp, LIMITS } from './spec.js';

export function buildTempoSegments(tempos, division) {
  const list = (tempos && tempos.length ? [...tempos] : [{ tick: 0, us: 500000 }]).sort((a, b) => a.tick - b.tick);
  if (list[0].tick !== 0) list.unshift({ tick: 0, us: 500000 });
  const segs = [];
  let sec = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (segs.length && s.tick === segs[segs.length - 1].tick) {
      segs[segs.length - 1].us = s.us;
    } else {
      segs.push({ tick: s.tick, sec, us: s.us, division });
    }
    const next = list[i + 1];
    if (next) sec += ((next.tick - s.tick) * (s.us / 1e6)) / division;
  }
  return segs;
}

export function secAt(segs, tick) {
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].tick <= tick) lo = mid;
    else hi = mid - 1;
  }
  const s = segs[lo];
  return s.sec + ((tick - s.tick) * (s.us / 1e6)) / s.division;
}

export function bpmAt(segs, tick) {
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].tick <= tick) lo = mid;
    else hi = mid - 1;
  }
  return 60 / (segs[lo].us / 1e6);
}

export function detectBpm(segs, lastTick) {
  if (segs.length === 1) return clamp(Math.round(60 / (segs[0].us / 1e6)), LIMITS.tempoMin, LIMITS.tempoMax);
  const weights = segs.map((s, i) => {
    const next = segs[i + 1];
    return { bpm: 60 / (s.us / 1e6), dur: (next ? next.tick : lastTick) - s.tick };
  });
  weights.sort((a, b) => b.dur - a.dur);
  return clamp(Math.round(weights[0].bpm), LIMITS.tempoMin, LIMITS.tempoMax);
}

export function tempoChangeCount(segs) {
  return Math.max(0, segs.length - 1);
}

export function flattenToTicks(notes, segs, bpm, grid) {
  const scale = (bpm / 60) * TPQN;
  const out = [];
  for (const n of notes) {
    const s = secAt(segs, n.start) * scale;
    const e = secAt(segs, n.end) * scale;
    let start = Math.round(s / grid) * grid;
    let end = Math.round(e / grid) * grid;
    if (start < 0) start = 0;
    if (end - start < grid) end = start + grid;
    out.push({ ...n, start, end, dur: end - start });
  }
  out.sort((a, b) => a.start - b.start || b.pitch - a.pitch || b.vel - a.vel);
  return out;
}

export function totalSeconds(segs, lastTick) {
  return secAt(segs, lastTick);
}

export function transposeToRange(notes, { midiMin, midiMax, policy }) {
  const out = [];
  let shifted = 0;
  let clamped = 0;
  for (const n of notes) {
    let pitch = n.pitch;
    if (pitch < midiMin || pitch > midiMax) {
      if (policy === 'octave') {
        while (pitch < midiMin) pitch += 12;
        while (pitch > midiMax) pitch -= 12;
        if (pitch < midiMin || pitch > midiMax) {
          pitch = clamp(pitch, midiMin, midiMax);
          clamped++;
        } else shifted++;
      } else if (policy === 'clamp') {
        pitch = clamp(pitch, midiMin, midiMax);
        clamped++;
      } else {
        out.push({ ...n, pitch, outOfRange: true });
        continue;
      }
    }
    out.push({ ...n, pitch });
  }
  return { notes: out, shifted, clamped };
}

export function fitWholeSong(notes, { midiMin, midiMax }) {
  if (!notes.length) return { notes, shift: 0 };
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of notes) {
    lo = Math.min(lo, n.pitch);
    hi = Math.max(hi, n.pitch);
  }
  let shift = 0;
  while (lo + shift < midiMin) shift += 12;
  while (hi + shift > midiMax && shift > -60) shift -= 12;
  return { notes: notes.map((n) => ({ ...n, pitch: n.pitch + shift })), shift };
}
