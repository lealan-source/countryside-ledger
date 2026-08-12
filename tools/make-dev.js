// Countryside Ledger — create and maintain the /dev/ copy of the app.
//
//   node make-dev.js            scaffold dev/ (never overwrites your dev edits)
//   node make-dev.js --data     refresh dev's catalog + history from live
//   node make-dev.js --reset    throw away dev's code edits, re-copy from live
//   node make-dev.js --promote  copy dev's code over live (ship your changes)
//
// dev keeps its own copy of the app and the data — so a change to the catalog
// format can't break the live app — but SHARES the 173 MB of thumbnails via a
// ../images/ path that index.html works out at runtime.
const fs = require('fs');
const path = require('path');

const PROJ = path.resolve(__dirname, '..');
const DEV = path.join(PROJ, 'dev');
const CODE = ['index.html', 'search.js', 'sw.js'];
const DATA = ['catalog.json', 'history.json'];

const mode = process.argv.find(a => /^--/.test(a)) || '';
const rel = p => path.relative(PROJ, p).replace(/\\/g, '/');
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); console.log('  ' + rel(to)); };

function copyData() {
  for (const f of DATA) {
    const src = path.join(PROJ, 'data', f);
    if (fs.existsSync(src)) copy(src, path.join(DEV, 'data', f));
    else console.log('  (skipped ' + f + ' — not built yet)');
  }
}

if (mode === '--promote') {
  const missing = CODE.filter(f => !fs.existsSync(path.join(DEV, f)));
  if (missing.length) { console.log('dev/ is missing ' + missing.join(', ') + ' — nothing to promote.'); process.exit(1); }
  console.log('Copying dev\'s code over the live app:');
  for (const f of CODE) copy(path.join(DEV, f), path.join(PROJ, f));
  console.log('\nDone. The live app now has dev\'s code. Review it, then publish:');
  console.log('  git diff            (see what changed)');
  console.log('  Update Prices.cmd   (bumps the service worker, commits, pushes)');
  console.log('\ndev/data is NOT promoted — live keeps its own catalog.');
  process.exit(0);
}

if (mode === '--data') {
  console.log('Refreshing dev\'s data from live:');
  copyData();
  console.log('\nDone. dev now has the same catalog and history as the live app.');
  process.exit(0);
}

const fresh = !fs.existsSync(DEV);
console.log(fresh ? 'Creating the dev copy:' : 'Updating the dev copy:');

for (const f of CODE) {
  const dest = path.join(DEV, f);
  if (!fresh && fs.existsSync(dest) && mode !== '--reset') {
    console.log('  kept your dev/' + f + ' (use --reset to overwrite)');
    continue;
  }
  copy(path.join(PROJ, f), dest);
}

// icons are only 113 KB, so dev gets its own and the service worker shell
// paths stay identical between the two copies
fs.mkdirSync(path.join(DEV, 'icons'), { recursive: true });
for (const f of fs.readdirSync(path.join(PROJ, 'icons'))) {
  copy(path.join(PROJ, 'icons', f), path.join(DEV, 'icons', f));
}

// its own manifest, so the phone installs it as a SEPARATE app rather than
// replacing the real Ledger on the home screen
const man = JSON.parse(fs.readFileSync(path.join(PROJ, 'manifest.webmanifest'), 'utf8'));
man.name = 'Countryside Ledger (DEV)';
man.short_name = 'Ledger DEV';
man.description = 'Testing copy of the Countryside Ledger — not the real price book.';
fs.writeFileSync(path.join(DEV, 'manifest.webmanifest'), JSON.stringify(man, null, 2) + '\n');
console.log('  dev/manifest.webmanifest');

if (fresh || mode === '--reset') copyData();

console.log('\nDone. The dev copy is at dev/ and publishes to:');
console.log('  https://lealan-source.github.io/countryside-ledger/dev/');
console.log('\nIt has its own catalog and its own offline cache, so nothing you do');
console.log('there can touch the live app. Edit dev/index.html freely; when a change');
console.log('is ready, run  node make-dev.js --promote.');
