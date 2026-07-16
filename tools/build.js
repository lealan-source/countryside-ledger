// Countryside Ledger importer: 4 vendor price sheets + image library
//   → data/catalog.json (app payload) + thumb-jobs.json (for thumbs.js)
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const PROJ = 'C:/Users/StoreLIVE/Documents/Country Ledger';
const SHEETS = PROJ + '/Price Sheets';
const IMAGES = PROJ + '/Product Images';

/* ---------- pack parsing ----------
   parsePack(s) → {total, unit, mult} in pounds (or null)
   mult = units per case, unit = pounds per unit               */
function parsePack(s) {
  if (!s) return null;
  s = String(s).toLowerCase().replace(/½/g, '.5').replace(/¼/g, '.25').replace(/¾/g, '.75');
  let m, last = null;
  const re1 = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(lbs?|oz|#)\b/g;
  while ((m = re1.exec(s))) last = { mult: +m[1] * +m[2], size: +m[3], unit: m[4] };
  if (!last) {
    const re2 = /(\d+(?:\.\d+)?)\s*[\/x]\s*(\d+(?:\.\d+)?)\s*(lbs?|oz|#)/g;
    while ((m = re2.exec(s))) last = { mult: +m[1], size: +m[2], unit: m[3] };
  }
  if (!last) {
    const re3 = /(\d+(?:\.\d+)?)\s*(lbs?|oz|#)(?![a-z])/g;
    while ((m = re3.exec(s))) last = { mult: 1, size: +m[1], unit: m[2] };
  }
  if (!last) return null;
  const unitLbs = /oz/.test(last.unit) ? last.size / 16 : last.size;
  const total = last.mult * unitLbs;
  if (!(total > 0 && total < 3000)) return null;
  return { total: +total.toFixed(3), unit: +unitLbs.toFixed(3), mult: last.mult };
}
const parseLbs = s => { const p = parsePack(s); return p ? p.total : null; };
function packLabel(s) {
  if (!s) return '';
  const m = String(s).match(/(\d[\d.\s]*(?:-\s*\d+)?\s*\/\s*[\d.]+\s*(?:lbs?|oz|ct|#)|[\d.]+\s*(?:lbs?|oz|ct|#))\.?\s*$/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}
const clean = s => String(s).replace(/\s+/g, ' ').trim();
const num = x => { const n = typeof x === 'number' ? x : parseFloat(String(x).replace(/[$,]/g, '')); return isFinite(n) ? n : null; };
const upcDigits = x => { const d = String(x || '').replace(/\D/g, '').replace(/^0+/, ''); return d.length >= 6 ? d : null; };

// Pack-class rule (per the store's real usage):
//   bulk = priced/sold by the pound, a single bag ≥1 lb, blocks ≥5 lb even in
//   multipacks, high-count supplies, or a category that says Bulk.
//   Retail multipacks of small units (12/2 lb, 4/16 oz) are prepacked.
function isBulk({ pack, cat, byThePound, count }) {
  // retail multipacks of small units (12/2 lb, 4/16 oz) are prepacked,
  // even when the vendor prices them per pound or files them under Bulk
  if (pack && pack.mult > 1 && pack.unit < 5) return false;
  if (byThePound) return true;
  if (/bulk/i.test(cat || '')) return true;
  if (pack) {
    if (pack.unit >= 5) return true;
    if (pack.mult === 1 && pack.unit >= 1) return true;
    return false;
  }
  if (count != null && count >= 500) return true;
  return false;
}

const offers = [];

/* ---------- Dutch Valley ---------- */
{
  const rows = XLSX.utils.sheet_to_json(
    XLSX.readFile(SHEETS + '/Dutch Valley.xls').Sheets['Item Price List Price Book'],
    { header: 1, raw: true, defval: '' });
  let cat = '';
  for (const r of rows) {
    if (!r[0] && clean(r[1]) && !r[2]) { cat = titleCase(clean(r[1])); continue; }
    const sku = clean(r[0]).replace(/\s+/g, '');
    if (!/\d/.test(sku)) continue;
    const name = clean(r[1]);
    const price = num(r[2]);
    if (!name || price == null) continue;
    const unit2 = clean(r[5]).toUpperCase();
    const pk = parsePack(name);
    const byThePound = unit2 === 'LB';
    const lbs = byThePound
      ? ((pk && pk.total) || (num(r[4]) ? +(price / num(r[4])).toFixed(2) : null))
      : (pk ? pk.total : null);
    const perLb = byThePound ? num(r[4]) : (lbs ? +(price / lbs).toFixed(4) : null);
    const brkQty = num(r[9]), brkPrice = num(r[10]);
    offers.push({
      v: 'dv', sku, name, brand: '', cat,
      pack: byThePound ? (packLabel(name) || 'bulk') : (packLabel(name) || clean(r[3])),
      lbs, price, perLb,
      bulk: isBulk({ pack: pk, cat, byThePound }),
      shelfDays: null, stock: '',
      upcs: [upcDigits(r[11]), upcDigits(r[12])].filter(Boolean),
      brk: brkQty && brkPrice ? [brkQty, brkPrice] : null,
    });
  }
}

/* ---------- Gateway ---------- */
{
  const rows = XLSX.utils.sheet_to_json(
    XLSX.readFile(SHEETS + '/Gateway.xlsx').Sheets['Products'],
    { header: 1, raw: true, defval: '' });
  let cat = '';
  let lastOffer = null;
  for (const r of rows) {
    const c0 = r[0];
    if (c0 === '' || c0 == null) {
      // qty-break continuation row: "25 cases → $x" attaches to the item above
      const bq = num(r[3]), bp = num(r[4]);
      if (lastOffer && bq && bp && bq > 1) lastOffer.brk = [bq, bp];
      continue;
    }
    if (typeof c0 === 'string' && !/^\d+$/.test(c0.trim())) {
      if (clean(c0) && !clean(r[2])) cat = clean(c0);
      continue;
    }
    const sku = String(c0).trim();
    const name = clean(r[2]);
    const price = num(r[4]); // pack total
    if (!name || price == null) continue;
    const explicitPerLb = num(r[6]);
    const q1 = num(r[1]); // pounds for bulk foods, unit-count for supplies
    const pk = parsePack(name);
    const q1IsPounds = !pk && q1 != null && q1 >= 1 && q1 <= 100
      && !/\b(ct|count|each|pk|pack)\b/i.test(name) && !/\d\s*(ct|pk)\.?/i.test(name);
    const lbs = (pk ? pk.total : null) || (explicitPerLb ? q1 : null) || (q1IsPounds ? q1 : null);
    const perLb = explicitPerLb || (lbs ? +(price / lbs).toFixed(4) : null);
    lastOffer = {
      v: 'gw', sku, name, brand: '', cat,
      pack: packLabel(name) || (lbs ? lbs + ' lb' : ''),
      lbs, price, perLb,
      bulk: isBulk({ pack: pk || (q1IsPounds ? { total: q1, unit: q1, mult: 1 } : null), cat, byThePound: false, count: !pk && !q1IsPounds ? q1 : null }),
      shelfDays: null, stock: '', upcs: [], brk: null,
    };
    offers.push(lastOffer);
  }
}

/* ---------- Walnut Creek ---------- */
{
  const rows = XLSX.utils.sheet_to_json(
    XLSX.readFile(SHEETS + '/Walnut Creek.xlsx').Sheets['Sheet1'],
    { header: 1, raw: true, defval: '' });
  let lbMismatch = 0;
  for (const r of rows.slice(1)) {
    const sku = String(r[3]).trim();
    if (!/\d/.test(sku)) continue;
    const name = clean(r[4]);
    const listPrice = num(r[6]);
    const caseTotal = num(r[9]);
    if (!name || listPrice == null) continue;
    const pack = clean(r[5]);
    const pk = parsePack(pack) || parsePack(name);
    const lbs = pk ? pk.total : null;
    // List price is per-lb on lb packs, per-EACH on oz/ct packs.
    // Case total ÷ pounds is correct in every case, so prefer it.
    const price = caseTotal || (lbs && /lb|#/i.test(pack) ? +(listPrice * lbs).toFixed(2) : listPrice);
    const perLb = lbs && price ? +(price / lbs).toFixed(4) : null;
    if (lbs && /lb|#/i.test(pack) && caseTotal && Math.abs(listPrice - caseTotal / lbs) > 0.03) lbMismatch++;
    const cat = clean(r[0]) + (r[1] ? ' · ' + clean(r[1]) : '');
    offers.push({
      v: 'wc', sku, name, brand: clean(r[2]), cat,
      pack, lbs, price, perLb,
      bulk: isBulk({ pack: pk, cat, byThePound: false }),
      shelfDays: null, stock: '', upcs: [], brk: null,
    });
  }
  if (lbMismatch) console.log('WC lb-pack sanity mismatches (listPrice vs caseTotal/lbs):', lbMismatch);
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
    let unitLbs = null;
    if (w && uom === 'LB') unitLbs = w;
    else if (w && uom === 'OZ') unitLbs = +(w / 16).toFixed(3);
    const pk = unitLbs ? { total: unitLbs, unit: unitLbs, mult: 1 } : parsePack(name);
    const lbs = pk ? pk.total : null;
    const status = clean(r[11]).toUpperCase();
    const stock = /UNAVAIL|^DISC|CALLTOORDE/.test(status) ? 'out' : /CLOSEOUT/.test(status) ? 'closeout' : '';
    offers.push({
      v: 'fr', sku, name, brand: clean(r[10]), cat: '',
      pack: w && uom ? w + ' ' + uom.toLowerCase().replace('fo', 'fl oz') : (packLabel(name) || 'each'),
      lbs, price: each, perLb: lbs ? +(each / lbs).toFixed(4) : null,
      bulk: isBulk({ pack: pk, cat: '', byThePound: false }),
      shelfDays: num(r[19]) || null, stock,
      upcs: [upcDigits(r[0])].filter(Boolean), brk: null,
    });
  }
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s/&-])[a-z]/g, c => c.toUpperCase());
}

/* ---------- image index: vendor:sku → file path ---------- */
const IMG_DIRS = { 'Dutch Valley': 'dv', 'Gateway': 'gw', 'Walnut Creek': 'wc', 'Frontier': 'fr' };
const imgIndex = new Map();
let imgTotal = 0;
function walk(dir, v) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, v); continue; }
    if (!/\.(jpe?g|png|webp|gif)$/i.test(e.name)) continue;
    imgTotal++;
    const m = e.name.match(/^#?\s*(\d+)\s*-/);
    if (!m) continue;
    const key = v + ':' + m[1];
    if (!imgIndex.has(key)) imgIndex.set(key, p);
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
  o.stock, o.upcs.join('|'), o.brk || 0,
]);
fs.mkdirSync(PROJ + '/data', { recursive: true });
fs.writeFileSync(PROJ + '/data/catalog.json', JSON.stringify({ v: V, generated: '2026-07-16', items }));
fs.writeFileSync(__dirname + '/thumb-jobs.json', JSON.stringify(jobs));

/* ---------- report ---------- */
const by = v => offers.filter(o => o.v === v);
console.log('vendor  offers  withPerLb  bulk   withImage  upcs   breaks');
for (const v of V) {
  const a = by(v);
  console.log(
    `${v.padEnd(7)} ${String(a.length).padEnd(7)} ${String(a.filter(o => o.perLb).length).padEnd(10)} ` +
    `${String(a.filter(o => o.bulk).length).padEnd(6)} ${String(a.filter(o => o.img).length).padEnd(10)} ` +
    `${String(a.filter(o => o.upcs.length).length).padEnd(6)} ${a.filter(o => o.brk).length}`);
}
console.log(`\ntotal offers: ${offers.length} · image files: ${imgTotal} · offers with image: ${matched}`);
console.log('catalog.json: ' + (fs.statSync(PROJ + '/data/catalog.json').size / 1024 / 1024).toFixed(2) + ' MB');
