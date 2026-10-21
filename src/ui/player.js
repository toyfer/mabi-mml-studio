import { parseScore } from '../core/mml.js';
import { instrumentById, TPQN } from '../core/spec.js';

const VOICE = {
  sine: { a: 0.035, d: 0.09, s: 0.72, r: 0.18, gain: 0.16 },
  triangle: { a: 0.008, d: 0.07, s: 0.55, r: 0.13, gain: 0.15 },
  sawtooth: { a: 0.014, d: 0.1, s: 0.5, r: 0.11, gain: 0.09 },
  square: { a: 0.002, d: 0.05, s: 0.18, r: 0.07, gain: 0.07 },
};

export class MabiPlayer {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.active = new Set();
    this.playing = false;
    this.events = [];
    this.tempos = [];
    this.origin = 0;
    this.cursor = 0;
    this.timer = null;
    this.raf = null;
    this.volume = 0.8;
    this.muted = new Set();
    this.solo = null;
    this.tone = 'triangle';
    this.onTick = null;
    this.durationTick = 0;
    this.playhead = 0;
  }

  ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(this.ctx.destination);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  load(texts, { instrument = 'lute' } = {}) {
    this.stop();
    this.map = null;
    this.tone = instrumentById(instrument).tone;
    const parsed = texts.map((t) => parseScore(t)[0]);
    this.tempos = buildTempoMap(parsed);
    this.durationTick = Math.max(0, ...parsed.map((p) => p.duration));
    const events = [];
    parsed.forEach((p, part) => {
      for (const e of p.events) {
        const sec = this.secAt(e.start);
        const end = this.secAt(e.start + e.dur);
        events.push({ part, pitch: e.pitch, vel: e.vel, sec, durSec: Math.max(0.04, end - sec), start: e.start, dur: e.dur, scheduled: false });
      }
    });
    events.sort((a, b) => a.sec - b.sec);
    this.events = events;
    this.playhead = 0;
  }

  buildMap() {
    const map = [];
    let sec = 0;
    let prev = { tick: 0, bpm: 120 };
    const list = this.tempos.length ? this.tempos : [{ tick: 0, bpm: 120 }];
    for (let i = 0; i < list.length; i++) {
      const cur = list[i];
      if (i === 0 && cur.tick > 0) {
        map.push({ tick: 0, sec: 0, bpm: 120 });
        sec += (cur.tick / TPQN) * (60 / 120);
      }
      map.push({ tick: cur.tick, sec, bpm: cur.bpm });
      const next = list[i + 1];
      if (next) sec += ((next.tick - cur.tick) / TPQN) * (60 / cur.bpm);
      prev = cur;
    }
    if (!map.length) map.push({ tick: 0, sec: 0, bpm: prev.bpm });
    return map;
  }

  secAt(tick) {
    if (!this.map) this.map = this.buildMap();
    const map = this.map;
    let lo = 0;
    let hi = map.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (map[mid].tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    const s = map[lo];
    return s.sec + ((tick - s.tick) / TPQN) * (60 / s.bpm);
  }

  tickAt(sec) {
    if (!this.map) this.map = this.buildMap();
    const map = this.map;
    let lo = 0;
    let hi = map.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (map[mid].sec <= sec) lo = mid;
      else hi = mid - 1;
    }
    const s = map[lo];
    return s.tick + ((sec - s.sec) / (60 / s.bpm)) * TPQN;
  }

  play(fromTick = 0) {
    this.ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.stopNodes();
    if (!this.map) this.map = this.buildMap();
    const startSec = this.secAt(fromTick);
    this.origin = this.ctx.currentTime + 0.1 - startSec;
    this.playhead = fromTick;
    this.cursor = 0;
    this.playing = true;
    for (const e of this.events) e.scheduled = false;

    for (const e of this.events) {
      if (e.start < fromTick && e.start + e.dur > fromTick) {
        e.scheduled = true;
        this.schedule(e, this.ctx.currentTime + 0.05, fromTick);
      }
    }
    this.timer = setInterval(() => this.pump(), 40);
    this.pump();
    this.loop();
  }

  pump() {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    const horizon = now + 0.6;
    while (this.cursor < this.events.length) {
      const e = this.events[this.cursor];
      const at = this.origin + e.sec;
      if (at > horizon) break;
      if (!e.scheduled) {
        e.scheduled = true;
        if (at + e.durSec > now) this.schedule(e, Math.max(now + 0.01, at));
      }
      this.cursor++;
    }
  }

  schedule(e, when, fromTick = null) {
    if (this.muted.has(e.part)) return;
    if (this.solo !== null && this.solo !== e.part) return;
    const v = VOICE[this.tone] || VOICE.triangle;
    const freq = 440 * Math.pow(2, (e.pitch - 69) / 12);
    const osc = this.ctx.createOscillator();
    osc.type = this.tone;
    osc.frequency.value = freq;

    let dur = e.durSec;
    if (fromTick !== null) {
      dur = Math.max(0.05, this.secAt(e.start + e.dur) - this.secAt(fromTick));
    }
    const peak = Math.max(0.012, (e.vel / 15) * v.gain);
    const g = this.ctx.createGain();
    const attack = Math.min(v.a, dur * 0.4);
    const decay = Math.min(v.d, Math.max(0.02, dur * 0.5));
    const sustain = peak * v.s;
    const release = v.r;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, sustain), when + attack + decay);
    g.gain.setValueAtTime(Math.max(0.0002, sustain), when + Math.max(attack + decay, dur * 0.92));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + release);

    osc.connect(g).connect(this.master);
    osc.start(when);
    osc.stop(when + dur + release + 0.03);
    this.active.add(osc);
    osc.onended = () => this.active.delete(osc);
  }

  loop() {
    const step = () => {
      if (!this.playing) return;
      const now = this.ctx.currentTime;
      const tick = this.tickAt(now - this.origin);
      this.playhead = Math.max(0, tick);
      if (this.onTick) this.onTick(this.playhead);
      if (now - this.origin > this.secAt(this.durationTick) + 0.4) {
        this.stop();
        if (this.onTick) this.onTick(this.durationTick);
        return;
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  stopNodes() {
    if (this.timer) clearInterval(this.timer);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.timer = null;
    this.raf = null;
    for (const osc of this.active) {
      try {
        osc.stop();
      } catch (err) {
        /* already stopped */
      }
    }
    this.active.clear();
  }

  stop() {
    this.playing = false;
    this.stopNodes();
    this.playhead = 0;
    if (this.onTick) this.onTick(0);
  }

  pause() {
    this.playing = false;
    this.stopNodes();
  }

  seek(tick) {
    this.playhead = tick;
    if (this.playing) this.play(tick);
    else if (this.onTick) this.onTick(tick);
  }
}

function buildTempoMap(parsed) {
  const primary = parsed[0] && parsed[0].tempos && parsed[0].tempos.length ? parsed[0].tempos : null;
  const fallback = parsed.find((p) => p.tempos && p.tempos.length);
  const list = [...((primary || fallback || [{ tick: 0, bpm: 120 }]))].sort((a, b) => a.tick - b.tick);
  const out = [];
  for (const t of list) {
    if (out.length && out[out.length - 1].tick === t.tick) out[out.length - 1].bpm = t.bpm;
    else out.push({ tick: t.tick, bpm: t.bpm });
  }
  if (!out.length || out[0].tick !== 0) out.unshift({ tick: 0, bpm: out.length ? out[0].bpm : 120 });
  return out;
}
