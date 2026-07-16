// Countryside Ledger photo bridge (PC only).
// Receives a photo from the app, asks Claude (via the Claude Code CLI,
// using the signed-in subscription) to identify the product, and returns
// { sku, terms } for the app's catalog search.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8474;
const CLAUDE = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
const ALLOWED_ORIGINS = [
  'https://lealan-source.github.io',
  'http://localhost:8123',
  'http://127.0.0.1:8123',
];
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic' };

function cors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function identify(imgPath) {
  return new Promise(resolve => {
    const prompt =
      `Look at the image file at ${imgPath} — a photo taken in a bulk-food store, ` +
      `either a shelf tag or a product package. Identify the product. ` +
      `Ignore ALL barcodes and barcode numbers (they are the store's own scale-label codes, never catalog numbers). ` +
      `Ignore per-bag net weight, price, and sell-by dates (they vary bag to bag). ` +
      `Reply with ONLY minified JSON, no other text: ` +
      `{"product":"<what it is>","details":"<brand/pack details if visible>",` +
      `"search_query":"<2 to 5 lowercase words, catalog-style, flavor and color words omitted>",` +
      `"core_query":"<1 or 2 lowercase words, the generic product noun>"}`;
    const p = spawn(CLAUDE, ['-p', prompt, '--model', 'haiku', '--allowedTools', 'Read'], {
      cwd: path.dirname(imgPath),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '', err = '';
    const timer = setTimeout(() => { try { p.kill(); } catch (e) {} }, 120000);
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', () => {
      clearTimeout(timer);
      if (/not logged in/i.test(out + err)) return resolve({ error: 'auth' });
      const m = out.match(/\{[\s\S]*\}/);
      if (!m) return resolve({ error: 'no-answer', raw: (out + err).slice(0, 400) });
      try {
        const j = JSON.parse(m[0]);
        resolve({
          product: typeof j.product === 'string' ? j.product : '',
          search_query: typeof j.search_query === 'string' ? j.search_query.toLowerCase() : null,
          core_query: typeof j.core_query === 'string' ? j.core_query.toLowerCase() : null,
        });
      } catch (e) { resolve({ error: 'bad-json', raw: m[0].slice(0, 400) }); }
    });
    p.on('error', () => { clearTimeout(timer); resolve({ error: 'spawn' }); });
  });
}

const server = http.createServer((req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'GET' && req.url === '/health') { send(res, 200, { ok: true }); return; }
  if (req.method === 'POST' && req.url === '/identify') {
    const chunks = [];
    let size = 0;
    req.on('data', d => {
      size += d.length;
      if (size > 20 * 1024 * 1024) { req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', async () => {
      const ext = EXT[(req.headers['content-type'] || '').split(';')[0]] || '.jpg';
      const tmp = path.join(os.tmpdir(), 'ledger-photo-' + Date.now() + ext);
      try {
        fs.writeFileSync(tmp, Buffer.concat(chunks));
        const result = await identify(tmp);
        send(res, result.error ? (result.error === 'auth' ? 503 : 502) : 200, result);
      } catch (e) {
        send(res, 500, { error: 'internal' });
      } finally {
        try { fs.unlinkSync(tmp); } catch (e) {}
      }
    });
    return;
  }
  send(res, 404, { error: 'not-found' });
});
server.on('error', e => {
  // already running (or port taken) — exit quietly so the launcher can always try
  process.exit(e.code === 'EADDRINUSE' ? 0 : 1);
});
server.listen(PORT, '127.0.0.1', () => console.log('photo bridge on http://127.0.0.1:' + PORT));
