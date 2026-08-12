// Countryside Ledger — the whole weekly price update in one command.
//   rebuild → check → show what changed → bump the service worker → publish
// Nothing is published until you say so, and a failed check stops the line.
const { spawnSync } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const PROJ = path.resolve(__dirname, '..');
const SW = path.join(PROJ, 'sw.js');
const FORCE = process.argv.includes('--force');
// Explicit list — never `git add -A`, so Price Sheets and Product Images can't
// ride along even if .gitignore were ever wrong.
const PUBLISH = ['data/catalog.json', 'data/history.json', 'images', 'sw.js', 'Price Changes.md'];

const run = (cmd, args, opts) =>
  spawnSync(cmd, args, { cwd: PROJ, stdio: 'inherit', ...opts });
const capture = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: PROJ, encoding: 'utf8' });
  return (r.stdout || '').trim();
};
const rule = () => console.log('\n' + '─'.repeat(64) + '\n');

/* ---------- 1. rebuild the catalog (build.js runs the safety checks) ---------- */
const build = run(process.execPath, [path.join(__dirname, 'build.js'), ...(FORCE ? ['--force'] : [])]);
if (build.status !== 0) {
  console.log('Nothing was published. Fix the sheets above and run this again.');
  process.exit(1);
}

/* ---------- 2. thumbnails for any new products ---------- */
rule();
const thumbs = run(process.execPath, [path.join(__dirname, 'thumbs.js')]);
if (thumbs.status !== 0) {
  console.log('\nThumbnails failed. The catalog is fine — publish anyway or fix it first.');
}

/* ---------- 3. what actually changed? ---------- */
rule();
const changed = capture('git', ['status', '--porcelain', '--', ...PUBLISH]);
if (!changed) {
  console.log('Prices rebuilt and nothing changed — the app is already up to date.');
  console.log('Nothing to publish.');
  process.exit(0);
}
console.log('Ready to publish:\n');
console.log(capture('git', ['diff', '--stat', '--', ...PUBLISH]) || '  (new files)');

const cat = JSON.parse(fs.readFileSync(path.join(PROJ, 'data/catalog.json'), 'utf8'));
const NAME = { dv: 'Dutch Valley', gw: 'Gateway', wc: 'Walnut Creek', fr: 'Frontier', dw: 'Denver Wholesale' };
const age = d => {
  const days = Math.round((Date.now() - new Date(d + 'T12:00:00')) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? '1 day old' : days + ' days old';
};
console.log('\nPrice ages once published:');
for (const v of ['dv', 'gw', 'wc', 'fr', 'dw']) {
  if (cat.dates && cat.dates[v]) console.log(`  ${NAME[v].padEnd(17)} ${cat.dates[v]}  (${age(cat.dates[v])})`);
}

/* ---------- 4. confirm ---------- */
rule();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Publish this to the app? Everyone\'s phones update next time they open it. (y/N) ', answer => {
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('\nStopped. Nothing was published — the rebuilt catalog is still on this PC,');
    console.log('so you can run this again when you\'re ready.');
    process.exit(0);
  }
  publish();
});

function publish() {
  /* bump the service worker so installed apps actually pick the new prices up */
  const sw = fs.readFileSync(SW, 'utf8');
  const m = sw.match(/const VERSION = 'countryside-ledger-v(\d+)';/);
  if (!m) {
    console.log('\nCouldn\'t find the VERSION line in sw.js — stopping so nothing ships half-done.');
    process.exit(1);
  }
  const next = +m[1] + 1;
  fs.writeFileSync(SW, sw.replace(m[0], `const VERSION = 'countryside-ledger-v${next}';`));
  console.log(`\nservice worker: v${m[1]} → v${next}`);

  run('git', ['add', '--', ...PUBLISH]);
  const msg = `Prices updated — ${Object.entries(cat.dates || {}).map(([v, d]) => `${v} ${d}`).join(', ')}`;
  const commit = run('git', ['commit', '-m', msg]);
  if (commit.status !== 0) { console.log('\nCommit failed — nothing pushed.'); process.exit(1); }

  const push = run('git', ['push', 'origin', 'main']);
  rule();
  if (push.status !== 0) {
    console.log('Committed here, but the push failed — check the message above.');
    console.log('Your prices are saved locally; run  git push origin main  once it\'s sorted.');
    process.exit(1);
  }
  console.log('Published. GitHub Pages redeploys in a minute or two, and phones');
  console.log(`pick it up next time the Ledger is opened (service worker v${next}).`);
}
