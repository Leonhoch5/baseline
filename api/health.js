import { configProblems } from '../lib/auth.js';
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const problems = configProblems();
  if (!process.env.INGEST_TOKEN || process.env.INGEST_TOKEN.length < 16) problems.push('INGEST_TOKEN (at least 16 characters; needed by the iPhone Shortcut)');
  if (!process.env.HACKCLUB_AI_KEY) problems.push('HACKCLUB_AI_KEY (needed for plan import and the coach’s note)');
  res.status(200).json({ ok: true, time: new Date().toISOString(), ready: problems.length === 0, problems });
}
