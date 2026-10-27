// AI for Baseline, served by Hack Club AI (https://docs.ai.hackclub.com, OpenAI-compatible).
// The API key lives only here (env HACKCLUB_AI_KEY); the browser never sees it.
//
// POST /api/ai  (signed-in user only: Authorization: Bearer <Supabase access token>)
//   body: { input: string | [{role, content}], images?: [dataURL…], json?: boolean, model?, maxTokens?, temperature? }
//   → { text, json?, model, usage }     errors: { error: { code, message, retryAfter? } }
//
// Env: HACKCLUB_AI_KEY (required), SUPABASE_URL, SUPABASE_ANON_KEY, and USER_EMAIL or BASELINE_USER_ID (who may call it).
// Optional: HACKCLUB_AI_MODEL (default anthropic/claude-haiku-5.5), HACKCLUB_AI_FALLBACKS (comma list), AI_BASE_URL,
//           INGEST_TOKEN (lets the iPhone Shortcut call it with ?token=…).
import crypto from 'node:crypto';

const BASE = (process.env.AI_BASE_URL || 'https://ai.hackclub.com/proxy/v1').replace(/\/$/, '');
const DEFAULT_MODEL = process.env.HACKCLUB_AI_MODEL || 'anthropic/claude-haiku-5.5';
const FALLBACKS = (process.env.HACKCLUB_AI_FALLBACKS || 'openai/gpt-6-luna,google/gemini-2.5-flash').split(',').map(s => s.trim()).filter(Boolean);
const MAX_BODY = 4 * 1024 * 1024, MAX_IMAGES = 4, MAX_TOKENS = 8000;

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

function tokenOk(given) {
  const want = process.env.INGEST_TOKEN || '';
  if (want.length < 16 || !given) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// the signed-in Baseline user, checked against Supabase with the token the browser sends
async function callerOk(req) {
  const h = String(req.headers.authorization || '');
  const jwt = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!jwt) return false;
  const r = await fetch(process.env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + jwt } });
  if (!r.ok) return false;
  const u = await r.json().catch(() => null); if (!u || !u.id) return false;
  if (process.env.BASELINE_USER_ID) return u.id === process.env.BASELINE_USER_ID;
  if (process.env.USER_EMAIL) return String(u.email || '').toLowerCase() === String(process.env.USER_EMAIL).toLowerCase();
  return true;   // no allow-list configured: any signed-in user of this deployment (there is only one)
}

// OpenAI-style messages from the app's input (a prompt string or a short chat), with images on the last user turn
export function buildMessages(input, images) {
  let msgs = typeof input === 'string' ? [{ role: 'user', content: input }] : (Array.isArray(input) ? input : []).map(m => ({ role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user', content: String(m.content || '') }));
  if (!msgs.length) throw Object.assign(new Error('input is empty'), { status: 400, code: 'bad_request' });
  const imgs = (images || []).filter(u => typeof u === 'string' && /^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(u)).slice(0, MAX_IMAGES);
  if (imgs.length) {
    const last = msgs[msgs.length - 1];
    if (last.role !== 'user') msgs.push({ role: 'user', content: '' });
    const u = msgs[msgs.length - 1];
    u.content = [{ type: 'text', text: u.content || 'See the attached images.' }].concat(imgs.map(url => ({ type: 'image_url', image_url: { url } })));
  }
  return msgs;
}
// first JSON object/array in a reply, with code fences stripped
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch (e) { /* fall through */ }
  const a = t.search(/[{[]/); if (a < 0) return null;
  for (let b = t.length; b > a; b--) { const ch = t[b - 1]; if (ch !== '}' && ch !== ']') continue; try { return JSON.parse(t.slice(a, b)); } catch (e) { /* keep shrinking */ } }
  return null;
}

async function complete(model, messages, opts) {
  const body = { model, messages, stream: false, temperature: opts.temperature ?? 0.2, max_tokens: Math.min(MAX_TOKENS, opts.maxTokens || 4000) };
  if (opts.json) body.response_format = { type: 'json_object' };
  const call = b => fetch(BASE + '/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.HACKCLUB_AI_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(55000) });
  let r = await call(body);
  // some models don't accept response_format: retry once without it and parse the JSON ourselves
  if (!r.ok && r.status === 400 && opts.json) { const t = await r.text(); if (/response_format|json_object/i.test(t)) r = await call({ ...body, response_format: undefined }); else return { status: 400, text: t }; }
  if (!r.ok) return { status: r.status, text: await r.text(), retryAfter: r.headers.get('retry-after') };
  const j = await r.json();
  const text = j.choices && j.choices[0] && j.choices[0].message ? (typeof j.choices[0].message.content === 'string' ? j.choices[0].message.content : (j.choices[0].message.content || []).map(p => p.text || '').join('')) : '';
  return { status: 200, text, usage: j.usage || null, model: j.model || model, finish: j.choices && j.choices[0] && j.choices[0].finish_reason };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const send = (status, obj) => res.status(status).json(obj);
  const fail = (status, code, message, extra) => send(status, { error: { code, message, ...(extra || {}) } });
  if (req.method !== 'POST') return fail(405, 'method', 'use POST');
  if (!process.env.HACKCLUB_AI_KEY) return fail(503, 'ai_key', 'HACKCLUB_AI_KEY is not set on the server');
  try {
    const url = new URL(req.url, 'http://x');
    const allowed = tokenOk(url.searchParams.get('token') || req.headers['x-baseline-token']) || await callerOk(req);
    if (!allowed) return fail(401, 'ai_auth', 'sign in first');
    let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { return fail(400, 'bad_request', 'body is not JSON'); } }
    if (!b || typeof b !== 'object') return fail(400, 'bad_request', 'missing body');
    if (JSON.stringify(b).length > MAX_BODY) return fail(413, 'prompt_too_large', 'request too large');
    const messages = buildMessages(b.input, b.images);
    const opts = { json: !!b.json, maxTokens: +b.maxTokens || undefined, temperature: b.temperature };
    const models = [String(b.model || DEFAULT_MODEL)].concat(FALLBACKS.filter(m => m !== b.model && m !== DEFAULT_MODEL));
    let last = null;
    for (const model of models) {
      const r = await complete(model, messages, opts).catch(e => ({ status: 0, text: String(e && e.message || e) }));
      if (r.status === 200) {
        const out = { text: r.text, model: r.model, usage: r.usage, finish: r.finish };
        if (opts.json) out.json = extractJson(r.text);
        return send(200, out);
      }
      last = { model, ...r };
      // these are account-level problems: no point trying another model
      if (r.status === 401 || r.status === 403) return fail(503, 'ai_key', 'Hack Club AI rejected the API key (' + r.status + ')');
      if (r.status === 402) return fail(503, 'ai_budget', 'Hack Club AI daily spending limit reached');
      if (r.status === 429) return fail(429, 'rate_limited', 'rate limited', { retryAfter: +r.retryAfter || 30 });
      if (r.status === 413) return fail(413, 'prompt_too_large', 'request too large for the model');
      // otherwise (model down, bad model id, upstream error): try the next model
    }
    console.error('ai failed', last && last.model, last && last.status, last && String(last.text).slice(0, 300));
    return fail(502, 'unavailable', 'AI request failed (' + (last ? last.status : 'no model') + ')');
  } catch (e) {
    console.error(e);
    return fail(e.status || 500, e.code || 'error', e.message || 'failed');
  }
}
