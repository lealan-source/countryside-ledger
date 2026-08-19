// Countryside Ledger importer: 4 vendor price sheets + image library
//   → data/catalog.json (app payload) + thumb-jobs.json (for thumbs.js)
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const PROJ = path.resolve(__dirname, '..').replace(/\\/g, '/');
const SHEETS = PROJ + '/Price Sheets';
const IMAGES = PROJ + '/Product Images';
const FORCE = process.argv.includes('--force');

/* ---------- which vendor is this file? ----------
   Filenames are whatever the vendor happened to call the attachment, so the
   vendor is identified by what's INSIDE the workbook — tab names first, and
   for Walnut Creek (whose tab is just "Sheet1") the header row. */
const VENDOR_NAME = { dv: 'Dutch Valley', gw: 'Gateway', wc: 'Walnut Creek', fr: 'Frontier', dw: 'Denver Wholesale' };
function detectVendor(wb) {
  const tabs = wb.SheetNames;
  if (tabs.includes('Item Price List Price Book')) return 'dv';
  if (tabs.includes('Annual_Catalog')) return 'fr';
  if (tabs.includes('Invoice Summary') && tabs.includes('Items')) return 'dw';
  for (const t of tabs) {
    const row0 = (XLSX.utils.sheet_to_json(wb.Sheets[t], { header: 1, defval: '' })[0] || [])
      .map(x => String(x).toLowerCase().trim());
    // 'main category' is required as well: those three columns alone are generic
    // enough that a POS item export would be claimed as a Walnut Creek price
    // sheet and silently rewrite 5,265 items with the wrong prices.
    if (row0.includes('item number') && row0.includes('product name')
        && row0.includes('pack size') && row0.includes('main category')) return 'wc';
  }
  if (tabs.includes('Products')) return 'gw';
  return null;
}
const ymd = d => new Date(d).toISOString().slice(0, 10);

/* Walk Price Sheets/ (and one level of subfolders) and sort every workbook to
   its vendor. Denver Wholesale collects many invoices; the rest take one file,
   newest wins if the folder somehow holds two. */
function discoverSheets() {
  const found = { dw: [] };
  const skipped = [];
  const stack = [SHEETS];
  while (stack.length) {
    const dir = stack.pop();
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { stack.push(p); continue; }
      if (!/\.xlsx?$/i.test(e.name) || /^~\$/.test(e.name)) continue;
      let wb, v;
      try { wb = XLSX.readFile(p); v = detectVendor(wb); }
      catch (err) { skipped.push(e.name + ' (unreadable: ' + err.message + ')'); continue; }
      if (!v) { skipped.push(e.name + ' (not a recognized vendor sheet)'); continue; }
      const rec = { file: e.name, path: p, date: ymd(fs.statSync(p).mtime), wb };
      if (v === 'dw') found.dw.push(rec);
      else if (!found[v] || rec.date > found[v].date) found[v] = rec;
    }
  }
  return { found, skipped };
}

const { found: SRC, skipped: SKIPPED } = discoverSheets();
console.log('— price sheets found —');
for (const v of ['dv', 'gw', 'wc', 'fr']) {
  console.log(`  ${VENDOR_NAME[v].padEnd(16)} ${SRC[v] ? SRC[v].file + '  (' + SRC[v].date + ')' : '** MISSING **'}`);
}
console.log(`  ${VENDOR_NAME.dw.padEnd(16)} ${SRC.dw.length ? SRC.dw.length + ' invoice file(s)' : '** MISSING **'}`);
for (const s of SKIPPED) console.log('  ignored: ' + s);
console.log('');

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
// name → distinctive words, for the "is anyone cheaper?" lookup
const NAME_STOP = new Set(['of', 'the', 'and', 'with', 'in', 'for', 'to', 'no']);
const tokenizeName = name => [...new Set(String(name).toLowerCase()
  .replace(/\d+(\.\d+)?\s*[\/x-]?\s*\d*(\.\d+)?\s*(lbs?|oz|ct|#|gal|fl)\b\.?/g, ' ')
  .replace(/[^a-z\s]/g, ' ').split(/\s+/)
  .filter(t => t.length > 2 && !NAME_STOP.has(t)))];
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
/* Confirmed purchases pulled off invoices — "where we got it last".
   Only Denver sends invoice workbooks today; when another vendor's arrive,
   parse them into this same shape and everything downstream just works. */
const purchases = [];

/* ---------- Dutch Valley ---------- */
if (SRC.dv) {
  const rows = XLSX.utils.sheet_to_json(
    SRC.dv.wb.Sheets['Item Price List Price Book'],
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
if (SRC.gw) {
  const rows = XLSX.utils.sheet_to_json(
    SRC.gw.wb.Sheets['Products'],
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
if (SRC.wc) {
  const rows = XLSX.utils.sheet_to_json(
    SRC.wc.wb.Sheets[SRC.wc.wb.SheetNames[0]],
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
if (SRC.fr) {
  const rows = XLSX.utils.sheet_to_json(
    SRC.fr.wb.Sheets['Annual_Catalog'],
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
let dwNewestInvoice = '';
{
  if (SRC.dw.length) {
    const byId = new Map();
    for (const rec of SRC.dw) {
      const wb = rec.wb;
      const inv = XLSX.utils.sheet_to_json(wb.Sheets['Invoice Summary'] || {}, { header: 1, raw: true, defval: '' });
      const dateRow = inv.find(r => String(r[0]).toLowerCase() === 'invoice date');
      const date = dateRow ? String(dateRow[1]) : '';
      if (date > dwNewestInvoice) dwNewestInvoice = date;
      const its = XLSX.utils.sheet_to_json(wb.Sheets['Items'] || {}, { header: 1, raw: true, defval: '' });
      for (const r of its.slice(1)) {
        const sku = String(r[0]).trim();
        if (!sku || !/\d/.test(sku)) continue;
        const name = clean(r[3]);
        const price = num(r[14]);
        if (!name || price == null) continue;
        // what we ACTUALLY bought, not just what it cost — the invoice knows the
        // date and the quantity, and until now we threw both away
        const qty = num(r[15]);
        if (date) purchases.push({ v: 'dw', sku, name, date, price, qty: qty || null });
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

// Thumbnails already generated. The full-size source library is ~3 GB and is
// not in git, so a machine without it must still keep the pictures it has —
// otherwise a rebuild here would strip every image from the published app.
const thumbHave = new Set();
for (const v of Object.values(IMG_DIRS)) {
  const d = path.join(PROJ, 'images', v);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (/\.webp$/i.test(f)) thumbHave.add(v + ':' + f.replace(/\.webp$/i, ''));
  }
}

/* ---------- match & emit ---------- */
const jobs = [];
let matched = 0;
for (const o of offers) {
  const k = o.v + ':' + o.sku;
  const src = imgIndex.get(k);
  o.img = !!src || thumbHave.has(k);
  if (o.img) matched++;
  if (src) jobs.push({ src, out: `images/${o.v}/${o.sku}.webp` });
}

const V = ['dv', 'gw', 'wc', 'fr', 'dw'];

/* ---------- how fresh is each vendor? ----------
   Per-vendor, because the five sheets never arrive the same week. Denver
   Wholesale dates from its newest invoice, not the file — its prices are only
   as current as the last time we actually ordered the item. The headline
   `generated` is the freshest sheet, NOT today: rebuilding old sheets must not
   make the app claim today's prices. */
const dates = {};
for (const v of ['dv', 'gw', 'wc', 'fr']) if (SRC[v]) dates[v] = SRC[v].date;
if (SRC.dw.length) {
  const d = new Date(dwNewestInvoice);
  dates.dw = isFinite(d) && dwNewestInvoice ? ymd(d) : ymd(Math.max(...SRC.dw.map(r => +new Date(r.date))));
}
const generated = Object.values(dates).sort().pop() || ymd(Date.now());

/* ---------- price history & sales ----------
   No vendor marks sales on their sheet, so a sale is worked out by comparing
   today's price against what this item has actually cost us before. That means
   history IS the sale detector, and it can only look forward — the first build
   just lays the baseline down.

   Deliberately NOT seeded from git: the stored catalogs are all the same July
   prices and differ only by code changes (the per-piece pricing rewrite, for
   one), so replaying them would invent enormous fake sales on day one.

   Stored as a date table plus [dateIndex, price] pairs, and only when a price
   actually moves — a stable item keeps one entry forever. */
fs.mkdirSync(PROJ + '/data', { recursive: true });
const HIST_PATH = PROJ + '/data/history.json';
const SALE_DROP = 0.10;   // 10% under the usual price reads as a sale
const BASELINE_N = 5;     // "usual price" = median of the last 5 recorded prices

let hist = { d: [], h: {} };
try {
  const raw = JSON.parse(fs.readFileSync(HIST_PATH, 'utf8'));
  if (Array.isArray(raw.d) && raw.h) hist = raw;
} catch (e) { /* first run — start the record here */ }

const dateIdx = iso => {
  let i = hist.d.indexOf(iso);
  if (i < 0) { hist.d.push(iso); i = hist.d.length - 1; }
  return i;
};
const median = a => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/* Backfill real price-over-time from the invoice dates we already parse. An
   invoice from February states what that item cost in February — that is VENDOR
   pricing, the same class of data as the catalog, so it belongs in the public
   price history. The quantities on the same rows are ours and stay out of it.
   Without this the history would hold a single point per item and any trend
   chart would be one dot. */
{
  const byKey = new Map();
  for (const p of purchases) {
    if (!(p.price > 0) || !p.date) continue;
    const k = p.v + ':' + p.sku;
    if (!byKey.has(k)) byKey.set(k, new Map());
    byKey.get(k).set(p.date, p.price);   // one price per item per invoice date
  }
  let added = 0;
  for (const [k, obs] of byKey) {
    const have = new Set((hist.h[k] || []).map(e => hist.d[e[0]]));
    const fresh = [...obs].filter(([d]) => !have.has(d)).sort((a, b) => a[0] < b[0] ? -1 : 1);
    if (!fresh.length) continue;
    const entries = hist.h[k] || (hist.h[k] = []);
    for (const [d, price] of fresh) { entries.push([dateIdx(d), price]); added++; }
    // keep the record in date order, and drop points that repeat the price
    entries.sort((a, b) => hist.d[a[0]] < hist.d[b[0]] ? -1 : hist.d[a[0]] > hist.d[b[0]] ? 1 : 0);
    hist.h[k] = entries.filter((e, i) => i === 0 || Math.abs(e[1] - entries[i - 1][1]) > 0.0001);
  }
  if (added) console.log(`price history: backfilled ${added} point(s) from invoice dates`);
}

const changes = [];
let seeded = 0, onSale = 0;
for (const o of offers) {
  if (!(o.price > 0)) continue;
  const k = o.v + ':' + o.sku;
  const obsDate = dates[o.v] || generated;
  const entries = hist.h[k] || (hist.h[k] = []);
  const prior = entries.slice(-BASELINE_N).map(e => e[1]);
  const last = entries.length ? entries[entries.length - 1][1] : null;

  if (prior.length) {
    const usual = median(prior);
    if (usual > 0 && o.price <= usual * (1 - SALE_DROP)) {
      o.sale = 1;
      o.was = +usual.toFixed(2);
      onSale++;
    }
  } else seeded++;

  if (last === null || Math.abs(last - o.price) > 0.0001) {
    entries.push([dateIdx(obsDate), o.price]);
    if (last !== null) {
      changes.push({ v: o.v, sku: o.sku, name: o.name, from: last, to: o.price,
        pct: (o.price - last) / last });
    }
  }
}
fs.writeFileSync(HIST_PATH, JSON.stringify(hist));

/* ---------- what we actually bought, and when ----------
   Same date-table shape as the price history. Written even when only one vendor
   sends invoices, so the app can answer "where did we get this last?" for the
   items it does know about and say nothing for the rest. */
{
  const dts = [];
  const dIdx = iso => { let i = dts.indexOf(iso); if (i < 0) { dts.push(iso); i = dts.length - 1; } return i; };
  const byKey = {};
  for (const p of purchases) {
    const k = p.v + ':' + p.sku;
    (byKey[k] || (byKey[k] = [])).push([dIdx(p.date), p.price, p.qty || 0]);
  }
  for (const k of Object.keys(byKey)) {
    byKey[k].sort((a, b) => (dts[a[0]] < dts[b[0]] ? -1 : dts[a[0]] > dts[b[0]] ? 1 : 0));
  }
  /* ---------- what needs attention ----------
     Only about what we actually BUY — the catalog has 20,745 items and almost
     none of them are our problem. Computed here rather than on the phone
     because finding a cheaper vendor means a name search per item per vendor,
     which is a second of work on a laptop and far too slow in the aisle.
     Lives in this file, not the catalog, because the list of things we buy is
     itself the private part. */
  const attention = { switch: [], jump: [], gone: [] };
  const bySku = new Map(offers.map(o => [o.v + ':' + o.sku, o]));
  try {
    const LedgerSearch = require(PROJ + '/search.js');
    const searchItems = offers.map(o => ({
      v: o.v, sku: o.sku, name: o.name, brand: o.brand, cat: o.cat, pack: o.pack,
      lbs: o.lbs, price: o.price, perLb: o.perLb, bulk: o.bulk, u: (o.upcs || []).join('|'),
    }));
    LedgerSearch.build(searchItems);
    const STOP2 = new Set(['of', 'the', 'and', 'with', 'for']);
    const bought = [...new Set(purchases.map(p => p.v + ':' + p.sku))];

    for (const k of bought) {
      const mine = bySku.get(k);
      if (!mine) {
        const last = purchases.filter(p => p.v + ':' + p.sku === k).sort((a, b) => a.date < b.date ? 1 : -1)[0];
        if (last) attention.gone.push({ k, name: last.name, why: 'no longer on the price list' });
        continue;
      }
      if (mine.stock === 'out' || mine.stock === 'closeout') {
        attention.gone.push({ k, name: mine.name, why: mine.stock === 'out' ? 'out of stock' : 'closeout' });
      }
      // is anyone cheaper for the same thing?
      if (!mine.perLb) continue;
      const toks = tokenizeName(mine.name).filter(t => !STOP2.has(t)).slice(0, 4);
      if (!toks.length) continue;
      const hits = LedgerSearch.query(toks.join(' ')).hits;
      let best = null;
      for (const h of hits) {
        if (h.it.v === mine.v || !h.it.perLb || h.conf < 80) continue;
        if (!!h.it.bulk !== !!mine.bulk) continue;          // compare like with like
        if (!best || h.it.perLb < best.it.perLb) best = h;
      }
      if (best && best.it.perLb < mine.perLb * 0.9) {
        attention.switch.push({
          k, name: mine.name, from: mine.v, fromLb: mine.perLb,
          to: best.it.v, toName: best.it.name, toLb: best.it.perLb,
          toSku: best.it.sku, save: +((1 - best.it.perLb / mine.perLb) * 100).toFixed(0),
          conf: best.conf,
        });
      }
    }
    attention.switch.sort((a, b) => b.save - a.save);
  } catch (e) { console.log('  (skipped switch check: ' + e.message + ')'); }

  // price rises on things we buy, from the history recorded above
  for (const k of new Set(purchases.map(p => p.v + ':' + p.sku))) {
    const e = hist.h[k];
    if (!e || e.length < 2) continue;
    const from = e[e.length - 2][1], to = e[e.length - 1][1];
    if (from > 0 && (to - from) / from > 0.15) {
      const o = bySku.get(k);
      attention.jump.push({ k, name: o ? o.name : k, from, to, pct: +(((to - from) / from) * 100).toFixed(0) });
    }
  }
  attention.jump.sort((a, b) => b.pct - a.pct);

  fs.writeFileSync(PROJ + '/data/purchases.json',
    JSON.stringify({ d: dts, p: byKey, attention }));
  console.log(`needs attention: ${attention.switch.length} cheaper elsewhere, ` +
    `${attention.jump.length} price rise(s), ${attention.gone.length} gone or going`);
  const vendors = [...new Set(purchases.map(p => p.v))];
  console.log(`purchase records: ${purchases.length} line item${purchases.length === 1 ? '' : 's'} across ` +
    `${Object.keys(byKey).length} product${Object.keys(byKey).length === 1 ? '' : 's'} ` +
    `from ${vendors.map(v => VENDOR_NAME[v]).join(', ') || 'no vendors'}` +
    (vendors.length < V.length ? `  (no invoices yet from ${V.filter(v => !vendors.includes(v)).map(v => VENDOR_NAME[v]).join(', ')})` : ''));
}

/* ---------- what actually changed this week ---------- */
if (seeded) console.log(`price history: ${seeded} item${seeded === 1 ? '' : 's'} recorded for the first time (no sales can show until they move)`);
if (changes.length) {
  changes.sort((a, b) => a.pct - b.pct);
  console.log(`\n— price changes (${changes.length}) —`);
  for (const v of V) {
    const mine = changes.filter(c => c.v === v);
    if (!mine.length) continue;
    const up = mine.filter(c => c.pct > 0).length;
    console.log(`  ${VENDOR_NAME[v]} — ${mine.length} change${mine.length === 1 ? '' : 's'} (${up} up, ${mine.length - up} down)`);
    for (const c of mine.slice(0, 6)) {
      console.log(`    ${(c.pct > 0 ? '+' : '') + (c.pct * 100).toFixed(0)}%`.padEnd(9) +
        `$${c.from.toFixed(2)} → $${c.to.toFixed(2)}  ${c.name.slice(0, 46)}`);
    }
    if (mine.length > 6) console.log(`    …and ${mine.length - 6} more`);
  }
}
if (onSale) console.log(`\n${onSale} item${onSale === 1 ? '' : 's'} are ${SALE_DROP * 100}%+ under their usual price — flagged as ON SALE`);

/* a readable record that travels with the repo */
{
  const lines = [`# Price changes — ${generated}`, ''];
  if (!changes.length) lines.push('No price changes this build.', '');
  for (const v of V) {
    const mine = changes.filter(c => c.v === v);
    if (!mine.length) continue;
    lines.push(`## ${VENDOR_NAME[v]} — ${mine.length}`, '');
    lines.push('| Change | Was | Now | Item |', '| --- | --- | --- | --- |');
    for (const c of mine) {
      lines.push(`| ${(c.pct > 0 ? '+' : '') + (c.pct * 100).toFixed(0)}% | $${c.from.toFixed(2)} | $${c.to.toFixed(2)} | ${c.name.replace(/\|/g, '/')} |`);
    }
    lines.push('');
  }
  const sales = offers.filter(o => o.sale);
  if (sales.length) {
    lines.push(`## On sale now — ${sales.length}`, '');
    lines.push('| Vendor | Usual | Now | Item |', '| --- | --- | --- | --- |');
    for (const s of sales.sort((a, b) => a.price / a.was - b.price / b.was)) {
      lines.push(`| ${VENDOR_NAME[s.v]} | $${s.was.toFixed(2)} | $${s.price.toFixed(2)} | ${s.name.replace(/\|/g, '/')} |`);
    }
  }
  fs.writeFileSync(PROJ + '/Price Changes.md', lines.join('\n') + '\n');
}

/* ---------- guard: don't ship a broken import ----------
   A vendor who renames a tab or moves a column, or a download that stopped
   halfway, doesn't crash this importer — it just quietly yields fewer items or
   wrong prices, and the store orders on them. Compare against the catalog we're
   about to overwrite and refuse the obviously-wrong ones. --force overrides. */
const CAT_PATH = PROJ + '/data/catalog.json';
let prev = null;
try {
  const p = JSON.parse(fs.readFileSync(CAT_PATH, 'utf8'));
  prev = { dates: p.dates || {}, byKey: new Map(), counts: {} };
  for (const a of p.items) {
    const v = p.v[a[0]];
    prev.byKey.set(v + ':' + a[1], { name: a[2], price: a[7] });
    prev.counts[v] = (prev.counts[v] || 0) + 1;
  }
} catch (e) { /* first build, or no catalog yet — nothing to compare */ }

const blockers = [], warnings = [];
if (prev) {
  const now = {};
  for (const v of V) now[v] = offers.filter(o => o.v === v).length;
  for (const v of V) {
    const was = prev.counts[v] || 0, is = now[v];
    if (!was) continue;
    if (!is) blockers.push(`${VENDOR_NAME[v]} has NO items this build (had ${was}). Its sheet is missing or unreadable.`);
    else if (is < was * 0.9) blockers.push(`${VENDOR_NAME[v]} dropped to ${is} items from ${was} (−${Math.round((1 - is / was) * 100)}%). Likely a partial download or a changed layout.`);
  }
  const wasTotal = Object.values(prev.counts).reduce((a, b) => a + b, 0);
  if (offers.length < wasTotal * 0.9) blockers.push(`Catalog dropped to ${offers.length} items from ${wasTotal} overall.`);

  for (const v of V) {
    if (prev.dates[v] && dates[v] && prev.dates[v] === dates[v]) {
      warnings.push(`${VENDOR_NAME[v]} is unchanged since the last build (${dates[v]}) — did that sheet get updated?`);
    }
  }

  const moved = [];
  let gone = 0, added = 0;
  const seen = new Set();
  for (const o of offers) {
    const k = o.v + ':' + o.sku;
    seen.add(k);
    const was = prev.byKey.get(k);
    if (!was) { added++; continue; }
    if (was.price > 0 && o.price > 0) {
      const pct = (o.price - was.price) / was.price;
      if (Math.abs(pct) > 0.25) moved.push({ pct, v: o.v, name: o.name, from: was.price, to: o.price });
    }
  }
  for (const k of prev.byKey.keys()) if (!seen.has(k)) gone++;
  if (moved.length) {
    moved.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    warnings.push(`${moved.length} price${moved.length === 1 ? '' : 's'} moved more than 25% — largest:`);
    for (const m of moved.slice(0, 10)) {
      warnings.push(`    ${(m.pct > 0 ? '+' : '') + Math.round(m.pct * 100)}%  ${m.v}  $${m.from} → $${m.to}  ${m.name.slice(0, 52)}`);
    }
  }
  if (gone) warnings.push(`${gone} item${gone === 1 ? '' : 's'} no longer listed by their vendor.`);
  if (added) warnings.push(`${added} item${added === 1 ? '' : 's'} are new.`);
}

if (warnings.length) {
  console.log('— worth a look —');
  for (const w of warnings) console.log('  ' + w);
  console.log('');
}
if (blockers.length) {
  console.log('— STOPPED, catalog NOT written —');
  for (const b of blockers) console.log('  ✗ ' + b);
  if (FORCE) console.log('\n  --force given, writing anyway.\n');
  else {
    console.log('\n  Fix the sheet(s) above and run again. If these changes are real,');
    console.log('  re-run with:  npm run import -- --force\n');
    process.exit(1);
  }
}

const items = offers.map(o => [
  V.indexOf(o.v), o.sku, o.name, o.brand, o.cat, o.pack,
  o.lbs, o.price, o.perLb, o.bulk ? 1 : 0, o.img ? 1 : 0, o.shelfDays,
  o.stock, o.upcs.join('|'), o.brk || 0, o.shelfEst || 0, o.units || 0,
  o.sale ? 1 : 0, o.was || 0,
]);
fs.writeFileSync(CAT_PATH, JSON.stringify({ v: V, generated, dates, items }));
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
