import { octaveOf, LIMITS } from '../core/spec.js';

export const PART_COLORS = ['#7c9cff', '#4fe0c0', '#b78cff', '#ffb454', '#ff8fa3', '#7ee787'];

export class PianoRoll {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.duration = 1;
    this.playhead = null;
    this.active = 0;
    this.w = 0;
    this.h = 0;
    this.rowH = 6;
    this.hit = [];
    this.drag = null;
    this.preview = null;
    this.editable = true;
    this.onMove = null;
    this.onSeek = null;
    this.onSelect = null;
    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      this.draw();
    });
    this.bindPointer();
  }

  bindPointer() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.pointerDown(e));
    c.addEventListener('pointermove', (e) => this.pointerMove(e));
    c.addEventListener('pointerup', (e) => this.pointerUp(e));
    c.addEventListener('pointercancel', () => this.cancelDrag());
    c.addEventListener('pointerleave', () => {
      if (!this.drag) c.style.cursor = 'default';
    });
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setData(parts, duration, active = 0) {
    this.parts = parts;
    this.duration = Math.max(1, duration);
    this.active = active;
    this.draw();
  }

  setActive(active) {
    this.active = active;
    this.draw();
  }

  setPlayhead(tick) {
    const step = this.duration / Math.max(200, this.w || 200);
    if (this.playhead !== null && Math.abs(tick - this.playhead) < step && tick !== 0) return;
    this.playhead = tick;
    this.draw();
  }

  bounds() {
    let lo = 127;
    let hi = 0;
    for (const p of this.parts) for (const n of p) {
      lo = Math.min(lo, n.pitch);
      hi = Math.max(hi, n.pitch);
    }
    if (lo > hi) return { lo: 48, hi: 84 };
    const pad = 2;
    lo = Math.max(0, lo - pad);
    hi = Math.min(127, hi + pad);
    while (hi - lo < 24) {
      lo = Math.max(0, lo - 2);
      hi = Math.min(127, hi + 2);
    }
    return { lo, hi };
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  pick(x, y) {
    for (let i = this.hit.length - 1; i >= 0; i--) {
      const h = this.hit[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }

  pointerDown(e) {
    const { x, y } = this.pos(e);
    const hit = this.pick(x, y);
    if (!hit) {
      if (this.onSeek) this.onSeek((x / this.w) * this.duration);
      return;
    }
    if (hit.part !== this.active) {
      if (this.onSelect) this.onSelect(hit.part);
      return;
    }
    if (!this.editable) return;
    this.drag = { part: hit.part, index: hit.index, startY: y, startPitch: hit.pitch, pitch: hit.pitch };
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = 'ns-resize';
  }

  pointerMove(e) {
    const { x, y } = this.pos(e);
    if (!this.drag) {
      const hit = this.pick(x, y);
      this.canvas.style.cursor = hit && hit.part === this.active && this.editable ? 'ns-resize' : 'default';
      return;
    }
    const delta = Math.round((y - this.drag.startY) / Math.max(1, this.rowH));
    const pitch = Math.max(0, Math.min(127, this.drag.startPitch - delta));
    if (pitch !== this.drag.pitch) {
      this.drag.pitch = pitch;
      this.preview = { part: this.drag.part, index: this.drag.index, pitch };
      this.draw();
    }
  }

  pointerUp() {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    this.preview = null;
    this.canvas.style.cursor = 'default';
    if (d.pitch !== d.startPitch && this.onMove) this.onMove(d.part, d.index, d.pitch);
    else this.draw();
  }

  cancelDrag() {
    this.drag = null;
    this.preview = null;
    this.canvas.style.cursor = 'default';
    this.draw();
  }

  pitchOf(part, index, fallback) {
    if (this.preview && this.preview.part === part && this.preview.index === index) return this.preview.pitch;
    return fallback;
  }

  draw() {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    ctx.clearRect(0, 0, w, h);
    if (!w || !h) return;
    this.hit = [];

    const padTop = 10;
    const padBottom = 12;
    const { lo, hi } = this.bounds();
    const rows = hi - lo + 1;
    const rowH = (h - padTop - padBottom) / rows;
    this.rowH = rowH;
    const yOf = (pitch) => padTop + (hi - pitch) * rowH;

    ctx.fillStyle = '#0d1119';
    ctx.fillRect(0, 0, w, h);

    for (let p = lo; p <= hi; p++) {
      const isC = ((p % 12) + 12) % 12 === 0;
      ctx.fillStyle = isC ? 'rgba(255,255,255,0.045)' : p % 2 === 0 ? 'rgba(255,255,255,0.016)' : 'rgba(0,0,0,0)';
      ctx.fillRect(0, yOf(p), w, rowH);
      if (isC && rowH > 5) {
        ctx.fillStyle = 'rgba(141,150,171,0.5)';
        ctx.font = '9px ui-monospace, monospace';
        ctx.fillText(`o${octaveOf(p)}`, 4, yOf(p) - 2);
      }
    }

    const barTicks = 3840;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let t = 0; t <= this.duration; t += barTicks) {
      const x = (t / this.duration) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    if (!this.parts.length) {
      ctx.fillStyle = '#4a5468';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('MIDIを読み込むとここにピアノロールが表示されます', 14, h / 2);
      return;
    }

    let outside = 0;
    this.parts.forEach((notes, i) => {
      const dim = this.parts.length > 1 && i !== this.active;
      const color = PART_COLORS[i % PART_COLORS.length];
      notes.forEach((n, k) => {
        const pitch = this.pitchOf(i, k, n.pitch);
        const x = (n.start / this.duration) * w;
        const nw = Math.max(1.6, (n.dur / this.duration) * w);
        const y = yOf(pitch);
        const nh = Math.max(2.2, rowH - 1);
        const bad = pitch < LIMITS.midiMin || pitch > LIMITS.midiMax;
        if (bad) outside++;

        ctx.globalAlpha = dim ? 0.32 : 0.95;
        ctx.fillStyle = bad ? '#ff5c6c' : color;
        ctx.fillRect(x, y - nh / 2 + rowH / 2 - 0.5, nw, nh);

        if (bad) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = 'rgba(255,92,108,0.9)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y - nh / 2 + rowH / 2 - 0.5, Math.max(2, nw), nh);
        }
        ctx.globalAlpha = 1;

        if (i === this.active && !dim) {
          this.hit.push({ part: i, index: k, pitch, x, y: y - nh / 2 + rowH / 2 - 0.5, w: Math.max(3, nw), h: nh });
        }
      });
    });

    if (outside) {
      ctx.fillStyle = 'rgba(255,92,108,0.9)';
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText(`音域外 ${outside}音`, w - 74, 14);
    }

    if (this.playhead !== null) {
      const x = (this.playhead / this.duration) * w;
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
