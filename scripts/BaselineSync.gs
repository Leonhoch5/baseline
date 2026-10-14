// Baseline Sync – receives the iPhone Shortcut's text and saves it to Google Drive › Baseline
// as baseline-YYYY-MM-DD.txt (overwrites the file for the same day).
// Accepts the text however the Shortcut sends it: raw body (Request Body = File),
// a Form field, or a JSON field. If nothing arrives, the reply says exactly what did arrive.

const FOLDER_NAME = 'Baseline';
const TZ = 'Europe/Berlin';
// Optional: put your secret here and add ?token=YOURSECRET to the URL in the Shortcut. Leave '' to skip the check.
const TOKEN = '';
const SKIP = ['token', 'key', 'secret'];   // never saved as health data

function doPost(e) {
  const p = (e && e.parameter) || {};
  if (TOKEN && p.token !== TOKEN && p.key !== TOKEN) return reply_('WRONG TOKEN – add ?token=… to the URL in the Shortcut. ' + describe_(e));
  const text = extractText_(e);
  if (!text) return reply_('EMPTY – nothing usable arrived. ' + describe_(e));
  const name = 'baseline-' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd') + '.txt';
  const folder = getFolder_();
  const old = folder.getFilesByName(name);
  if (old.hasNext()) old.next().setContent(text);
  else folder.createFile(name, text, MimeType.PLAIN_TEXT);
  return reply_('OK – saved ' + name + ' (' + text.length + ' characters, ' + text.split('\n').length + ' lines)');
}

// Open the /exec URL in Safari to check the deployment is live.
function doGet(e) {
  return reply_('Baseline Sync is running. Folder: ' + getFolder_().getName() + '. ' + describe_(e));
}

function extractText_(e) {
  if (!e) return '';
  const fields = Object.assign({}, e.parameter || {});
  const pd = e.postData;
  let raw = '';
  if (pd) {
    raw = pd.contents || '';
    if (!raw && typeof pd.getDataAsString === 'function') { try { raw = pd.getDataAsString(); } catch (err) {} }
    const type = String(pd.type || '');
    if (/multipart\/form-data/i.test(type)) { Object.assign(fields, parseMultipart_(raw, type)); raw = ''; }
    else if (/x-www-form-urlencoded/i.test(type)) raw = '';            // already in e.parameter
    else if (/^\s*\{/.test(raw)) { try { Object.assign(fields, JSON.parse(raw)); raw = ''; } catch (err) {} }
  }
  // 1. a named field
  for (const k of ['data', 'text', 'Text', 'body', 'file', 'content']) if (fields[k] && String(fields[k]).trim()) return String(fields[k]);
  // 2. a raw body (Request Body = File)
  if (raw && raw.trim()) return raw;
  // 3. any other field that isn't the token
  const vals = Object.keys(fields).filter(k => SKIP.indexOf(k.toLowerCase()) < 0).map(k => fields[k]).filter(v => typeof v === 'string' && v.trim());
  return vals.join('\n');
}

function parseMultipart_(raw, type) {
  const m = type.match(/boundary=(?:"([^"]+)"|([^;]+))/i); if (!m) return {};
  const out = {};
  raw.split('--' + (m[1] || m[2])).forEach(part => {
    const i = part.indexOf('\r\n\r\n'); if (i < 0) return;
    const head = part.slice(0, i), n = head.match(/name="([^"]*)"/i); if (!n) return;
    out[n[1]] = part.slice(i + 4).replace(/\r\n$/, '');
  });
  return out;
}

function describe_(e) {
  if (!e) return 'No request object.';
  const pd = e.postData;
  const p = e.parameter || {};
  return 'Fields: [' + Object.keys(p).map(k => k + ' (' + String(p[k] || '').length + ' chars)').join(', ') + '] · body type: ' + (pd ? pd.type : 'none') +
    ' · body length: ' + (pd && pd.contents ? pd.contents.length : 0);
}

function getFolder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function reply_(msg) {
  return ContentService.createTextOutput(msg).setMimeType(ContentService.MimeType.TEXT);
}

// Run this once from the editor (▶ testSave) to grant Drive access and check the folder.
function testSave() {
  const r = doPost({ parameter: {}, postData: { type: 'text/plain', contents: '#TEST\nhello from the editor' } });
  Logger.log(r.getContent());
}
