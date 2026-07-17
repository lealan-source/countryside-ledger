// Download Denver Wholesale product images listed on the invoices.
// Saves as "Product Images/Denver Wholesale/<id> - <name>.<ext>" so the
// existing image indexer picks them up by item code.
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const https = require('https');

const DIR = 'C:/Users/StoreLIVE/Documents/Country Ledger/Price Sheets/Denver Wholesale';
const OUT = 'C:/Users/StoreLIVE/Documents/Country Ledger/Product Images/Denver Wholesale';
fs.mkdirSync(OUT, { recursive: true });

const items = new Map(); // id → {url, name}
for (const f of fs.readdirSync(DIR).filter(x => /\.xlsx?$/i.test(x))) {
  const wb = XLSX.readFile(path.join(DIR, f));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Items'] || {}, { header: 1, raw: true, defval: '' });
  for (const r of rows.slice(1)) {
    const id = String(r[0]).trim();
    const url = String(r[8]).trim();
    if (id && /^https:\/\/denverfoods\.net\//.test(url) && !items.has(id)) {
      items.set(id, { url, name: String(r[3]).replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) });
    }
  }
}
console.log('unique items with image URLs:', items.size);

function fetchOne(url, redirects) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Accept': 'image/*,*/*' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (redirects || 0) < 3) {
        res.resume();
        return resolve(fetchOne(new URL(res.headers.location, url).href, (redirects || 0) + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const type = (res.headers['content-type'] || '').toLowerCase();
      const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : type.includes('gif') ? '.gif' : '.jpg';
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ buf: Buffer.concat(chunks), ext, type }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

(async () => {
  let ok = 0, skipped = 0, failed = 0;
  const entries = [...items.entries()];
  const POOL = 1;
  let idx = 0;
  async function worker() {
    while (idx < entries.length) {
      const [id, { url, name }] = entries[idx++];
      const existing = fs.readdirSync(OUT).find(f => f.startsWith(id + ' -'));
      if (existing) { skipped++; continue; }
      try {
        const { buf, ext, type } = await fetchOne(url);
        if (!type.startsWith('image/') || buf.length < 500) { failed++; continue; }
        fs.writeFileSync(path.join(OUT, `${id} - ${name}${ext}`), buf);
        ok++;
      } catch (e) {
        failed++;
      }
      await new Promise(r => setTimeout(r, 1500)); // be polite to their server
    }
  }
  await Promise.all(Array.from({ length: POOL }, worker));
  console.log(`downloaded: ${ok}, already had: ${skipped}, failed: ${failed}`);
})();
