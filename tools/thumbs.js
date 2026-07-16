// Generate 320px webp thumbnails for every matched product image.
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const PROJ = 'C:/Users/StoreLIVE/Documents/Country Ledger';
const jobs = JSON.parse(fs.readFileSync(__dirname + '/thumb-jobs.json', 'utf8'));
const CONC = 10;

let done = 0, failed = 0, skipped = 0, bytes = 0;
async function worker(queue) {
  for (;;) {
    const job = queue.pop();
    if (!job) return;
    const out = path.join(PROJ, job.out);
    try {
      if (fs.existsSync(out)) { skipped++; }
      else {
        fs.mkdirSync(path.dirname(out), { recursive: true });
        await sharp(job.src)
          .flatten({ background: '#ffffff' })
          .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 68 })
          .toFile(out);
      }
      bytes += fs.statSync(out).size;
    } catch (e) { failed++; }
    done++;
    if (done % 2000 === 0) console.log(`${done}/${jobs.length}  (${(bytes / 1048576).toFixed(0)} MB)`);
  }
}
(async () => {
  const queue = [...jobs];
  await Promise.all(Array.from({ length: CONC }, () => worker(queue)));
  console.log(`DONE: ${done} processed, ${skipped} already existed, ${failed} failed, total ${(bytes / 1048576).toFixed(1)} MB`);
})();
