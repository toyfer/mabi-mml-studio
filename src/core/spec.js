export const TPQN = 960;
export const WHOLE = TPQN * 4;

export const LIMITS = {
  parts: 6,
  soloParts: 3,
  charsPerPart: 2400,
  octaveMin: 0,
  octaveMax: 8,
  midiMin: 12,
  midiMax: 108,
  tempoMin: 32,
  tempoMax: 255,
  volumeMin: 0,
  volumeMax: 15,
  polyphony: 6,
  lMax: 384,
};

export const NOTE_NAMES = ['c', 'c+', 'd', 'd+', 'e', 'f', 'f+', 'g', 'g+', 'a', 'a+', 'b'];

export const octaveOf = (midi) => Math.floor(midi / 12) - 1;
export const nameOf = (midi) => NOTE_NAMES[((midi % 12) + 12) % 12];
export const noteNumberOf = (midi) => midi - 12;

export const PART_NAMES = ['メロディ', '和音1', '和音2', '和音3', '和音4', '和音5'];

export const INSTRUMENTS = [
  { id: 'lute', name: 'リュート', voices: 3, safe: 11, tone: 'triangle' },
  { id: 'mandolin', name: 'マンドリン', voices: 1, safe: 11, tone: 'sawtooth' },
  { id: 'flute', name: 'フルート', voices: 1, safe: 11, tone: 'sine' },
  { id: 'violin', name: 'バイオリン', voices: 4, safe: 13, tone: 'sawtooth' },
  { id: 'salumo', name: 'シャルモ', voices: 5, safe: 8, tone: 'triangle' },
  { id: 'xylophone', name: 'シロフォン', voices: 6, safe: 14, tone: 'square' },
];

export const instrumentById = (id) => INSTRUMENTS.find((i) => i.id === id) || INSTRUMENTS[0];

export const DURATIONS = (() => {
  const map = new Map();
  const add = (ticks, text, l, dotted) => {
    if (!Number.isInteger(ticks) || ticks < 1) return;
    const prev = map.get(ticks);
    if (!prev || text.length < prev.text.length) map.set(ticks, { ticks, text, l, dotted });
  };
  for (let d = 1; d <= LIMITS.lMax; d++) {
    if (WHOLE % d === 0) add(WHOLE / d, String(d), d, false);
    if ((WHOLE * 1.5) % d === 0) add((WHOLE * 1.5) / d, String(d) + '.', d, true);
  }
  return [...map.values()].sort((a, b) => b.ticks - a.ticks);
})();

export const BASE_DURATIONS = DURATIONS.filter((d) => !d.dotted);

const DURATION_BY_TICKS = new Map(DURATIONS.map((d) => [d.ticks, d]));

export function durationByTicks(ticks) {
  return DURATION_BY_TICKS.get(ticks) || null;
}

export function decompose(ticks, maxTerms = 3) {
  if (ticks <= 0) return [];
  const out = [];
  let rem = ticks;
  while (rem > 0 && out.length < maxTerms) {
    const d = DURATIONS.find((x) => x.ticks <= rem);
    if (!d) return null;
    out.push(d);
    rem -= d.ticks;
  }
  return rem === 0 ? out : null;
}

export function nearestDuration(ticks) {
  let best = DURATIONS[0];
  let bestDiff = Infinity;
  for (const d of DURATIONS) {
    const diff = Math.abs(d.ticks - ticks);
    if (diff < bestDiff) {
      best = d;
      bestDiff = diff;
    }
  }
  return best;
}

export function bestDuration(target, max = Infinity) {
  let best = null;
  let bestDiff = Infinity;
  for (const d of DURATIONS) {
    if (d.ticks > max) continue;
    const diff = Math.abs(d.ticks - target);
    if (diff < bestDiff || (diff === bestDiff && best && d.ticks > best.ticks)) {
      best = d;
      bestDiff = diff;
    }
  }
  return best || DURATIONS[DURATIONS.length - 1];
}

export function largestAtMost(ticks) {
  return DURATIONS.find((d) => d.ticks <= ticks) || DURATIONS[DURATIONS.length - 1];
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
