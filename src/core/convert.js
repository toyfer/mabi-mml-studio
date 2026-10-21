import { parseMidi } from './midi.js';
import {
  buildTempoSegments,
  detectBpm,
  flattenToTicks,
  transposeToRange,
  fitWholeSong,
  tempoChangeCount,
} from './quantize.js';
import { dedupeNotes, allocateParts, maxPolyphony } from './allocate.js';
import { encodeScore, encodePart } from './encode.js';
import { LIMITS, WHOLE, TPQN, clamp, instrumentById, PART_NAMES } from './spec.js';

export const VERSION = '1.0.0';

const GRIDS = [10, 20, 40, 60, 80, 120, 160, 240, 320, 480];

export const DEFAULT_OPTIONS = {
  parts: 3,
  instrument: 'lute',
  bpm: null,
  grid: 20,
  transpose: 0,
  charLimit: LIMITS.charsPerPart,
  rangePolicy: 'octave',
  assignment: 'auto',
  tieMode: 'melody',
  useN: true,
  velocity: 'fine',
  leadRest: 'auto',
  autoFit: true,
  autoReduce: true,
  trim: false,
  tempoEveryPart: true,
  minDur: 20,
};

function normalizeOptions(input = {}, detectedBpm = 120) {
  const o = { ...DEFAULT_OPTIONS, ...input };
  const grid = GRIDS.reduce((best, g) => (Math.abs(g - o.grid) < Math.abs(best - o.grid) ? g : best), GRIDS[0]);
  return {
    ...o,
    parts: clamp(Math.round(o.parts), 1, LIMITS.parts),
    instrument: instrumentById(o.instrument).id,
    bpm: o.bpm ? clamp(Math.round(o.bpm), LIMITS.tempoMin, LIMITS.tempoMax) : detectedBpm,
    grid,
    transpose: clamp(Math.round(o.transpose || 0), -36, 36),
    charLimit: clamp(Math.round(o.charLimit || LIMITS.charsPerPart), 200, 20000),
    minDur: Math.max(10, grid),
  };
}

function prepare(notes, opts, bpm, grid) {
  const flat = flattenToTicks(notes, opts.segs, bpm, grid);
  let list = flat;
  if (opts.transpose) list = list.map((n) => ({ ...n, pitch: n.pitch + opts.transpose }));

  let shift = 0;
  if (opts.autoFit) {
    const fit = fitWholeSong(list, { midiMin: LIMITS.midiMin, midiMax: LIMITS.midiMax });
    list = fit.notes;
    shift += fit.shift;
  }
  const ranged = transposeToRange(list, {
    midiMin: LIMITS.midiMin,
    midiMax: LIMITS.midiMax,
    policy: opts.rangePolicy,
  });
  return { notes: dedupeNotes(ranged.notes, grid), shift, ranged };
}

function encodeAll(noteList, opts, bpm, grid, leadRest) {
  const enc = encodeScore(noteList, {
    bpm,
    tieMode: opts.tieMode,
    useN: opts.useN,
    velocity: opts.velocity,
    leadRest,
    tempoEveryPart: opts.tempoEveryPart,
    minDur: grid,
  });
  const parts = enc.map((p, i) => ({
    index: i,
    name: PART_NAMES[i] || `パート${i + 1}`,
    mml: p.text,
    chars: p.chars,
    notes: noteList[i] ? noteList[i].length : 0,
    over: p.chars > opts.charLimit,
  }));
  return { parts, noteList, maxChars: Math.max(0, ...parts.map((p) => p.chars)) };
}

function smoothVelocity(notes) {
  if (notes.length < 3) return notes;
  const sorted = notes.map((n) => n.vel).sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))];
  if (q(0.9) - q(0.1) < 24) {
    const med = q(0.5);
    return notes.map((n) => ({ ...n, vel: med }));
  }
  return notes.map((n, i) => {
    const win = notes
      .slice(Math.max(0, i - 2), i + 3)
      .map((x) => x.vel)
      .sort((a, b) => a - b);
    return { ...n, vel: win[Math.floor(win.length / 2)] };
  });
}

function attempt(midiNotes, opts, bpm, grid, partCount) {
  const prep = prepare(midiNotes, opts, bpm, grid);
  const alloc = allocateParts(prep.notes, { parts: partCount, mode: opts.assignment, minDur: grid });
  alloc.parts = alloc.parts.map(smoothVelocity);
  const leadRest = opts.leadRest === 'always' || (opts.leadRest === 'auto' && shouldLeadRest(alloc.parts));
  const encoded = encodeAll(alloc.parts, opts, bpm, grid, leadRest);
  return {
    ...encoded,
    grid,
    shift: prep.shift,
    clamped: prep.ranged.clamped,
    dropped: alloc.dropped,
    leadRest,
  };
}

function shouldLeadRest(parts) {
  if (!parts.length || !parts[0] || !parts[0].length) return false;
  const hasHarmony = parts.slice(1).some((p) => p && p.length);
  return hasHarmony && parts[0][0].start >= WHOLE * 2;
}

function partChars(notes, opts, bpm, grid, leadRest, index) {
  const ties = opts.tieMode === 'all' ? true : opts.tieMode === 'none' ? false : index === 0;
  return encodePart(notes, {
    bpm,
    showTempo: index === 0 || opts.tempoEveryPart,
    useN: opts.useN,
    velocity: opts.velocity,
    ties,
    leadRest,
    minDur: grid,
  }).chars;
}

function splitOverflow(noteList, opts, bpm, grid, leadRest, maxParts) {
  const parts = noteList.filter((n) => n.length > 0);
  let guard = 0;
  while (guard++ < 24 && parts.length < maxParts) {
    const sizes = parts.map((p, i) => partChars(p, opts, bpm, grid, leadRest, i));
    const idx = sizes.findIndex((c) => c > opts.charLimit);
    if (idx < 0) break;
    const target = parts[idx];
    if (target.length < 2) break;
    const half = Math.ceil(target.length / 2);
    parts.splice(idx, 1, target.slice(0, half), target.slice(half));
  }
  return parts;
}

function dropToFit(noteList, opts, bpm, grid, leadRest, maxParts) {
  let list = noteList;
  let result = encodeAll(list, opts, bpm, grid, leadRest);
  let guard = 0;
  while (result.maxChars > opts.charLimit && guard++ < 10) {
    list = list.map((part, pi) => {
      const chars = result.parts[pi] ? result.parts[pi].chars : 0;
      if (chars <= opts.charLimit || part.length < 2) return part;
      const ratio = Math.min(0.98, Math.max(0.1, opts.charLimit / chars));
      const scored = part.map((n) => {
        const beatPos = n.start % TPQN;
        const metric = beatPos === 0 ? 1 : beatPos % (TPQN / 2) === 0 ? 0.85 : 0.55;
        return { n, score: n.vel * Math.min(n.dur, 960) * metric };
      });
      scored.sort((a, b) => b.score - a.score);
      const keep = new Set(scored.slice(0, Math.max(4, Math.floor(scored.length * ratio))).map((x) => x.n));
      return part.filter((n) => keep.has(n));
    });
    const split = splitOverflow(list, opts, bpm, grid, leadRest, maxParts);
    result = encodeAll(split, opts, bpm, grid, leadRest);
  }
  return result;
}

function truncateToFit(noteList, opts, bpm, grid, leadRest) {
  const last = Math.max(0, ...noteList.flat().map((n) => n.start + n.dur));
  let lo = 0;
  let hi = last;
  let best = null;
  for (let i = 0; i < 16; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const cut = noteList.map((part) =>
      part
        .filter((n) => n.start < mid)
        .map((n) => ({ ...n, dur: Math.min(n.dur, Math.max(grid, mid - n.start)) })),
    );
    const enc = encodeAll(cut, opts, bpm, grid, leadRest);
    if (enc.maxChars <= opts.charLimit) {
      best = { ...enc, cut, at: mid };
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

export function convertMidi(input, userOptions = {}) {
  const midi = parseMidi(input);
  if (!midi.notes.length) throw new Error('ノートが1つも含まれていません');

  const segs = buildTempoSegments(midi.tempos, midi.division);
  const detected = detectBpm(segs, midi.lastTick);
  const opts = normalizeOptions(userOptions, detected);
  opts.segs = segs;
  const bpm = opts.bpm;
  const warnings = [];
  const inputPoly = maxPolyphony(midi.notes);
  const changes = tempoChangeCount(segs);

  if (changes > 0) {
    warnings.push({
      level: 'info',
      code: 'tempo-flatten',
      message: `テンポ変更を${changes}箇所検出しました。マビノギモバイルでは和音パートの途中テンポ変更が反映されないため、${bpm} BPMの一定テンポに平坦化しています（実時間は保持）。`,
    });
  }

  const grids = [...new Set([opts.grid, 40, 60, 80, 120, 160, 240].filter((g) => g >= opts.grid))];
  const splitCap = opts.parts > LIMITS.soloParts ? LIMITS.parts : opts.parts;
  let result = null;
  for (const grid of grids) {
    const candidate = attempt(midi.notes, opts, bpm, grid, opts.parts);
    if (!result || candidate.maxChars < result.maxChars) result = candidate;
    if (candidate.maxChars <= opts.charLimit) {
      result = candidate;
      break;
    }
  }
  let trimmedAt = null;

  if (result.maxChars > opts.charLimit) {
    const split = splitOverflow(result.noteList, opts, bpm, result.grid, result.leadRest, splitCap);
    const splitResult = encodeAll(split, opts, bpm, result.grid, result.leadRest);
    if (splitResult.maxChars < result.maxChars) {
      result = { ...result, ...splitResult };
      if (splitResult.maxChars <= opts.charLimit) {
        warnings.push({
          level: 'info',
          code: 'char-split',
          message: `1パートが${opts.charLimit}文字を超えるため、パートを${split.length}本に分割して収めました（音は欠けていません）。`,
        });
      }
    }
  }

  if (result.maxChars > opts.charLimit && opts.autoReduce) {
    const before = result.maxChars;
    const dropped = dropToFit(result.noteList, opts, bpm, result.grid, result.leadRest, splitCap);
    if (dropped.maxChars < result.maxChars) {
      result = { ...result, ...dropped };
      warnings.push({
        level: 'warn',
        code: 'char-drop',
        message: `文字数上限に収めるため、優先度の低い音符を削減しました（最大${before}文字 → ${dropped.maxChars}文字）。`,
      });
    }
  }

  if (result.maxChars > opts.charLimit && opts.trim) {
    const trimmed = truncateToFit(result.noteList, opts, bpm, result.grid, result.leadRest);
    if (trimmed) {
      result = { ...result, ...trimmed };
      trimmedAt = trimmed.at;
      warnings.push({
        level: 'warn',
        code: 'trim',
        message: `曲を${(trimmed.at / WHOLE).toFixed(1)}小節で打ち切りました（文字数上限）。`,
      });
    }
  }

  if (result.maxChars > opts.charLimit) {
    warnings.push({
      level: 'error',
      code: 'overflow',
      message: `文字数上限を超えています（最大${result.maxChars}文字）。クオンタイズを粗くするか、パート数を増やしてください。`,
    });
  }
  if (result.grid > opts.grid) {
    warnings.push({
      level: 'info',
      code: 'char-compress',
      message: `文字数を抑えるためクオンタイズを 1/${Math.round(WHOLE / result.grid)} 音符まで粗くしました。`,
    });
  }
  if (result.shift) {
    warnings.push({
      level: 'info',
      code: 'range-shift',
      message: `MMLの音域（o0〜o8）に収めるため、全体を${result.shift > 0 ? '+' : ''}${result.shift}半音移調しました。`,
    });
  }
  if (result.clamped) {
    warnings.push({
      level: 'warn',
      code: 'range-clamp',
      message: `${result.clamped}音が音域外のため丸められました。`,
    });
  }
  const usedParts = result.parts.filter((p) => p.notes > 0).length;
  if (usedParts > LIMITS.soloParts) {
    warnings.push({
      level: 'info',
      code: 'solo-parts',
      message: `${usedParts}パート出力です。4パート目以降は合奏でのみ鳴るため、ソロ演奏では3パートまでとなります。`,
    });
  }
  if (inputPoly > LIMITS.polyphony) {
    warnings.push({
      level: 'warn',
      code: 'polyphony',
      message: `入力の同時発音数は最大${inputPoly}音でした。マビノギモバイルは1人あたり約15音が上限のため、音が欠ける場合があります。`,
    });
  }
  if (opts.tieMode !== 'all' && result.parts.some((p) => p.mml.includes('&'))) {
    warnings.push({
      level: 'info',
      code: 'tie-mode',
      message:
        opts.tieMode === 'melody'
          ? 'タイ（&）はメロディのみで使用し、和音パートは「音符＋休符」で拍を合わせています（和音での&不具合の回避）。'
          : 'タイ（&）を全パートで無効化し、音符＋休符で拍を合わせています。',
    });
  }
  if (result.dropped) {
    warnings.push({
      level: 'info',
      code: 'voice-drop',
      message: `同時に鳴る音がパート数を超えたため、${result.dropped}音を省略しました。パート数を増やすと残せます。`,
    });
  }

  const outNotes = result.noteList.flat();
  const lastTick = outNotes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  const durationSec = (lastTick / TPQN) * (60 / bpm);
  const parts = result.parts.filter((p) => p.notes > 0);
  const finalParts = parts.length ? parts : [result.parts[0]];
  const combined = `MML@${finalParts.map((p) => p.mml).join(',')};`;

  return {
    ok: true,
    version: VERSION,
    format: midi.format,
    bpm,
    detectedBpm: detected,
    grid: result.grid,
    resolution: Math.round(WHOLE / result.grid),
    partCount: finalParts.length,
    parts: finalParts,
    combined,
    stats: {
      inputNotes: midi.notes.length,
      outputNotes: finalParts.reduce((s, p) => s + p.notes, 0),
      dropped: result.dropped,
      maxChars: result.maxChars,
      charsTotal: finalParts.reduce((s, p) => s + p.chars, 0),
      durationSec,
      maxPolyphony: inputPoly,
      tempoChanges: changes,
      shift: result.shift,
      trimmedAt,
      tracks: midi.tracks.length,
    },
    warnings,
  };
}

export function convertMidiBase64(b64, options = {}) {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return convertMidi(bytes, options);
}
