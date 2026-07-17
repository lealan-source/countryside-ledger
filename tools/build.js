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
  const re0 = /(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(lbs?|oz)\b/g;
  while ((m = re0.exec(s))) last = { mult: +m[1], size: +m[2] * +m[3], unit: m[4] };
  const re1 = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(lbs?|oz|#)\b/g;
  if (!last) while ((m = re1.exec(s))) last = { mult: +m[1] * +m[2], size: +m[3], unit: m[4] };
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
const ctUnits = s => {
  const m2 = String(s).match(/(\d+)\s*\/\s*(\d+)\s*ct/i);
  if (m2) return +m2[1] * +m2[2];
  const m1 = String(s).match(/(\d+)\s*ct/i);
  return m1 ? +m1[1] : null;
};
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
      units: pk ? pk.mult : (ctUnits(name) || 0),
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
      units: pk ? pk.mult : (ctUnits(name) || (!q1IsPounds && q1 ? q1 : 0)),
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
      units: pk ? pk.mult : (ctUnits(pack) || 0),
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
      units: 1,  // Frontier prices are per each
      shelfDays: num(r[19]) || null, stock,
      upcs: [upcDigits(r[0])].filter(Boolean), brk: null,
    });
  }
}

/* ---------- Denver Wholesale (built from invoices, not a price list) ----------
   Each invoice's Items sheet carries the full item spec + case price.
   Dedupe by DWF ID#; the newest invoice date wins the price.
   Everything is prepacked — Denver Wholesale carries no bulk. */
{
  const dir = SHEETS + '/Denver Wholesale';
  if (fs.existsSync(dir)) {
    const byId = new Map();
    for (const f of fs.readdirSync(dir).filter(x => /\.xlsx?$/i.test(x))) {
      const wb = XLSX.readFile(path.join(dir, f));
      const inv = XLSX.utils.sheet_to_json(wb.Sheets['Invoice Summary'] || {}, { header: 1, raw: true, defval: '' });
      const dateRow = inv.find(r => String(r[0]).toLowerCase() === 'invoice date');
      const date = dateRow ? String(dateRow[1]) : '';
      const its = XLSX.utils.sheet_to_json(wb.Sheets['Items'] || {}, { header: 1, raw: true, defval: '' });
      for (const r of its.slice(1)) {
        const sku = String(r[0]).trim();
        if (!sku || !/\d/.test(sku)) continue;
        const name = clean(r[3]);
        const price = num(r[14]);
        if (!name || price == null) continue;
        const prev = byId.get(sku);
        if (prev && prev.date > date) continue;
        const pack = clean(r[4]);
        const pk = parsePack(pack) || parsePack(name);
        const lbs = pk ? pk.total : null;
        const temp = String(r[12]).trim().toUpperCase();
        const cat = temp === 'F' ? 'Frozen' : temp === 'R' ? 'Refrigerated' : 'Grocery';
        byId.set(sku, { date, offer: {
          v: 'dw', sku, name, brand: '', cat,
          pack, lbs, price,
          perLb: lbs ? +(price / lbs).toFixed(4) : null,
          bulk: false,
          units: pk ? pk.mult : (ctUnits(pack) || 0),
          shelfDays: null, stock: '',
          upcs: [upcDigits(r[1]), upcDigits(r[2])].filter(Boolean),
          brk: null,
          img: false,
        }});
      }
    }
    for (const { offer } of byId.values()) offers.push(offer);
  }
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s/&-])[a-z]/g, c => c.toUpperCase());
}

/* ---------- shelf life ----------
   Frontier provides vendor shelf-life data; for everything else we apply
   food-storage rules by product type (days; 9999 = doesn't expire).
   Rule-derived values are flagged est=1 and display as "Keeps ~N months". */
const NO_SHELF = /twist tie|bags? plastic|bags? paper|bags? poly|container|foam |gloves|apron|table cover|scoop|scale\b|labels?\b|sign\b|display\b|rack\b|cookbook|candle|soap|shampoo|lotion|deodorant|toothpaste|tooth powder|first aid|supplement|vitamin|\bpet\b|dog |cat |bird seed|wild animal|merchandis|packaging|boxes\b|\bcups?\b|\blids?\b|utensil|napkin|straw\b|toothpick|batting|filters?\b|essential oil|diffuser|castile|cleaner|detergent|canning (jar|lid|supplies)|jar\b|pectin box/i;
const SHELF_RULES = [
  // meats & refrigerated / frozen
  [/\bjerky\b|meat stick|snack stick/i, 365],
  [/frozen|\bfz\b|\biqf\b/i, 270],
  [/shredded cheese/i, 60],
  [/cheese|cheddar|colby|swiss|mozzarella|gouda|provolone|monterey|parmesan|feta/i, 120],
  [/yogurt.{0,20}(coated|covered|raisin|pretzel|chip|cluster|star|celebration|animal|bite|malt)|(coated|covered).{0,12}yogurt/i, 365],
  [/soup (starter|blend|mix)/i, 540],
  [/oatmeal|\boats\b/i, 365],
  [/nutritional yeast/i, 720],
  [/(?<!peanut |almond |cashew |apple |cookie |fruit |cocoa )butter\b(?! mints?| toffee| flavor| rum| brickle|scotch)|margarine|yogurt\b(?!.{0,14}(coated|covered|raisin|pretzel|chip|cluster))|kefir|sour cream|cream cheese|heavy cream|whipping cream|half & half|cottage/i, 90],
  [/bologna|deli |\bham\b|hot dog|wiener|sausage(?! seasoning| mix)|pepperoni|salami|bacon\b|bratwurst|kielbasa/i, 75],
  [/\beggs?\b(?! noodle| replacer| powder)/i, 35],
  [/pickle|sauerkraut|relish|olives/i, 365],
  // baking
  [/whole wheat flour|rye flour|spelt flour|buckwheat flour/i, 180],
  [/almond flour|coconut flour|flax.*meal|wheat germ|\bbran\b/i, 240],
  [/\bflour\b|cornmeal|corn meal|semolina|\bmasa\b|starch\b/i, 365],
  [/baking powder|baking soda|cream of tartar/i, 720],
  [/yeast\b|rennet/i, 540],
  [/powdered sugar|confectioner|brown sugar/i, 540],
  [/\bsugar\b|sweetener|stevia|erythritol|xylitol|saccharin/i, 9999],
  [/\bsalt\b/i, 9999],
  [/\bhoney\b/i, 9999],
  [/maple syrup|pancake syrup|corn syrup|molasses|sorghum|agave/i, 540],
  [/extract\b|flavoring|flavor oil|food color/i, 730],
  [/gelatin|pudding|jello|danish\b/i, 540],
  [/(cake|muffin|pancake|baking|brownie|bread|cookie|donut|doughnut|waffle|biscuit|roll|scone|cornbread) mix/i, 365],
  [/pie filling|fillings?\b/i, 730],
  [/frosting|icing/i, 365],
  [/shortening|lard\b/i, 730],
  [/\boil\b|olive oil|coconut oil|canola/i, 365],
  // grains & staples
  [/steel cut|oat groats/i, 365],
  [/\boats\b|oatmeal|granola(?! bar)/i, 365],
  [/granola bar|protein bar|energy bar/i, 240],
  [/\bcereal\b/i, 270],
  [/brown rice|wild rice/i, 180],
  [/\brice\b/i, 730],
  [/pasta|macaroni|spaghetti|noodle|penne|rotini|lasagna|shells\b|orzo|couscous/i, 730],
  [/(?<!coffee |chocolate |cocoa )\bbeans?\b(?! coffee)|lentil|split pea|chickpea|garbanzo|black.?eyed/i, 730],
  [/popcorn/i, 730],
  [/wheat kernel|wheat berr|barley|millet|quinoa|farro|rye berr|\bgrains?\b|tapioca/i, 540],
  // nuts, seeds, dried fruit
  [/walnut|pecan/i, 180],
  [/peanut butter|almond butter|nut butter|tahini/i, 270],
  [/peanut|almond|cashew|pistachio|macadamia|brazil nut|hazelnut|filbert|mixed nut|pine nut/i, 270],
  [/sunflower (kernel|meat|seed)|pumpkin seed|pepita|sesame seed|chia|flax ?seed|hemp/i, 270],
  [/raisin|craisin|\bdates?\b|prune/i, 540],
  [/dried|dehydrated|banana chip|\bfigs?\b|apricot/i, 365],
  [/coconut\b/i, 365],
  // candy & chocolate
  [/cocoa (mix|powder)|hot (cocoa|chocolate)|baking cocoa/i, 730],
  [/dark chocolate|semi.?sweet|bittersweet/i, 540],
  [/hard candy|lollipop|sucker|jawbreaker|rock candy|candy (disk|stick|cane)|butterscotch (disk|button|drop)|starlight|peppermint (candy|disk|puff)/i, 540],
  [/chocolate|carob|cocoa|fudge|buckeye/i, 365],
  [/marshmallow/i, 210],
  [/gumm(y|i)|jell(s\b|y bean)|sour \w|licorice|taffy|caramel|toffee|candy|lollipop|sucker|mints?\b|butterscotch|peppermint|spearmint leaves/i, 365],
  // snacks
  [/potato chip|corn chip|tortilla chip|cheese (curl|ball|puff)|puffs?\b|cracklin|pork rind/i, 90],
  [/pretzel|sesame stick|trail mix|snack mix|party mix/i, 180],
  [/cracker|wafer|cookie|shortbread/i, 240],
  // pantry wet
  [/\bjams?\b|\bjell(y|ies)\b|preserves|fruit butter|apple butter|marmalade/i, 540],
  [/salsa|sauce|ketchup|catsup|mustard|mayo|dressing|marinade|\bbbq\b/i, 365],
  [/canned|in syrup|in juice|#10 can|\bcan\b/i, 1095],
  [/vinegar/i, 9999],
  [/broth|bouillon|soup base|gravy/i, 540],
  [/(soup|dip|seasoning|dressing|chili) mix/i, 540],
  // beverages
  [/coffee/i, 365],
  [/\btea\b|chai/i, 720],
  [/drink mix|lemonade mix|cappuccino|cocoa mix|cider mix|dandy blend/i, 720],
  [/juice|cider(?! vinegar)/i, 365],
  [/soda\b|sparkling|spring water/i, 270],
  // dairy powders & spices (broad, last)
  [/dry milk|milk powder|egg powder|buttermilk powder|whey|egg replacer/i, 365],
  [/peppercorn|whole (clove|allspice|nutmeg)|cinnamon stick/i, 1095],
  [/spice|seasoning|powder\b|paprika|cumin|oregano|basil|thyme|parsley|chili powder|cinnamon|ginger|turmeric|\bherbs?\b|garlic|onion flake|\bleaf\b|\broot\b/i, 1095],
  // storage-temp fallbacks (Denver Wholesale cat = Frozen/Refrigerated)
  [/refrigerated/i, 75],
];
function estimateShelf(text) {
  if (NO_SHELF.test(text)) return null;
  for (const [re, days] of SHELF_RULES) if (re.test(text)) return days;
  return null;
}
let shelfFromVendor = 0, shelfFromRules = 0, shelfNone = 0;
for (const o of offers) {
  if (o.shelfDays) { o.shelfEst = 0; shelfFromVendor++; continue; }
  const est = estimateShelf(o.name + ' ' + o.cat);
  if (est) { o.shelfDays = est; o.shelfEst = 1; shelfFromRules++; }
  else { o.shelfEst = 0; shelfNone++; }
}
console.log(`shelf life — vendor: ${shelfFromVendor}, rules: ${shelfFromRules}, none: ${shelfNone}`);
// accuracy check: where Frontier gave vendor data AND a rule matches, compare
{
  const diffs = [];
  for (const o of offers) {
    if (o.v !== 'fr' || !o.shelfDays || o.shelfEst) continue;
    const est = estimateShelf(o.name + ' ' + o.cat);
    if (!est || est >= 9000 || o.shelfDays >= 9000) continue;
    diffs.push(Math.abs(est - o.shelfDays) / o.shelfDays);
  }
  if (diffs.length) {
    diffs.sort((a, b) => a - b);
    const within = diffs.filter(d => d <= 0.5).length;
    console.log(`rule-vs-vendor check on ${diffs.length} Frontier items: median delta ${(diffs[Math.floor(diffs.length / 2)] * 100).toFixed(0)}%, within ±50%: ${(within / diffs.length * 100).toFixed(0)}%`);
  }
}

/* ---------- image index: vendor:sku → file path ---------- */
const IMG_DIRS = { 'Dutch Valley': 'dv', 'Gateway': 'gw', 'Walnut Creek': 'wc', 'Frontier': 'fr', 'Denver Wholesale': 'dw' };
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

const V = ['dv', 'gw', 'wc', 'fr', 'dw'];
const items = offers.map(o => [
  V.indexOf(o.v), o.sku, o.name, o.brand, o.cat, o.pack,
  o.lbs, o.price, o.perLb, o.bulk ? 1 : 0, o.img ? 1 : 0, o.shelfDays,
  o.stock, o.upcs.join('|'), o.brk || 0, o.shelfEst || 0, o.units || 0,
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
