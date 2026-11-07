// Strava's official MCP server (https://mcp.strava.com/mcp) as a plain HTTP client, for what the public REST API does not give:
// the exercises, weights and reps of strength workouts (tool get_strength_workout_details). Streamable HTTP transport:
// one POST per JSON-RPC call, the answer either as JSON or as a text/event-stream with the result in a "message" event.
import { accessToken } from './strava.js';

const MCP_URL = process.env.STRAVA_MCP_URL || 'https://mcp.strava.com/mcp';
const PROTO = '2025-06-18';
const err = (status, code, message) => Object.assign(new Error(message), { status, code });

function parseSse(text) {
  // the last JSON-RPC message in the stream
  let last = null;
  for (const block of text.split(/\n\n+/)) {
    const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
    if (!data) continue;
    try { last = JSON.parse(data); } catch (e) { /* keep going */ }
  }
  return last;
}
async function rpc(token, session, method, params, id) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + token, 'mcp-protocol-version': PROTO };
  if (session) headers['mcp-session-id'] = session;
  const body = { jsonrpc: '2.0', method, params: params || {} }; if (id != null) body.id = id;
  const r = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  const sid = r.headers.get('mcp-session-id') || session || null;
  if (r.status === 401) throw err(401, 'mcp_auth', 'Strava MCP did not accept the token');
  if (r.status === 429) throw err(429, 'rate_limited', 'Strava MCP is limiting requests');
  if (id == null) return { status: r.status, session: sid, json: null };          // a notification: no answer expected
  const ct = r.headers.get('content-type') || '';
  const text = await r.text();
  const json = ct.includes('text/event-stream') ? parseSse(text) : (text ? JSON.parse(text) : null);
  if (!r.ok) throw err(502, 'mcp', `Strava MCP answered ${r.status}: ${text.slice(0, 200)}`);
  if (json && json.error) throw err(502, 'mcp', 'Strava MCP: ' + (json.error.message || JSON.stringify(json.error)));
  return { status: r.status, session: sid, json };
}
// open a session: initialize + the initialized notification
export async function openSession(token) {
  token = token || (await accessToken());
  const init = await rpc(token, null, 'initialize', { protocolVersion: PROTO, capabilities: {}, clientInfo: { name: 'Baseline', version: '1' } }, 1);
  const session = init.session;
  try { await rpc(token, session, 'notifications/initialized', {}, null); } catch (e) { /* optional */ }
  return { token, session, server: init.json && init.json.result ? init.json.result.serverInfo : null, tools: null };
}
export async function listTools(s) {
  const r = await rpc(s.token, s.session, 'tools/list', {}, 2);
  return r.json && r.json.result ? r.json.result.tools || [] : [];
}
export async function callTool(s, name, args) {
  const r = await rpc(s.token, s.session, 'tools/call', { name, arguments: args || {} }, 3);
  const res = r.json && r.json.result;
  if (!res) return null;
  if (res.structuredContent) return res.structuredContent;
  const txt = (res.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  try { return JSON.parse(txt); } catch (e) { return { text: txt, isError: !!res.isError }; }
}
// the exercise sets of up to 10 activities, as the connector returns them: [{ activity_id, exercise_sets: [...] }]
export async function strengthDetails(s, ids) {
  const out = await callTool(s, 'get_strength_workout_details', { activity_ids: ids.map(String) });
  if (Array.isArray(out)) return out;
  if (out && Array.isArray(out.workouts)) return out.workouts;
  if (out && Array.isArray(out.result)) return out.result;
  return [];
}
// a quick check used by Settings: does the stored Strava token open the MCP, and is the strength tool there?
export async function probe() {
  const s = await openSession();
  const tools = await listTools(s);
  return { ok: true, server: s.server, session: !!s.session, tools: tools.map(t => t.name), strength: tools.some(t => t.name === 'get_strength_workout_details') };
}
