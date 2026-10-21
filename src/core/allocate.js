import { clamp } from './spec.js';

const meanPitch = (notes) => (notes.length ? notes.reduce((s, n) => s + n.pitch, 0) / notes.length : 60);

export function dedupeNotes(notes, minDur) {
  const map = new Map();
  for (const n of notes) {
    if (n.pitch < 0 || n.pitch > 127) continue;
    const key = `${n.start}:${n.pitch}`;
    const prev = map.get(key);
    if (!prev || n.vel > prev.vel) map.set(key, n);
  }
  return [...map.values()]
    .map((n) => {
      const dur = Math.max(minDur, n.dur);
      return { ...n, dur, end: n.start + dur };
    })
    .sort((a, b) => a.start - b.start || b.pitch - a.pitch || b.vel - a.vel);
}

export function allocateParts(notes, { parts = 3, mode = 'auto', minDur = 20 } = {}) {
  const count = clamp(parts, 1, 6);
  if (mode === 'track' || mode === 'channel') return allocateByGroup(notes, count, mode, minDur);
  return allocateAuto(notes, count, minDur);
}

function extractMelody(notes) {
  const groups = new Map();
  for (const n of notes) {
    const key = n.trk >= 0 ? `t${n.trk}` : `c${n.ch}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  let best = null;
  for (const g of groups.values()) {
    if (!g.length) continue;
    const meanPitch = g.reduce((s, n) => s + n.pitch, 0) / g.length;
    const meanVel = g.reduce((s, n) => s + n.vel, 0) / g.length;
    const poly = maxPolyphony(g);
    const score = meanPitch + meanVel * 0.3 - Math.max(0, poly - 1) * 8;
    if (!best || score > best.score) best = { score, notes: g };
  }
  const src = (best ? best.notes : notes)
    .slice()
    .sort((a, b) => a.start - b.start || b.pitch - a.pitch || b.vel - a.vel);
  const line = [];
  let end = -Infinity;
  let onset = -1;
  for (const n of src) {
    const fresh = n.start !== onset;
    if (fresh) onset = n.start;
    if (!fresh) continue;
    if (n.start < end) continue;
    line.push(n);
    end = n.start + n.dur;
  }
  return line;
}

function allocateAuto(notes, partCount, minDur) {
  const slots = Array.from({ length: partCount }, (_, index) => ({
    index,
    notes: [],
    end: -Infinity,
    sum: 0,
    count: 0,
  }));
  const assigned = new Set();

  const push = (slot, note) => {
    slot.notes.push(note);
    slot.end = note.start + note.dur;
    slot.sum += note.pitch;
    slot.count++;
    assigned.add(note);
  };

  const melodyLine = extractMelody(notes);
  for (const n of melodyLine) push(slots[0], n);

  let dropped = 0;
  for (const n of notes) {
    if (assigned.has(n)) continue;
    let best = null;
    let bestScore = Infinity;
    for (const slot of slots) {
      if (slot.end > n.start) continue;
      const mean = slot.count ? slot.sum / slot.count : n.pitch;
      let score = Math.abs(mean - n.pitch);
      if (slot.index === 0) score += 6;
      if (!slot.count) score += 4;
      if (score < bestScore) {
        bestScore = score;
        best = slot;
      }
    }
    if (best) {
      push(best, n);
      continue;
    }
    let victim = slots[0];
    for (const slot of slots) if (slot.end < victim.end) victim = slot;
    const last = victim.notes[victim.notes.length - 1];
    if (last && n.start - last.start >= minDur) {
      last.dur = n.start - last.start;
      last.end = n.start;
      victim.end = n.start;
      victim.sum -= last.pitch;
      victim.count--;
      push(victim, n);
    } else {
      dropped++;
    }
  }

  const out = slots.map((s) => s.notes.sort((a, b) => a.start - b.start));
  return { parts: out, dropped };
}

function allocateByGroup(notes, partCount, mode, minDur) {
  const groups = new Map();
  for (const n of notes) {
    const key = mode === 'channel' ? `c${n.ch}` : n.trk >= 0 ? `t${n.trk}` : `c${n.ch}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  let list = [...groups.values()].map((g) => ({ notes: g.sort((a, b) => a.start - b.start), mean: meanPitch(g) }));
  list.sort((a, b) => b.mean - a.mean);

  if (list.length > partCount) {
    while (list.length > partCount) {
      const last = list.pop();
      let target = list[0];
      let best = Infinity;
      for (const cand of list) {
        const d = Math.abs(cand.mean - last.mean);
        if (d < best) {
          best = d;
          target = cand;
        }
      }
      target.notes = target.notes.concat(last.notes).sort((a, b) => a.start - b.start);
      target.mean = meanPitch(target.notes);
    }
  }

  let dropped = 0;
  const parts = [];
  for (let i = 0; i < partCount; i++) {
    const group = list[i];
    if (!group) {
      parts.push([]);
      continue;
    }
    const mono = [];
    let lastEnd = -Infinity;
    for (const n of group.notes) {
      if (n.start < lastEnd) {
        const prev = mono[mono.length - 1];
        if (prev && n.start - prev.start >= minDur) {
          prev.dur = n.start - prev.start;
          prev.end = n.start;
        } else {
          dropped++;
          continue;
        }
      }
      mono.push({ ...n });
      lastEnd = n.start + n.dur;
    }
    parts.push(mono);
  }
  return { parts, dropped };
}

export function maxPolyphony(notes) {
  const events = [];
  for (const n of notes) {
    events.push([n.start, 1]);
    events.push([n.end ?? n.start + n.dur, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of events) {
    cur += d;
    if (cur > max) max = cur;
  }
  return max;
}
