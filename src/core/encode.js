import {
  WHOLE,
  LIMITS,
  octaveOf,
  nameOf,
  noteNumberOf,
  decompose,
  largestAtMost,
  bestDuration,
  durationByTicks,
  clamp,
} from './spec.js';

export function velocityToV(vel, mode = 'fine') {
  if (mode === 'off') return null;
  const x = clamp(vel / 127, 0, 1);
  let v = Math.round(15 * Math.sqrt(x));
  v = clamp(v, 1, LIMITS.volumeMax);
  if (mode === 'coarse') v = clamp(Math.round(v / 3) * 3, 3, 15);
  return v;
}

function buildSegments(notes, offset, minDur, legato) {
  const segs = [];
  let cursor = offset;
  let dropped = 0;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const start = n.start + offset;
    if (start < cursor) {
      dropped++;
      continue;
    }
    if (start > cursor) segs.push({ kind: 'rest', dur: start - cursor });
    const next = notes[i + 1];
    const limit = next ? Math.max(minDur, next.start + offset - start) : Infinity;
    let target = Math.max(minDur, n.dur);
    if (legato) target = limit === Infinity ? target : limit;
    let dur = bestDuration(target, limit).ticks;
    if (dur > limit) dur = limit;
    segs.push({ kind: 'note', dur, pitch: n.pitch, vel: n.vel });
    cursor = start + dur;
  }
  return { segs, dropped };
}

function runLengths(segs) {
  const runs = new Array(segs.length);
  for (let i = segs.length - 1; i >= 0; i--) {
    runs[i] = i + 1 < segs.length && segs[i + 1].dur === segs[i].dur ? runs[i + 1] + 1 : 1;
  }
  return runs;
}

function pitchToken(midi, state, allowN) {
  const oct = octaveOf(midi);
  const name = nameOf(midi);
  const accidental = name.length > 1;
  let octStr = '';
  if (oct !== state.octave) {
    const delta = oct - state.octave;
    octStr = Math.abs(delta) === 1 ? (delta > 0 ? '>' : '<') : `o${oct}`;
  }
  const oCost = octStr.length + 1 + (accidental ? 1 : 0);
  if (allowN) {
    const nStr = `n${noteNumberOf(midi)}`;
    if (nStr.length < oCost) return { text: nStr, octave: state.octave };
  }
  return { text: octStr + name, octave: oct };
}

function encodeRest(ticks, state) {
  let out = '';
  let rem = ticks;
  if (rem >= WHOLE * 2) {
    const wholes = Math.floor(rem / WHOLE);
    if (state.length !== 1) {
      out += 'l1';
      state.length = 1;
    }
    out += 'r'.repeat(wholes);
    rem -= wholes * WHOLE;
  }
  let guard = 0;
  while (rem > 0 && guard++ < 64) {
    const d = largestAtMost(rem);
    if (!d || d.ticks > rem) break;
    out += d.l === state.length && !d.dotted ? 'r' : `r${d.text}`;
    rem -= d.ticks;
    if (d.ticks <= 0) break;
  }
  return out;
}

function lengthToken(term, state, run, allowL) {
  if (!term.dotted) {
    if (term.l === state.length) return '';
    if (allowL && run * term.text.length > 2 + term.text.length) {
      state.length = term.l;
      return `l${term.text}`;
    }
    return term.text;
  }
  return term.text;
}

export function encodePart(notes, options = {}) {
  const {
    bpm = 120,
    showTempo = true,
    useN = true,
    velocity = 'fine',
    ties = true,
    leadRest = false,
    initialVolume = 12,
    minDur = 20,
  } = options;

  const offset = leadRest ? WHOLE : 0;
  const { segs, dropped } = buildSegments(notes, offset, minDur, options.legato);
  const runs = runLengths(segs);
  const state = { octave: 4, length: 4, volume: -1 };

  let text = '';
  if (showTempo) text += `t${bpm}`;
  if (leadRest) text += 'r1';
  if (velocity === 'off') {
    text += `v${initialVolume}`;
    state.volume = initialVolume;
  }

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg.kind === 'rest') {
      text += encodeRest(seg.dur, state);
      continue;
    }

    if (seg.vel !== undefined && velocity !== 'off') {
      const v = velocityToV(seg.vel, velocity);
      if (v !== null && v !== state.volume) {
        text += `v${v}`;
        state.volume = v;
      }
    }

    if (!ties) {
      const single = durationByTicks(seg.dur) || largestAtMost(seg.dur);
      const t = lengthToken(single, state, runs[i], true);
      const pt = pitchToken(seg.pitch, state, useN && (t === '' || t.startsWith('l')));
      state.octave = pt.octave;
      text += t.startsWith('l') ? t + pt.text : pt.text + t;
      let rem = seg.dur - single.ticks;
      while (rem > 0) {
        const r = largestAtMost(rem);
        text += `r${r.text}`;
        rem -= r.ticks;
      }
      continue;
    }

    const terms = decompose(seg.dur, 4) || [largestAtMost(seg.dur)];
    for (let k = 0; k < terms.length; k++) {
      const term = terms[k];
      if (k === 0) {
        const t = lengthToken(term, state, runs[i], true);
        const pt = pitchToken(seg.pitch, state, useN && (t === '' || t.startsWith('l')));
        state.octave = pt.octave;
        text += t.startsWith('l') ? t + pt.text : pt.text + t;
      } else {
        const pt = pitchToken(seg.pitch, state, false);
        state.octave = pt.octave;
        const t = lengthToken(term, state, 1, false);
        text += `&${pt.text}${t}`;
      }
    }
  }

  return { text, chars: text.length, dropped, segments: segs.length };
}

export function encodeScore(parts, options = {}) {
  const { bpm = 120, tieMode = 'melody', useN = true, velocity = 'fine', leadRest = false } = options;
  const encoded = parts.map((notes, index) => {
    const ties = tieMode === 'all' ? true : tieMode === 'none' ? false : index === 0;
    return {
      index,
      ...encodePart(notes, {
        bpm,
        showTempo: index === 0 || options.tempoEveryPart,
        useN,
        velocity,
        ties,
        leadRest,
        minDur: options.minDur,
      }),
    };
  });
  return encoded;
}
