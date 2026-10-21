class Reader {
  constructor(bytes) {
    this.b = bytes;
    this.p = 0;
  }
  u8() {
    return this.b[this.p++];
  }
  u16() {
    const v = (this.b[this.p] << 8) | this.b[this.p + 1];
    this.p += 2;
    return v;
  }
  u32() {
    const v =
      ((this.b[this.p] << 24) | (this.b[this.p + 1] << 16) | (this.b[this.p + 2] << 8) | this.b[this.p + 3]) >>> 0;
    this.p += 4;
    return v;
  }
  str(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.b[this.p++]);
    return s;
  }
  vlq() {
    let v = 0;
    let c;
    do {
      c = this.u8();
      v = (v << 7) | (c & 0x7f);
    } while (c & 0x80);
    return v;
  }
  get eof() {
    return this.p >= this.b.length;
  }
}

const peekText = (r, len) => {
  let s = '';
  for (let i = 0; i < len; i++) {
    const c = r.b[r.p + i];
    if (c >= 0x20 && c < 0x7f) s += String.fromCharCode(c);
  }
  return s.trim();
};

export function parseMidi(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 14) throw new Error('MIDIデータが短すぎます');
  const r = new Reader(bytes);
  if (r.str(4) !== 'MThd') throw new Error('MThdヘッダが見つかりません（MIDIファイルではありません）');
  const headerLen = r.u32();
  const format = r.u16();
  const declaredTracks = r.u16();
  const division = r.u16();
  r.p += Math.max(0, headerLen - 6);
  if (division & 0x8000) throw new Error('SMPTE形式（フレーム基準）のMIDIには未対応です');
  if (!division) throw new Error('分解能（division）が0です');

  const tracks = [];
  while (r.p + 8 <= bytes.length && tracks.length < Math.max(declaredTracks, 1)) {
    const id = r.str(4);
    const len = r.u32();
    if (id !== 'MTrk') {
      r.p += len;
      continue;
    }
    const end = Math.min(r.p + len, bytes.length);
    tracks.push(readTrack(r, end, tracks.length));
    r.p = end;
  }
  if (!tracks.length) throw new Error('トラックチャンクが見つかりません');

  const notes = [];
  const tempos = [];
  const timeSigs = [];
  const trackNames = [];
  for (const t of tracks) {
    notes.push(...t.notes);
    tempos.push(...t.tempos);
    timeSigs.push(...t.timeSigs);
    trackNames.push(t.name);
  }
  tempos.sort((a, b) => a.tick - b.tick);

  const lastTick = notes.reduce((m, n) => Math.max(m, n.end), 0);
  return { format, division, tracks, notes, tempos, timeSigs, trackNames, lastTick };
}

function readTrack(r, end, index) {
  let tick = 0;
  let running = 0;
  let name = '';
  let program = 0;
  const notes = [];
  const tempos = [];
  const timeSigs = [];
  const open = new Map();
  const programs = new Map();

  while (r.p < end) {
    const delta = r.vlq();
    tick += delta;
    if (r.p >= end) break;
    let status = r.b[r.p];
    if (status & 0x80) {
      r.p++;
      if (status < 0xf0) running = status;
    } else {
      if (!running) {
        r.p++;
        continue;
      }
      status = running;
    }

    if (status === 0xff) {
      const meta = r.u8();
      const len = r.vlq();
      if (meta === 0x51 && len >= 3) {
        const us = (r.b[r.p] << 16) | (r.b[r.p + 1] << 8) | r.b[r.p + 2];
        tempos.push({ tick, us });
        r.p += len;
      } else if (meta === 0x58 && len >= 2) {
        timeSigs.push({ tick, num: r.b[r.p], den: 1 << r.b[r.p + 1] });
        r.p += len;
      } else if (meta === 0x03 || meta === 0x04) {
        name = name || peekText(r, len);
        r.p += len;
      } else {
        r.p += len;
      }
      running = 0;
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      const len = r.vlq();
      r.p += len;
      running = 0;
      continue;
    }

    const type = status & 0xf0;
    const ch = status & 0x0f;
    if (type === 0x90) {
      const pitch = r.u8();
      const vel = r.u8();
      const key = ch * 128 + pitch;
      if (vel > 0) {
        if (!open.has(key)) open.set(key, []);
        open.get(key).push({ tick, vel });
      } else {
        closeNote(notes, open, key, tick, ch, pitch, program, index);
      }
    } else if (type === 0x80) {
      const pitch = r.u8();
      r.u8();
      closeNote(notes, open, ch * 128 + pitch, tick, ch, pitch, program, index);
    } else if (type === 0xc0) {
      program = r.u8();
      programs.set(ch, program);
    } else if (type === 0xb0 || type === 0xa0 || type === 0xe0) {
      r.p += 2;
    } else if (type === 0xd0) {
      r.p += 1;
    } else {
      r.p += 1;
    }
  }

  for (const [key, stack] of open) {
    const pitch = key % 128;
    for (const on of stack) {
      notes.push({
        start: on.tick,
        end: Math.max(on.tick + 1, tick),
        pitch,
        vel: on.vel,
        ch: Math.floor(key / 128),
        trk: index,
        prog: program,
      });
    }
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return { name, notes, tempos, timeSigs, programs, index };
}

function closeNote(notes, open, key, tick, ch, pitch, program, trk) {
  const stack = open.get(key);
  if (!stack || !stack.length) return;
  const on = stack.shift();
  if (!stack.length) open.delete(key);
  notes.push({
    start: on.tick,
    end: Math.max(on.tick + 1, tick),
    pitch,
    vel: on.vel,
    ch,
    trk,
    prog: program,
  });
}
