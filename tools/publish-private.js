// Upload the store's purchase history to the PRIVATE countryside-orders repo.
//
// data/purchases.json is deliberately not in the public repo — it is what we
// buy, when, in what quantity and at what price. The app reads it from the
// private repo using the same GitHub token the order sheets use.
//
//   node publish-private.js
//
// The token is read from tools/.gh-token (gitignored) or the GH_TOKEN
// environment variable. It needs Contents read & write on countryside-orders.
const fs = require('fs');
const path = require('path');

const PROJ = path.resolve(__dirname, '..');
const FILE = path.join(PROJ, 'data', 'purchases.json');
const REPO = 'lealan-source/countryside-orders';
const DEST = 'data/purchases.json';
const API = `https://api.github.com/repos/${REPO}/contents/${DEST}`;

function token() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  const f = path.join(__dirname, '.gh-token');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  return null;
}

(async () => {
  if (!fs.existsSync(FILE)) {
    console.log('No data/purchases.json yet — run the importer first.');
    process.exit(1);
  }
  const t = token();
  if (!t) {
    console.log('No GitHub token found.\n');
    console.log('Create a fine-grained token with Contents read & write on');
    console.log(`${REPO}, then save it as one line in:`);
    console.log('  tools\\.gh-token        (this file is gitignored)');
    console.log('\nor set GH_TOKEN in the environment.');
    process.exit(1);
  }

  const headers = { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json' };
  const body = fs.readFileSync(FILE);

  // updating an existing file needs its current sha
  let sha = null;
  const head = await fetch(API, { headers }).catch(() => null);
  if (head && head.status === 200) sha = (await head.json()).sha;
  else if (head && head.status === 404) sha = null;
  else if (head && (head.status === 401 || head.status === 403)) {
    console.log('GitHub rejected that token. Check it has Contents read & write on ' + REPO + '.');
    process.exit(1);
  } else if (!head) {
    console.log('Could not reach GitHub.');
    process.exit(1);
  }

  const res = await fetch(API, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'purchase history ' + new Date().toISOString().slice(0, 10),
      content: body.toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });

  if (res.status === 404) {
    console.log(`Couldn't find ${REPO}. Create it as an empty PRIVATE repo on github.com first.`);
    process.exit(1);
  }
  if (!res.ok) {
    console.log('Upload failed: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
    process.exit(1);
  }
  const kb = (body.length / 1024).toFixed(1);
  console.log(`Uploaded ${kb} KB to ${REPO}/${DEST}${sha ? ' (updated)' : ' (created)'}.`);
  console.log('The app will pick it up on any device with the token pasted in.');
})();
