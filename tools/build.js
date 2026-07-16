// Countryside Ledger importer: 4 vendor price sheets + image library
//   → data/catalog.json (app payload) + thumb-jobs.json (for thumbs.js)
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const PROJ = 'C:/Users/StoreLIVE/Documents/Country Ledger';
const SHEETS = PROJ + '/Price Sheets';
const IMAGES = PROJ + '/Product Images';

/* ---------- pack parsing: total pounds from a description/pack string ---------- */
function parseLbs(s) {
  if (!s) return null;
  s = String(s).toLowerCase().replace(/½/g, '.5').replace(/¼/g, '.25').replace(/¾/g, '.75');
  let m, last = null;
  // N-M/X unit  (e.g. "4-4/2.12oz")
  const re1 = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(lbs?|oz|#)\b/g;
  while ((m = re1.exec(s))) last = { mult: +m[1] * +m[2], size: +m[3], unit: m[4] };
  if (!last) {
    // N/X unit  (e.g. "4/28oz", "1/50 lb", "10/100")
    const re2 = /(\d+(?:\.\d+)?)\s*[\/x]\s*(\d+(?:\.\d+)?)\s*(lbs?|oz|#)/g;
    while ((m = re2.exec(s))) last = { mult: +m[1], size: +m[2], unit: m[3] };
  }
  if (!last) {
    // X unit  (e.g. "25lb", "25 lbs.", "40#", "428oz")
    const re3 = /(\d+(?:\.\d+)?)\s*(lbs?|oz|#)(?![a-z])/g;
    while ((m = re3.exec(s))) last = { mult: 1, size: +m[1], unit: m[2] };
  }
  if (!last) return null;
  const total = last.mult * last.size;
  const lbs = /oz/.test(last.unit) ? total / 16 : total;
  return lbs > 0 && lbs < 3000 ? +lbs.toFixed(3) : null;
}
function packLabel(s) {
  if (!s) return '';
  const m = String(s).match(/(\d[\d.\s]*(?:-\s*\d+)?\s*\/\s*[\d.]+\s*(?:lbs?|oz|ct|#)|[\d.]+\s*(?:lbs?|oz|ct|#))\.?\s*$/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}
const clean = s => String(s).replace(/\s+/g, ' ').trim();
const num = x => { const n = typeof x === 'number' ? x : parseFloat(String(x).replace(/[$,]/g, '')); return isFinite(n) ? n : null; };

const offers = []; // {v, sku, name, brand, cat, pack, lbs, price, perLb, bulk, shelfDays}

/* ---------- Dutch Valley ---------- */
{
  const rows = XLSX.utils.sheet_to_json(
    XLSX.readFile(SHEETS + '/Dutch Valley.xls').Sheets['Item Price List Price Book'],
    { header: 1, raw: true, defval: '' });
  let cat = '';
  for (const r of rows) {
    if (!r[0] && clean(r[1]) && !r[2]) { cat = titleCase(clean(r[1])); continue; }
    const sku = clean(r[0]).replace(/\s+/g, '');
    if (!/^\d/.test(sku)) continue;
    const name = clean(r[1]);
    const price = num(r[2]);
    if (!name || price == null) continue;
    const unit2 = clean(r[5]).toUpperCase();
    const lbs = unit2 === 'LB'
      ? (parseLbs(name) || (num(r[4]) ? +(price / num(r[4])).toFixed(2) : null))
      : parseLbs(name);
    const perLb = unit2 === 'LB' ? num(r[4]) : (lbs ? +(price / lbs).toFixed(4) : null);
    offers.push({
      v: 'dv', sku, name, brand: '', cat,
      pack: unit2 === 'LB' ? (packLabel(name) || 'bulk') : (packLabel(name) || clean(r[3])),
      lbs, price, perLb,
      bulk: unit2 === 'LB' || (lbs != null && lbs >= 10),
      shelfDays: null,
    });
  }
}

/* ---------- Gateway ---------- */
{
  const rows = XLSX.utils.sheet_to_json(
    XLSX.readFile(SHEETS + '/Gateway.xlsx').Sheets['Products'],
    { header: 1, raw: true, defval: '' });
  let cat = '';
  for (const r of rows) {
    const c0 = r[0];
    if (c0 === '' || c0 == null) continue; // qty-break continuation rows: skip
    if (typeof c0 === 'string' && !/^\d+$/.test(c0.trim())) {
      if (clean(c0) && !clean(r[2])) cat = clean(c0);
      continue;
    }
    const sku = String(c0).trim();
    const name = clean(r[2]);
    const price = num(r[4]);
    if (!name || price == null) continue;
    const explicitPerLb = num(r[6]);
    // GW "LB/Qty" column is pounds for bulk foods, unit-count for supplies.
    // Trust it as pounds only when the description gives no size of its own
    // and the value is a plausible bag weight.
    const q1 = num(r[1]);
    const lbs = parseLbs(name)
      || (explicitPerLb ? q1 : null)
      || (q1 && q1 >= 1 && q1 <= 100 && !/\b(ct|count|each|pk|pack)\b/i.test(name) && !/\d\s*(ct|pk)\.?/i.test(name) ? q1 : null);
    const perLb = explicitPerLb || (lbs ? +(price / lbs).toFixed(4) : null);
    offers.push({
      v: 'gw', sku, name, brand: '', cat,
      pack: packLabel(name) || (lbs ? lbs + ' lb' : ''),
      lbs, price, perLb,
      bulk: lbs != null && lbs >= 10,
      shelfDays: null,
    });
  }
}

/* ---------- Walnut Creek ---------- */
{
  const rows = XLSX.utils.sheet_to_json(
    XLSX.readFile(SHEETS + '/Walnut Creek.xlsx').Sheets['Sheet1'],
    { header: 1, raw: true, defval: '' });
  for (const r of rows.slice(1)) {
    const sku = String(r[3]).trim();
    if (!/^\d/.test(sku)) continue;
    const name = clean(r[4]);
    const listPrice = num(r[6]);
    const caseTotal = num(r[9]);
    if (!name || listPrice == null) continue;
    const pack = clean(r[5]);
    const lbs = parseLbs(pack) || parseLbs(name);
    const isWeight = /lb|#|oz/i.test(pack);
    offers.push({
      v: 'wc', sku, name, brand: clean(r[2]), cat: clean(r[0]) + (r[1] ? ' · ' + clean(r[1]) : ''),
      pack,
      lbs,
      price: caseTotal || (lbs ? +(listPrice * lbs).toFixed(2) : listPrice),
      perLb: isWeight && lbs ? listPrice : (lbs ? +((caseTotal || listPrice) / lbs).toFixed(4) : null),
      bulk: /bulk/i.test(String(r[0])) || (lbs != null && lbs >= 10),
      shelfDays: null,
    });
  }
}

/* ---------- Frontier ---------- */
{
  const rows = XLSX.utils.sheet_to_json(
    XLSX.readFile(SHEETS + '/Frontier.xlsx').Sheets['Annual_Catalog'],
    { header: 1, raw: true, defval: '' });
  for (const r of rows.slice(3)) {
    const sku = String(r[1]).trim();
    if (!/^\d+$/.test(sku)) continue;
    const name = clean(r[4]) || clean(r[2]);
    const each = num(r[8]);
    if (!name || each == null) continue;
    const w = num(r[6]);
    const uom = clean(r[7]).toUpperCase();
    let lbs = null;
    if (w && uom === 'LB') lbs = w;
    else if (w && uom === 'OZ') lbs = +(w / 16).toFixed(3);
    else lbs = parseLbs(name);
    const shelfDays = num(r[19]) || null;
    offers.push({
      v: 'fr', sku, name, brand: clean(r[10]), cat: '',
      pack: w && uom ? w + ' ' + uom.toLowerCase().replace('fo', 'fl oz') : (packLabel(name) || 'each'),
      lbs, price: each, perLb: lbs ? +(each / lbs).toFixed(4) : null,
      bulk: lbs != null && lbs >= 5,
      shelfDays,
    });
  }
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s/&-])[a-z]/g, c => c.toUpperCase());
}

/* ---------- image index: vendor:sku → file path ---------- */
const IMG_DIRS = { 'Dutch Valley': 'dv', 'Gateway': 'gw', 'Walnut Creek': 'wc', 'Frontier': 'fr' };
const imgIndex = new Map();
let imgTotal = 0, imgDupes = 0;
function walk(dir, v) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, v); continue; }
    if (!/\.(jpe?g|png|webp|gif)$/i.test(e.name)) continue;
    imgTotal++;
    const m = e.name.match(/^#?\s*(\d+)\s*-/);
    if (!m) continue;
    const key = v + ':' + m[1];
    if (imgIndex.has(key)) { imgDupes++; continue; }
    imgIndex.set(key, p);
  }
}
for (const [folder, v] of Object.entries(IMG_DIRS)) {
  const dir = path.join(IMAGES, folder);
  if (fs.existsSync(dir)) walk(dir, v);
}

/* ---------- match & emit ---------- */
const jobs = [];
let matched = 0;
for (const o of offers) {
  const src = imgIndex.get(o.v + ':' + o.sku);
  o.img = !!src;
  if (src) { matched++; jobs.push({ src, out: `images/${o.v}/${o.sku}.webp` }); }
}

const V = ['dv', 'gw', 'wc', 'fr'];
const items = offers.map(o => [
  V.indexOf(o.v), o.sku, o.name, o.brand, o.cat, o.pack,
  o.lbs, o.price, o.perLb, o.bulk ? 1 : 0, o.img ? 1 : 0, o.shelfDays,
]);
fs.mkdirSync(PROJ + '/data', { recursive: true });
fs.writeFileSync(PROJ + '/data/catalog.json', JSON.stringify({ v: V, generated: '2026-07-16', items }));
fs.writeFileSync(__dirname + '/thumb-jobs.json', JSON.stringify(jobs));

/* ---------- report ---------- */
const by = v => offers.filter(o => o.v === v);
console.log('vendor  offers  withPerLb  withImage');
for (const v of V) {
  const a = by(v);
  console.log(`${v.padEnd(7)} ${String(a.length).padEnd(7)} ${String(a.filter(o => o.perLb).length).padEnd(10)} ${a.filter(o => o.img).length}`);
}
console.log(`\ntotal offers: ${offers.length}, image files: ${imgTotal} (dupe skus: ${imgDupes})`);
console.log(`offers with image: ${matched} · images matching no offer: ${imgIndex.size - new Set(jobs.map(j => j.src)).size + (imgIndex.size - matched)}`);
console.log('catalog.json: ' + (fs.statSync(PROJ + '/data/catalog.json').size / 1024 / 1024).toFixed(2) + ' MB');
const samples = offers.filter(o => /rolled oats|sunflower/i.test(o.name)).slice(0, 8);
console.log('\nsamples:'); samples.forEach(s => console.log(JSON.stringify(s)));
