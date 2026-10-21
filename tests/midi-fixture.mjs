const vlq = (value) => {
  const bytes = [value & 0x7f];
  let v = value >> 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
};

const u32 = (v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const u16 = (v) => [(v >>> 8) & 0xff, v & 0xff];
const str = (s) => [...s].map((c) => c.charCodeAt(0));

function trackChunk(events) {
  const body = [];
  let last = 0;
  for (const ev of events) {
    body.push(...vlq(ev.tick - last));
    last = ev.tick;
    body.push(...ev.bytes);
  }
  body.push(0, 0xff, 0x2f, 0);
  return [...str('MTrk'), ...u32(body.length), ...body];
}

export function makeMidi(tracks, { division = 480, bpm = 120, tempoMap = null } = {}) {
  const conductor = [
    { tick: 0, bytes: [0xff, 0x03, 4, ...str('meta')] },
    { tick: 0, bytes: [0xff, 0x51, 3, (500000 >> 16) & 0xff, (500000 >> 8) & 0xff, 500000 & 0xff] },
    { tick: 0, bytes: [0xff, 0x58, 4, 4, 2, 24, 8] },
  ];
  const tempos = tempoMap || (bpm !== 120 ? [{ tick: 0, bpm }] : []);
  for (const t of tempos) {
    const us = Math.round(60000000 / t.bpm);
    conductor.push({ tick: t.tick, bytes: [0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] });
  }

  const chunks = [trackChunk(conductor)];
  tracks.forEach((track, ti) => {
    const events = [{ tick: 0, bytes: [0xff, 0x03, track.name.length, ...str(track.name)] }];
    const ch = track.ch ?? 0;
    if (track.program !== undefined) events.push({ tick: 0, bytes: [0xc0 | ch, track.program] });
    for (const n of track.notes) {
      events.push({ tick: n.start, bytes: [0x90 | ch, n.pitch, n.vel ?? 100] });
      events.push({ tick: n.start + n.dur, bytes: [0x80 | ch, n.pitch, 0] });
    }
    const rank = (bytes) => (bytes[0] === 0xff ? 0 : (bytes[0] & 0xf0) === 0x80 ? 1 : 2);
    events.sort((a, b) => a.tick - b.tick || rank(a.bytes) - rank(b.bytes));
    chunks.push(trackChunk(events));
  });

  return new Uint8Array([
    ...str('MThd'),
    ...u32(6),
    ...u16(1),
    ...u16(chunks.length),
    ...u16(division),
    ...chunks.flat(),
  ]);
}

export function demoMidi() {
  const step = 480 / 2;
  const melodyPitches = [
    60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60,
  ];
  const melody = [];
  for (let rep = 0; rep < 4; rep++) {
    melodyPitches.forEach((pitch, i) => {
      melody.push({ start: rep * 14 * step + i * step, dur: step * 0.95, pitch, vel: 100 });
    });
  }
  const chords = [];
  const roots = [48, 53, 55, 48, 53, 55, 48];
  roots.forEach((root, bar) => {
    [0, 2, 4].forEach((iv) => {
      chords.push({ start: bar * 4 * 480, dur: 4 * 480 - 30, pitch: root + iv, vel: 70 });
    });
  });
  const bass = roots.map((root, bar) => ({
    start: bar * 4 * 480,
    dur: 2 * 480,
    pitch: root - 12,
    vel: 85,
  }));

  return makeMidi(
    [
      { name: 'Melody', notes: melody, ch: 0 },
      { name: 'Chord', notes: chords, ch: 1 },
      { name: 'Bass', notes: bass, ch: 2 },
    ],
    { division: 480, bpm: 120 },
  );
}

export function randomMidi(seed = 1) {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const notes = [];
  let t = 0;
  for (let i = 0; i < 120; i++) {
    const dur = [120, 240, 360, 480, 720, 960][Math.floor(rnd() * 6)];
    notes.push({ start: t, dur: Math.round(dur * (0.55 + rnd() * 0.35)), pitch: 45 + Math.floor(rnd() * 36), vel: 40 + Math.floor(rnd() * 80) });
    t += dur;
  }
  return makeMidi([{ name: 'Random', notes, ch: 0 }], { division: 480, bpm: 96 });
}
