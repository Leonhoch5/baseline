// POST /api/login { password } → { token }   GET /api/login → { ready, problems: [names of missing settings] }
import { passwordOk, sessionToken, configProblems } from '../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const problems = configProblems();
  if (req.method === 'GET') return res.status(200).json({ ready: problems.length === 0, problems });
  if (req.method !== 'POST') return res.status(405).json({ error: { code: 'method', message: 'use POST' } });
  if (problems.length) return res.status(503).json({ error: { code: 'not_configured', message: 'Missing settings in Vercel: ' + problems.join(', ') } });
  let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const pw = b && typeof b.password === 'string' ? b.password : '';
  if (!passwordOk(pw)) {
    await new Promise(r => setTimeout(r, 700)); // slows down guessing
    return res.status(401).json({ error: { code: 'wrong_password', message: 'Wrong password' } });
  }
  return res.status(200).json({ token: sessionToken() });
}
