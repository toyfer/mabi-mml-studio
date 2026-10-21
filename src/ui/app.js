import { convertMidi, VERSION } from '../core/convert.js';
import { parseScore } from '../core/mml.js';
import { LIMITS, PART_NAMES } from '../core/spec.js';
import { MabiPlayer } from './player.js';
import { PianoRoll, PART_COLORS } from './pianoroll.js';
import { demoMidi } from './demo.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const STORAGE_KEY = 'mabimml.state.v1';

const state = {
  buffer: null,
  fileName: '',
  texts: [],
  bpm: 120,
  instrument: 'lute',
  result: null,
  active: 0,
  limit: LIMITS.charsPerPart,
  manual: false,
  trackMap: null,
  splitMap: {},
};

const player = new MabiPlayer();
let roll = null;

function toast(message, kind = 'info') {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  el.dataset.kind = kind;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function readOptions() {
  const o = {};
  for (const el of $$('[data-opt]')) {
    const key = el.dataset.opt;
    if (el.classList.contains('seg')) {
      const on = el.querySelector('button.on');
      if (on) o[key] = Number(on.dataset.v);
    } else if (el.type === 'checkbox') {
      o[key] = el.checked;
    } else if (el.type === 'number') {
      o[key] = el.value === '' ? null : Number(el.value);
    } else {
      o[key] = el.value;
    }
  }
  if (Object.keys(state.splitMap).length) o.splitMap = { ...state.splitMap };
  if (o.assignment === 'manual' && state.trackMap) o.trackMap = { ...state.trackMap };
  return o;
}

function setOption(key, value) {
  for (const el of $$(`[data-opt="${key}"]`)) {
    if (el.classList.contains('seg')) {
      $$('button', el).forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === Number(value)));
    } else if (el.type === 'checkbox') {
      el.checked = Boolean(value);
    } else {
      el.value = value ?? '';
    }
  }
}

/* ---------------- conversion ---------------- */

function convert() {
  if (!state.buffer) {
    if (state.texts.length) toast('共有・保存した楽譜のモードでは再変換できません');
    return;
  }
  const opts = readOptions();
  try {
    const result = convertMidi(state.buffer, opts);
    state.result = result;
    state.manual = false;
    state.texts = result.parts.map((p) => p.mml);
    state.bpm = result.bpm;
    state.instrument = opts.instrument;
    state.limit = opts.charLimit || LIMITS.charsPerPart;
    state.active = 0;
    render();
  } catch (err) {
    console.error(err);
    toast(err.message || '変換に失敗しました', 'error');
  }
}

function loadFile(buffer, name) {
  state.buffer = buffer;
  state.fileName = name;
  state.trackMap = null;
  state.splitMap = {};
  $('#hero').hidden = true;
  $('#studio').hidden = false;
  $('#fileName').textContent = name;
  convert();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------- rendering ---------------- */

function render() {
  const result = state.result;
  if (!result) return;

  const meta = [
    `${result.stats.tracks ?? '-'}トラック`,
    `${result.stats.inputNotes}音`,
    `${result.bpm} BPM`,
    `v${VERSION}`,
  ];
  $('#fileMeta').textContent = meta.join(' · ');

  if ($('#assignment').value === 'manual' && !state.trackMap && result.tracks && result.tracks.length) {
    state.trackMap = {};
    result.tracks.forEach((t) => {
      state.trackMap[String(t.index)] = t.part >= 0 ? t.part : -1;
    });
  }

  renderTabs();
  renderStats();
  renderWarnings();
  renderTrackMap(result.tracks || []);
  selectPart(state.active);
}

function renderTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = '';
  state.texts.forEach((text, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab' + (i === state.active ? ' on' : '');
    const over = text.length > state.limit;
    btn.innerHTML = `<span class="swatch" style="background:${PART_COLORS[i % PART_COLORS.length]}"></span>${
      PART_NAMES[i] || `パート${i + 1}`
    }<span class="badge${over ? ' over' : ''}">${text.length}</span>`;
    btn.addEventListener('click', () => selectPart(i));
    tabs.appendChild(btn);
  });
}

function selectPart(index) {
  state.active = index;
  $$('#tabs .tab').forEach((t, i) => t.classList.toggle('on', i === index));
  const text = state.texts[index] || '';
  $('#partLabel').textContent = PART_NAMES[index] || `パート${index + 1}`;
  $('#code').value = text;
  updateMeter(text);
  updateRoll();
}

function updateMeter(text) {
  const chars = text.length;
  const limit = state.limit || LIMITS.charsPerPart;
  const pct = Math.min(100, (chars / limit) * 100);
  const bar = $('#meterBar');
  bar.style.width = `${pct}%`;
  bar.className = chars > limit ? 'over' : chars > limit * 0.9 ? 'warn' : '';
  $('#charCount').textContent = `${chars} / ${limit}`;
  const tab = $$('#tabs .tab')[state.active];
  if (tab) {
    const badge = $('.badge', tab);
    if (badge) {
      badge.textContent = chars;
      badge.classList.toggle('over', chars > limit);
    }
  }
}

function parsedParts() {
  return state.texts.map((t) => parseScore(t)[0]);
}

function updateRoll() {
  roll.resize();
  const parsed = parsedParts();
  const duration = Math.max(1, ...parsed.map((p) => p.duration));
  roll.setData(
    parsed.map((p) => p.events),
    duration,
    state.active,
  );
}

function renderStats() {
  const r = state.result;
  const stats = r.stats;
  const items = [
    ['BPM', r.bpm],
    ['パート', `${state.texts.length}`],
    ['出力音符', `${stats.outputNotes}`],
    ['最大文字数', `${Math.max(...state.texts.map((t) => t.length), 0)}`],
    ['曲の長さ', formatTime(stats.durationSec)],
    ['クオンタイズ', `1/${r.resolution ?? Math.round(3840 / r.grid)}`],
  ];
  if (stats.dropped) items.push(['省略した音', `${stats.dropped}`]);
  if (stats.tempoChanges) items.push(['テンポ変更', `${stats.tempoChanges}`]);
  $('#stats').innerHTML = items
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join('');
}

function renderWarnings() {
  const list = $('#warnings');
  const warnings = (state.result && state.result.warnings) || [];
  if (!warnings.length) {
    list.innerHTML = '<div class="warn-item info">警告はありません。このままゲームに貼り付けられます。</div>';
    return;
  }
  list.innerHTML = warnings
    .map((w) => `<div class="warn-item ${w.level}">${escapeHtml(w.message)}</div>`)
    .join('');
}

function renderTrackMap(tracks) {
  const wrap = $('#trackMapWrap');
  const manual = $('#assignment').value === 'manual';
  const seg = $('.seg[data-opt="parts"]');
  if (seg) $$('button', seg).forEach((b) => { b.disabled = manual; });
  wrap.hidden = !(manual && tracks.length);
  if (wrap.hidden) return;

  const box = $('#trackMap');
  box.innerHTML = '';
  let lastSrc = null;

  tracks.forEach((t) => {
    const src = t.src === undefined ? t.index : t.src;
    const first = src !== lastSrc;
    lastSrc = src;

    const row = document.createElement('div');
    row.className = 'track-row';
    row.style.gridTemplateColumns = 'minmax(0, 1fr) 58px 84px';

    const info = document.createElement('div');
    info.className = 'track-name';
    info.innerHTML = `<b>${escapeHtml(t.name)}</b><span>${t.notes}音 · 平均${t.meanPitch} · 最大${t.polyphony}音</span>`;

    if (first) {
      const split = document.createElement('select');
      split.style.cssText = 'padding:4px 4px;font-size:11px;text-align:center;';
      split.title = 'このトラックを声部に分割';
      split.innerHTML = [1, 2, 3, 4].map((n) => `<option value="${n}">${n}声</option>`).join('');
      split.value = String(state.splitMap[String(src)] || 1);
      split.addEventListener('change', () => {
        const n = Number(split.value);
        if (n > 1) state.splitMap[String(src)] = n;
        else delete state.splitMap[String(src)];
        state.trackMap = null;
        convert();
      });
      row.append(info, split);
    } else {
      row.append(info, document.createElement('div'));
    }

    const sel = document.createElement('select');
    sel.innerHTML = ['<option value="">自動</option>', '<option value="-1">除外</option>']
      .concat(PART_NAMES.map((n, i) => `<option value="${i}">${n}</option>`))
      .join('');
    const current = state.trackMap ? state.trackMap[String(t.index)] : t.part;
    sel.value = current === null || current === undefined ? '' : String(current);
    sel.addEventListener('change', () => {
      if (!state.trackMap) {
        state.trackMap = {};
        tracks.forEach((x) => {
          state.trackMap[String(x.index)] = x.part >= 0 ? x.part : -1;
        });
      }
      if (sel.value === '') delete state.trackMap[String(t.index)];
      else state.trackMap[String(t.index)] = Number(sel.value);
      convert();
    });

    row.append(sel);
    box.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/* ---------------- text editing ---------------- */

$('#code').addEventListener('input', (e) => {
  state.texts[state.active] = e.target.value;
  updateMeter(e.target.value);
  updateRoll();
});

/* ---------------- transport ---------------- */

$('#play').addEventListener('click', () => {
  if (!state.texts.length) return;
  if (player.playing) {
    player.pause();
    $('#play').textContent = '▶ 試聴';
    return;
  }
  const at = player.playhead || 0;
  player.load(state.texts, { instrument: readOptions().instrument });
  player.play(at);
  $('#play').textContent = '❚❚ 一時停止';
});

$('#stop').addEventListener('click', () => {
  player.stop();
  $('#play').textContent = '▶ 試聴';
});

$('#volume').addEventListener('input', (e) => {
  player.setVolume(Number(e.target.value) / 100);
});

player.onTick = (tick) => {
  roll.setPlayhead(tick);
  if (!player.playing) $('#play').textContent = '▶ 試聴';
};

/* ---------------- clipboard & files ---------------- */

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label}をコピーしました`);
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast(`${label}をコピーしました`);
  }
}

function combined() {
  return `MML@${state.texts.join(',')};`;
}

$('#copyPart').addEventListener('click', () => {
  copyText(state.texts[state.active] || '', PART_NAMES[state.active] || 'パート');
});
$('#copyAll').addEventListener('click', () => copyText(combined(), 'MML@'));
$('#copyJson').addEventListener('click', () => {
  const payload = {
    version: VERSION,
    bpm: state.bpm,
    parts: state.texts.map((mml, i) => ({ name: PART_NAMES[i] || `part${i + 1}`, mml, chars: mml.length })),
    combined: combined(),
    stats: state.result ? state.result.stats : undefined,
  };
  copyText(JSON.stringify(payload, null, 2), 'JSON');
});

function download(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

$('#download').addEventListener('click', () => {
  const lines = [
    `; MabiMML Studio v${VERSION}`,
    `; ${state.fileName || 'score'} / BPM ${state.bpm}`,
    '; 各パートをゲーム内の楽譜編集画面で [ペースト] してください',
    '',
  ];
  state.texts.forEach((t, i) => {
    lines.push(`[${PART_NAMES[i] || `パート${i + 1}`}]`);
    lines.push(t);
    lines.push('');
  });
  lines.push('[MML@ まとめ]');
  lines.push(combined());
  const base = (state.fileName || 'score').replace(/\.(mid|midi)$/i, '');
  download(`${base}.mml.txt`, lines.join('\n'));
});

/* ---------------- share ---------------- */

const b64url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const unb64url = (str) => {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
};

async function encodeState(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if ('CompressionStream' in window) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    return `z${b64url(buf)}`;
  }
  return `j${b64url(bytes)}`;
}

async function decodeState(token) {
  const kind = token[0];
  const raw = unb64url(token.slice(1));
  let bytes = raw;
  if (kind === 'z') {
    if (!('DecompressionStream' in window)) throw new Error('このブラウザは共有リンクの展開に対応していません');
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

$('#share').addEventListener('click', async () => {
  const payload = { v: 1, bpm: state.bpm, instrument: state.instrument, name: state.fileName, parts: state.texts };
  try {
    const token = await encodeState(payload);
    const url = `${location.origin}${location.pathname}#s=${token}`;
    history.replaceState(null, '', `#s=${token}`);
    await copyText(url, '共有リンク');
  } catch (err) {
    toast('共有リンクを作れませんでした', 'error');
  }
});

async function applyShared(data) {
  state.texts = (data.parts || []).slice(0, LIMITS.parts);
  state.bpm = data.bpm || 120;
  state.instrument = data.instrument || 'lute';
  state.fileName = data.name || 'shared.mml';
  state.manual = true;
  state.trackMap = null;
  state.splitMap = {};
  state.limit = Number($('#charLimit').value) || LIMITS.charsPerPart;
  state.active = 0;
  setOption('bpm', state.bpm);
  setOption('instrument', state.instrument);
  $('#hero').hidden = true;
  $('#studio').hidden = false;
  $('#fileName').textContent = state.fileName;

  const parsed = parsedParts();
  const notes = parsed.flatMap((p) => p.events);
  const durationTick = Math.max(1, ...parsed.map((p) => p.duration));
  state.result = {
    bpm: state.bpm,
    grid: 20,
    resolution: 192,
    parts: state.texts.map((mml, i) => ({ name: PART_NAMES[i], mml, chars: mml.length, notes: parsed[i].events.length })),
    stats: {
      outputNotes: notes.length,
      inputNotes: notes.length,
      maxChars: Math.max(...state.texts.map((t) => t.length)),
      durationSec: (durationTick / 960) * (60 / state.bpm),
      tracks: null,
      dropped: 0,
      tempoChanges: 0,
    },
    warnings: [],
  };
  render();
}

/* ---------------- local storage ---------------- */

$('#saveLocal').addEventListener('click', () => {
  const payload = { v: 1, bpm: state.bpm, instrument: state.instrument, name: state.fileName, parts: state.texts };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    toast('ブラウザに保存しました');
  } catch (err) {
    toast('保存できませんでした（容量不足）', 'error');
  }
});

$('#loadLocal').addEventListener('click', () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    toast('保存されたデータがありません');
    return;
  }
  try {
    applyShared(JSON.parse(raw));
    toast('保存内容を復元しました');
  } catch (err) {
    toast('復元に失敗しました', 'error');
  }
});

/* ---------------- file input & drag/drop ---------------- */

async function handleFiles(files) {
  const file = files && files[0];
  if (!file) return;
  if (!/\.(mid|midi)$/i.test(file.name) && file.type !== 'audio/midi' && file.type !== 'audio/x-midi') {
    toast('MIDIファイル（.mid / .midi）を選んでください', 'error');
    return;
  }
  const buffer = await file.arrayBuffer();
  const head = new TextDecoder().decode(new Uint8Array(buffer.slice(0, 4)));
  if (head !== 'MThd') {
    toast('MIDIヘッダが見つかりません', 'error');
    return;
  }
  loadFile(buffer, file.name);
}

$('#pick').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#file').click();
});
$('#drop').addEventListener('click', (e) => {
  if (e.target.closest('button') || e.target.closest('input')) return;
  $('#file').click();
});
$('#file').addEventListener('change', (e) => handleFiles(e.target.files));
$('#sample').addEventListener('click', (e) => {
  e.stopPropagation();
  loadFile(demoMidi(), 'demo-amber-garden.mid');
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  $('#drop').classList.add('drag');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', (e) => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('#drop').classList.remove('drag');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop').classList.remove('drag');
  handleFiles(e.dataTransfer.files);
});

$('#reset').addEventListener('click', () => {
  player.stop();
  state.buffer = null;
  state.texts = [];
  $('#play').textContent = '▶ 試聴';
  $('#hero').hidden = false;
  $('#studio').hidden = true;
  $('#file').value = '';
});

/* ---------------- options ---------------- */

$$('[data-opt]').forEach((el) => {
  if (el.classList.contains('seg')) {
    $$('button', el).forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('button', el).forEach((b) => b.classList.toggle('on', b === btn));
        convert();
      });
    });
  } else if (el.type === 'checkbox') {
    el.addEventListener('change', convert);
  } else if (el.tagName === 'SELECT') {
    el.addEventListener('change', () => {
      if (el.dataset.opt === 'assignment' && el.value !== 'manual') state.trackMap = null;
      convert();
    });
  } else if (el.type === 'number') {
    el.addEventListener('change', convert);
  }
});

$('#bpmAuto').addEventListener('click', () => {
  $('#bpm').value = '';
  convert();
});

/* ---------------- keyboard & roll seek ---------------- */

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    $('#play').click();
  }
});

function bindRollSeek() {
  const canvas = $('#roll');
  canvas.addEventListener('click', (e) => {
    const parsed = parsedParts();
    const duration = Math.max(1, ...parsed.map((p) => p.duration));
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const tick = ratio * duration;
    player.seek(tick);
  });
}

/* ---------------- boot ---------------- */

roll = new PianoRoll($('#roll'));
bindRollSeek();
player.setVolume(0.8);

(async function boot() {
  const match = location.hash.match(/^#s=(.+)$/);
  if (match) {
    try {
      const data = await decodeState(match[1]);
      await applyShared(data);
      toast('共有された楽譜を読み込みました');
      return;
    } catch (err) {
      console.warn(err);
      toast('共有リンクを読み込めませんでした', 'error');
    }
  }
})();

window.MabiMML = { convertMidi, parseScore, version: VERSION };
