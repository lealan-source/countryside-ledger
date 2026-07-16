/* Countryside Ledger — search engine
   Token scoring with unit equivalences, plural stemming, synonym groups,
   idf weighting, brand-exempt precision, size bonus, intent words, and
   herb/candy context weighting with the form-word exemption.
   Loaded by index.html; also require()-able for the Node regression suite. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.LedgerSearch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const UNIT_MAP = { lbs: 'lb', pound: 'lb', pounds: 'lb', ounce: 'oz', ounces: 'oz', count: 'ct', counts: 'ct', packs: 'pk', pack: 'pk' };
  const ABBREV = { dehyd: 'dehydrated', confect: 'confectioners', tsp: 'teaspoon', tbsp: 'tablespoon' };
  const STEM_EXCEPTIONS = { leaves: 'leaf', loaves: 'loaf', halves: 'half' };
  const SYNONYMS = [
    ['chip', 'drop', 'morsel'],
    ['powdered', 'confectioner', 'confectioners', '10x'],
    ['dried', 'dehydrated'],
  ];
  const INTENT = { bulk: 'bulk', prepacked: 'prepacked', prepack: 'prepacked', packaged: 'prepacked' };
  const HERB_CTX = new Set(['dried', 'dehydrated', 'tea', 'herb', 'herbal']);
  const CANDY_CTX = new Set(['gummy', 'gummi', 'gummies', 'candy', 'jells', 'jell']);
  const CANDY_SIGNAL = /gumm|jell(?:s|y|ies)|candy/i;
  const CARE_SIGNAL = /toothpaste|tooth\s*powder|soap|shampoo|lotion|deodorant|conditioner|castile/i;

  const SYN_GROUP = new Map();
  SYNONYMS.forEach((g, i) => g.forEach(w => SYN_GROUP.set(w, i)));

  function stem(t) {
    if (STEM_EXCEPTIONS[t]) return STEM_EXCEPTIONS[t];
    if (t.length > 3 && /(ies)$/.test(t)) return t.slice(0, -3) + 'y';
    if (t.length > 3 && /(sses|xes|ches|shes)$/.test(t)) return t.slice(0, -2);
    if (t.length > 2 && /s$/.test(t) && !/ss$/.test(t) && !/us$/.test(t)) return t.slice(0, -1);
    return t;
  }

  // → {words:[stems], sizes:[{n,unit}], intent:null|'bulk'|'prepacked', ctx:{herb,candy}}
  function tokenize(s) {
    s = String(s).toLowerCase()
      .replace(/,(?=\d{3})/g, '')          // 1,000 → 1000
      .replace(/(\d)\s*#/g, '$1 lb')       // 25# → 25 lb
      .replace(/[^a-z0-9.]+/g, ' ')
      .replace(/\.(?!\d)/g, ' ');          // keep decimals, drop other dots
    const raw = s.split(/\s+/).filter(Boolean);
    const words = [], sizes = [];
    let intent = null;
    for (let i = 0; i < raw.length; i++) {
      let t = raw[i];
      t = UNIT_MAP[t] || t;
      t = ABBREV[t] || t;
      if (INTENT[t]) { intent = INTENT[t]; continue; }
      if (/^\d+(\.\d+)?$/.test(t)) {
        const next = UNIT_MAP[raw[i + 1]] || raw[i + 1];
        if (next === 'lb' || next === 'oz' || next === 'ct' || next === 'pk') {
          sizes.push({ n: +t, unit: next });
          i++;
        }
        continue; // bare numbers are sizes/codes, not words
      }
      if (t === 'lb' || t === 'oz' || t === 'ct' || t === 'pk' || t === 'ea' || t === 'each') continue;
      if (t.length < 2) continue;
      words.push(stem(t));
    }
    const ctx = {
      herb: words.some(w => HERB_CTX.has(w)) || raw.some(w => HERB_CTX.has(w)),
      candy: words.some(w => CANDY_CTX.has(w)) || raw.some(w => CANDY_CTX.has(w)),
    };
    return { words, sizes, intent, ctx };
  }

  function editDistance1(a, b) { // true if damerau-levenshtein distance ≤ 1
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    if (la === lb) {
      let diff = 0, swap = false;
      for (let i = 0; i < la; i++) if (a[i] !== b[i]) diff++;
      if (diff === 1) return true;
      if (diff === 2) { // adjacent transposition
        for (let i = 0; i < la - 1; i++) {
          if (a[i] !== b[i]) { swap = a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); break; }
        }
        return swap;
      }
      return false;
    }
    const [sh, lo] = la < lb ? [a, b] : [b, a];
    let i = 0, j = 0, skipped = false;
    while (i < sh.length && j < lo.length) {
      if (sh[i] === lo[j]) { i++; j++; }
      else if (!skipped) { skipped = true; j++; }
      else return false;
    }
    return true;
  }

  let ITEMS = [], META = [], IDF = new Map();

  function build(items) {
    ITEMS = items;
    META = items.map(it => {
      const name = tokenize(it.name);
      const brandWords = new Set(tokenize(it.brand || '').words.concat(['co', 'op']));
      const catWords = tokenize(it.cat || '').words;
      const all = new Set(name.words.concat(catWords));
      const sizes = name.sizes.slice();
      if (it.lbs) sizes.push({ n: it.lbs, unit: 'lb' });
      if (it.pack) for (const sz of tokenize(it.pack).sizes) sizes.push(sz);
      const text = (it.name + ' ' + it.cat).toLowerCase();
      const nameSet = new Set(name.words);
      for (const w of tokenize(it.brand || '').words) nameSet.add(w);
      const catSet = new Set(catWords);
      return {
        nameWords: name.words, all, brandWords, sizes, nameSet, catSet,
        candy: CANDY_SIGNAL.test(text) || /candy/i.test(it.cat || ''),
        care: CARE_SIGNAL.test(text),
        upcs: (it.u ? it.u.split('|') : []).map(u => u.replace(/^0+/, '')),
      };
    });
    IDF = new Map();
    for (const m of META) for (const w of m.all) IDF.set(w, (IDF.get(w) || 0) + 1);
    const N = items.length;
    for (const [w, df] of IDF) IDF.set(w, 1 + Math.log(N / df));
    return { items: N };
  }

  const EMPTY_SET = new Set();
  // Name (and brand) matches carry full credit; a match found only in the
  // vendor's category gets partial credit — being FILED under Granola must
  // never outrank being NAMED Granola.
  function creditFor(qw, nameSet, catSet) {
    catSet = catSet || EMPTY_SET;
    if (nameSet.has(qw)) return 1;
    const g = SYN_GROUP.get(qw);
    if (g !== undefined) {
      for (const w of nameSet) if (SYN_GROUP.get(w) === g) return 0.9;
    }
    if (qw.length >= 5) {
      for (const w of nameSet) {
        if (w.length >= 5 && w[0] === qw[0] && editDistance1(qw, w)) return 0.75;
      }
    }
    if (catSet.has(qw)) return 0.72;
    if (g !== undefined) {
      for (const w of catSet) if (SYN_GROUP.get(w) === g) return 0.62;
    }
    return 0;
  }

  function query(q, opts) {
    opts = opts || {};
    q = String(q || '').trim();
    if (!q) return { hits: [], intent: null };

    // exact codes: UPC (≥6 digits) or vendor sku
    const digits = q.replace(/[\s#-]/g, '');
    if (/^\d{4,}$/.test(digits)) {
      const hits = [];
      const bare = digits.replace(/^0+/, '');
      for (let i = 0; i < ITEMS.length; i++) {
        const it = ITEMS[i], m = META[i];
        const skuDigits = it.sku.replace(/\D/g, '');
        if (it.sku.toLowerCase() === digits.toLowerCase() || (skuDigits && skuDigits === bare)) {
          hits.push({ it, score: 1, conf: 99 });
          continue;
        }
        if (bare.length >= 6 && m.upcs.some(u =>
          u === bare || (u.length >= 8 && (u.startsWith(bare) || bare.startsWith(u))))) {
          hits.push({ it, score: 0.98, conf: 98 });
        }
      }
      if (hits.length) return { hits, intent: null };
    }
    // alphanumeric sku ("GDS 103")
    if (/^[a-z]{2,4}\s*\d+$/i.test(q)) {
      const skuq = q.replace(/\s+/g, '').toLowerCase();
      const hits = ITEMS.filter(it => it.sku.toLowerCase() === skuq).map(it => ({ it, score: 1, conf: 99 }));
      if (hits.length) return { hits, intent: null };
    }

    const Q = tokenize(q);
    if (!Q.words.length && !Q.sizes.length) return { hits: [], intent: Q.intent };
    const hits = [];
    const qIdf = Q.words.map(w => IDF.get(w) || 2.5);
    const idfSum = qIdf.reduce((a, b) => a + b, 0) || 1;

    for (let i = 0; i < ITEMS.length; i++) {
      const m = META[i];
      let got = 0;
      const matchedWords = [];
      for (let k = 0; k < Q.words.length; k++) {
        const c = creditFor(Q.words[k], m.nameSet, m.catSet);
        if (c > 0) matchedWords.push(Q.words[k]);
        got += c * qIdf[k];
      }
      let coverage = got / idfSum;
      if (Q.words.length && coverage < 0.66) continue;
      if (!Q.words.length) coverage = 0.7; // size-only query

      // precision: unmatched item name words are noise; brand words exempt
      let noise = 0;
      for (const w of m.nameWords) {
        if (m.brandWords.has(w)) continue;
        if (creditFor(w, new Set(Q.words))) continue;
        noise++;
      }
      let score = coverage / (1 + 0.035 * noise);

      // size bonus
      if (Q.sizes.length && m.sizes.length) {
        const hit = Q.sizes.some(qs => m.sizes.some(is =>
          qs.unit === is.unit && Math.abs(qs.n - is.n) <= Math.max(0.5, qs.n * 0.1)));
        if (hit) score = Math.min(1, score * 1.06);
      }

      // context weighting with the form-word exemption
      if (Q.ctx.herb && !Q.ctx.candy) {
        const hasFormWord = matchedWords.some(w => HERB_CTX.has(w));
        if (m.candy && !hasFormWord) score *= 0.82;
        if (m.care) score *= 0.6;
      }
      if (Q.ctx.candy && m.candy) score = Math.min(1, score * 1.08);

      hits.push({ it: ITEMS[i], score, conf: Math.max(60, Math.min(99, Math.round(score * 100))) });
    }
    hits.sort((a, b) => b.score - a.score);
    return { hits, intent: Q.intent };
  }

  return { build, query, tokenize, stem, _editDistance1: editDistance1 };
});
