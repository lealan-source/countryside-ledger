// Regression suite for the Ledger search engine.
// Every case is a real aisle-reported bug from the original claude.ai build.
const fs = require('fs');
const path = require('path');
const LedgerSearch = require('../search.js');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/catalog.json'), 'utf8'));
const ITEMS = data.items.map(a => ({
  v: data.v[a[0]], sku: String(a[1]), name: a[2], brand: a[3], cat: a[4], pack: a[5],
  lbs: a[6], price: a[7], perLb: a[8], bulk: !!a[9], img: !!a[10], shelf: a[11],
  stock: a[12], u: a[13], brk: a[14],
}));
LedgerSearch.build(ITEMS);

let pass = 0, fail = 0, skip = 0;
const q = s => LedgerSearch.query(s).hits;
const findItem = re => ITEMS.find(it => re.test(it.name));
const rankOf = (hits, pred, depth) => hits.slice(0, depth || 50).findIndex(h => pred(h.it));

function check(label, ok, detail) {
  if (ok === null) { skip++; console.log('  SKIP  ' + label + (detail ? ' — ' + detail : '')); }
  else if (ok) { pass++; console.log('  pass  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

console.log('— equivalences —');
{
  const gwHits = q('milk chocolate chips 50 lb').filter(h => h.it.v === 'gw');
  const r = rankOf(gwHits, it => /drops chocolate milk/i.test(it.name), 3);
  check('chips↔drops: "milk chocolate chips 50 lb" → GW Drops Chocolate Milk tops the GW section',
    r >= 0, r < 0 ? 'GW top: ' + (gwHits[0] ? gwHits[0].it.name : 'none') : null);
  if (r >= 0) check('  …and near 100%', gwHits[r].conf >= 90, 'conf=' + gwHits[r].conf);
}
{
  const a = q('25# oats'), b = q('25 lb oats');
  check('25# ≡ 25 lb (same top result)', a.length && b.length && a[0].it.sku === b[0].it.sku,
    (a[0] && a[0].it.name) + ' vs ' + (b[0] && b[0].it.name));
}
{
  const t = findItem(/confectioner/i);
  const hits = q('powdered sugar');
  check('powdered → confectioner\'s', t ? rankOf(hits, it => /confectioner/i.test(it.name), 25) >= 0 : null,
    t ? 'not in top 25' : 'no confectioner item in catalog');
  const t2 = findItem(/powdered sugar/i);
  const hits2 = q('confectioners sugar');
  check('confectioner\'s → powdered', t2 ? rankOf(hits2, it => /powdered sugar/i.test(it.name), 25) >= 0 : null,
    t2 ? 'not in top 25' : 'no powdered-sugar item');
}
{
  const t = findItem(/marshmallow.*dehyd|dehyd.*marshmallow/i);
  const hits = q('dehydrated marshmallow bits');
  check('Dehyd. ≡ dehydrated (+ form-word exemption vs candy penalty)',
    t ? rankOf(hits, it => /marshmallow/i.test(it.name) && /dehyd/i.test(it.name), 5) >= 0 : null,
    t ? 'top: ' + (hits[0] ? hits[0].it.name : 'none') : 'no dehyd marshmallow item');
}

console.log('— plurals —');
{
  // the app groups results by vendor, so rank within the FR section is what matters
  const frHits = q('spearmint leaves').filter(h => h.it.v === 'fr');
  const r = rankOf(frHits, it => /spearmint leaf/i.test(it.name), 3);
  check('leaves↔leaf: FR "Spearmint Leaf, Cut & Sifted" tops the FR section', r >= 0,
    'FR top: ' + (frHits[0] ? frHits[0].it.name : 'none'));
}
{
  const t = findItem(/blueberr/i);
  const hits = q('blueberry');
  check('berry↔berries', t ? rankOf(hits, it => /blueberr/i.test(it.name), 10) >= 0 : null);
}

console.log('— precision —');
{
  const hits = q('baking soda');
  const rPlain = rankOf(hits, it => /baking soda/i.test(it.name) && !/gluten/i.test(it.name), 20);
  const rGf = rankOf(hits, it => /gluten free baking soda/i.test(it.name), 20);
  check('"baking soda": plain ranks above Gluten Free',
    rGf < 0 ? null : rPlain >= 0 && rPlain < rGf,
    rGf < 0 ? 'no GF baking soda in catalog' : `plain=${rPlain} gf=${rGf}`);
  if (rGf >= 0) {
    const hits2 = q('gluten free baking soda');
    const rGf2 = rankOf(hits2, it => /gluten free baking soda/i.test(it.name), 20);
    const rPlain2 = rankOf(hits2, it => /baking soda/i.test(it.name) && !/gluten/i.test(it.name), 20);
    check('"gluten free baking soda" flips the order', rGf2 >= 0 && (rPlain2 < 0 || rGf2 < rPlain2), `gf=${rGf2} plain=${rPlain2}`);
  }
}
{
  const fr = ITEMS.filter(it => it.v === 'fr' && /^frontier/i.test(it.brand || ''));
  if (!fr.length) check('brand exemption', null, 'no Frontier-brand items');
  else {
    const sample = fr.find(it => /tea/i.test(it.name)) || fr[0];
    const words = sample.name.toLowerCase().replace(/frontier co-?op/i, '').match(/[a-z]{4,}/g) || [];
    const hits = q(words.slice(0, 2).join(' '));
    const r = rankOf(hits, it => it.sku === sample.sku && it.v === 'fr', 30);
    check('brand words don\'t sink FR items ("' + words.slice(0, 2).join(' ') + '")', r >= 0, 'rank=' + r);
  }
}

console.log('— fuzzy guard —');
{
  const hits = q('spearmint');
  const r = rankOf(hits, it => /papaya spears/i.test(it.name), 20);
  check('"spearmint" must NOT hit Papaya Spears', findItem(/papaya spears/i) ? r < 0 : null,
    'rank=' + r);
}

console.log('— intent & context —');
{
  const hits = q('strawberries dried');
  const rDried = rankOf(hits, it => /dried/i.test(it.name) && /strawberr/i.test(it.name), 10);
  const rJam = rankOf(hits, it => /jam|preserve/i.test(it.name) && /strawberr/i.test(it.name), 10);
  check('"strawberries dried" → Dried Strawberries top, above jam',
    rDried >= 0 && (rJam < 0 || rDried < rJam), `dried=${rDried} jam=${rJam}`);
}
{
  const hits = q('dried spearmint leaves bulk');
  const rHerb = rankOf(hits, it => /spearmint/i.test(it.name) && !/gum|jell|candy|toothpaste/i.test(it.name + it.cat), 5);
  const rCandy = rankOf(hits, it => /gumm|jell/i.test(it.name + ' ' + it.cat) && /spearmint|leaves/i.test(it.name), 10);
  const rPaste = rankOf(hits, it => /toothpaste/i.test(it.name), 10);
  check('herb context: herb/tea on top', rHerb >= 0, 'top: ' + (hits[0] ? hits[0].it.name : 'none'));
  check('  …candy leaves demoted below herb', rCandy < 0 || rCandy > rHerb, `candy=${rCandy} herb=${rHerb}`);
  check('  …toothpaste sinks out of top 10', rPaste < 0, 'rank=' + rPaste);
  const hits2 = q('spearmint leaves gummy');
  const rCandy2 = rankOf(hits2, it => /gumm/i.test(it.name + ' ' + it.cat), 5);
  check('"spearmint leaves gummy" puts candy back on top', findItem(/gumm.*spearmint|spearmint.*gumm/i) ? rCandy2 >= 0 : null, 'rank=' + rCandy2);
}
{
  const res = LedgerSearch.query('bulk rolled oats');
  check('"bulk" is intent, not a matching word', res.intent === 'bulk' && res.hits.length > 0,
    'intent=' + res.intent + ' hits=' + res.hits.length);
}

console.log('— pack class —');
{
  const it = ITEMS.find(x => x.v === 'fr' && x.sku === '1007');
  check('FR #1007 (16 OZ = 1 lb bag) is bulk', it ? it.bulk === true : null, it ? 'bulk=' + it.bulk : 'item missing');
}
{
  const multi = ITEMS.filter(it => /\b12\s*\/\s*2\s*lb|\b4\s*\/\s*16\s*oz/i.test(it.name + ' ' + it.pack));
  check('12/2lb & 4/16oz multipacks prepacked', multi.length ? multi.every(it => !it.bulk) : null,
    multi.filter(it => it.bulk).slice(0, 2).map(it => it.name).join('; '));
  const blocks = ITEMS.filter(it => /^5\s*\/\s*10\s*lb$/i.test(it.pack));
  check('5/10 lb blocks bulk', blocks.length ? blocks.every(it => it.bulk) : null,
    blocks.filter(it => !it.bulk).slice(0, 2).map(it => it.name).join('; '));
}

console.log('— name beats category —');
{
  const hits = q('granola');
  const top5 = hits.slice(0, 5);
  check('"granola" top 5 all have granola in the NAME',
    top5.length > 0 && top5.every(h => /granola|grand-ola/i.test(h.it.name)),
    'top: ' + top5.map(h => h.it.name.slice(0, 30)).join(' | '));
  const hits2 = q('natural maple granola');
  check('"natural maple granola" → Grand-ola on top (the store repack case)',
    hits2.length > 0 && /maple grand-ola granola|maple granola/i.test(hits2[0].it.name),
    'top: ' + (hits2[0] ? hits2[0].it.name : 'none'));
}

console.log('— exact codes —');
{
  const hits = q('838273000102');
  check('UPC 838273000102 → DV', hits.length ? hits[0].it.v === 'dv' : null,
    hits.length ? hits[0].it.v + ' ' + hits[0].it.name : 'no hit (UPC not in sheet?)');
  const hits2 = q('051381921828');
  check('UPC 051381921828 → FR', hits2.length ? hits2[0].it.v === 'fr' : null,
    hits2.length ? hits2[0].it.v + ' ' + hits2[0].it.name : 'no hit');
  const hits3 = q('4910');
  check('"4910" → GW item', hits3.length ? hits3[0].it.v === 'gw' && hits3[0].it.sku === '4910' : null,
    hits3.length ? hits3[0].it.v + ':' + hits3[0].it.sku : 'no hit');
  const hits4 = q('005 010');
  check('"005 010" → DV code', hits4.length > 0 && hits4[0].it.v === 'dv' && hits4[0].it.sku === '005010',
    hits4.length ? hits4[0].it.v + ':' + hits4[0].it.sku : 'no hit');
}

console.log('— money semantics —');
{
  const it = ITEMS.find(x => x.v === 'fr' && x.sku === '1007');
  check('FR $/EA on 16 OZ = $/lb', it && it.perLb ? Math.abs(it.perLb - it.price) < 0.01 : null,
    it ? `each=${it.price} perLb=${it.perLb}` : 'missing');
  const wcOz = ITEMS.filter(it => it.v === 'wc' && /^\d+\/\d+(\.\d+)?\s*oz$/i.test(it.pack) && it.perLb && it.lbs);
  const bad = wcOz.filter(it => Math.abs(it.perLb * it.lbs - it.price) > 0.05);
  check('WC oz packs: perLb × lbs = case total (' + wcOz.length + ' items)', wcOz.length ? bad.length === 0 : null,
    bad.slice(0, 2).map(it => `${it.name} perLb=${it.perLb} lbs=${it.lbs} price=${it.price}`).join('; '));
}

console.log(`\n${pass} passed · ${fail} failed · ${skip} skipped`);
process.exit(fail ? 1 : 0);
