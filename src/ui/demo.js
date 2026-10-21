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
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

function trackChunk(events) {
  const body = [];
  let last = 0;
  for (const ev of events) {
    body.push(...vlq(ev.tick - last));
    last = ev.tick;
    body.push(...ev.bytes);
  }
  body.push(0, 0xff, 0x2f, 0);
  return [...ascii('MTrk'), ...u32(body.length), ...body];
}

function build(tracks, division, bpm) {
  const us = Math.round(60000000 / bpm);
  const conductor = [
    { tick: 0, bytes: [0xff, 0x03, 4, ...ascii('meta')] },
    { tick: 0, bytes: [0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] },
    { tick: 0, bytes: [0xff, 0x58, 4, 4, 2, 24, 8] },
  ];
  const chunks = [trackChunk(conductor)];
  for (const track of tracks) {
    const events = [{ tick: 0, bytes: [0xff, 0x03, track.name.length, ...ascii(track.name)] }];
    const ch = track.ch ?? 0;
    events.push({ tick: 0, bytes: [0xc0 | ch, track.program ?? 0] });
    for (const n of track.notes) {
      events.push({ tick: n.start, bytes: [0x90 | ch, n.pitch, n.vel ?? 100] });
      events.push({ tick: n.start + n.dur, bytes: [0x80 | ch, n.pitch, 0] });
    }
    const rank = (b) => (b[0] === 0xff ? 0 : (b[0] & 0xf0) === 0x80 ? 1 : 2);
    events.sort((a, b) => a.tick - b.tick || rank(a.bytes) - rank(b.bytes));
    chunks.push(trackChunk(events));
  }
  return new Uint8Array([
    ...ascii('MThd'),
    ...u32(6),
    ...u16(1),
    ...u16(chunks.length),
    ...u16(division),
    ...chunks.flat(),
  ]);
}

export function demoMidi() {
  const division = 480;
  const beat = 480;
  const bar = beat * 4;
  const bpm = 104;

  const prog = [
    { root: 45, tones: [57, 60, 64] },
    { root: 41, tones: [53, 57, 60] },
    { root: 48, tones: [55, 60, 64] },
    { root: 43, tones: [50, 55, 59] },
  ];

  const melodyShape = [
    [76, 1], [74, 0.5], [72, 0.5], [69, 1], [72, 1],
    [69, 1], [72, 0.5], [74, 0.5], [76, 1], [72, 1],
    [79, 1], [76, 0.5], [74, 0.5], [72, 1], [67, 1],
    [71, 1], [74, 1], [72, 1], [67, 1],
    [76, 0.5], [79, 0.5], [81, 1], [79, 1], [76, 1],
    [77, 1], [76, 0.5], [74, 0.5], [72, 1], [69, 1],
    [72, 0.5], [74, 0.5], [76, 1], [79, 1], [76, 1],
    [74, 1], [71, 1], [69, 1], [72, 1],
  ];

  const melody = [];
  let t = 0;
  for (const [pitch, len] of melodyShape) {
    melody.push({ start: Math.round(t), dur: Math.round(len * beat * 0.94), pitch, vel: 104 });
    t += len * beat;
  }

  const arp = [];
  for (let b = 0; b < 8; b++) {
    const { tones } = prog[b % 4];
    const seq = [tones[0], tones[1], tones[2], tones[1] + 12, tones[2], tones[1], tones[0], tones[1]];
    seq.forEach((pitch, i) => {
      arp.push({ start: b * bar + i * (beat / 2), dur: beat / 2 - 24, pitch: pitch + 12, vel: 62 });
    });
  }

  const bass = [];
  for (let b = 0; b < 8; b++) {
    const { root } = prog[b % 4];
    bass.push({ start: b * bar, dur: beat * 2 - 30, pitch: root - 12, vel: 88 });
    bass.push({ start: b * bar + beat * 2, dur: beat * 2 - 30, pitch: root - 5, vel: 78 });
  }

  const pad = [];
  for (let b = 0; b < 8; b++) {
    for (const pitch of prog[b % 4].tones) {
      pad.push({ start: b * bar, dur: bar - 40, pitch: pitch - 12, vel: 52 });
    }
  }

  return build(
    [
      { name: 'Melody', notes: melody, ch: 0, program: 73 },
      { name: 'Arpeggio', notes: arp, ch: 1, program: 46 },
      { name: 'Bass', notes: bass, ch: 2, program: 33 },
      { name: 'Pad', notes: pad, ch: 3, program: 89 },
    ],
    division,
    bpm,
  );
}
