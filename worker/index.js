import { convertMidi, VERSION, DEFAULT_OPTIONS } from '../src/core/convert.js';
import { LIMITS, INSTRUMENTS, TPQN, WHOLE } from '../src/core/spec.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  });

const base64ToBytes = (b64) => {
  const bin = atob(b64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

async function readPayload(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    const body = await request.json();
    if (!body.midi) throw new Error('midi（base64）が必要です');
    return { bytes: base64ToBytes(body.midi), options: body.options || {} };
  }
  if (type.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('midi') || form.get('file');
    if (!file || typeof file === 'string') throw new Error('midiファイルが必要です');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let options = {};
    const raw = form.get('options');
    if (typeof raw === 'string' && raw.trim()) options = JSON.parse(raw);
    for (const [key, value] of form.entries()) {
      if (key === 'midi' || key === 'file' || key === 'options' || typeof value !== 'string') continue;
      if (value === 'true') options[key] = true;
      else if (value === 'false') options[key] = false;
      else if (value !== '' && !Number.isNaN(Number(value))) options[key] = Number(value);
      else options[key] = value;
    }
    return { bytes, options };
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) throw new Error('リクエストボディが空です');
  return { bytes, options: {} };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/' || url.pathname === '/v1') {
      return json({
        name: 'MabiMML Studio API',
        version: VERSION,
        endpoints: {
          'GET /v1/spec': 'マビノギモバイルMMLの制限値',
          'POST /v1/convert': 'MIDI → MML（JSON base64 / multipart / octet-stream）',
        },
        docs: 'https://github.com/toyfer/mabi-mml-studio',
      });
    }

    if (url.pathname === '/v1/spec' && request.method === 'GET') {
      return json({
        ok: true,
        version: VERSION,
        limits: LIMITS,
        resolution: { tpqn: TPQN, wholeNote: WHOLE },
        instruments: INSTRUMENTS.map(({ id, name, voices, safe }) => ({ id, name, voices, safe })),
        options: DEFAULT_OPTIONS,
      });
    }

    if (url.pathname === '/v1/convert') {
      if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
      try {
        const { bytes, options } = await readPayload(request);
        const result = convertMidi(bytes, options);
        return json(result);
      } catch (err) {
        return json({ ok: false, error: err.message || 'conversion_failed' }, 400);
      }
    }

    return json({ ok: false, error: 'not_found' }, 404);
  },
};
