// POSTA/build-posters.js
const fs = require('node:fs');
const path = require('node:path');
const { generatePoster } = require('./generatePoster');

// ⚠️ CHANGE THESE:
const GITHUB_USER = 'YOUR_GITHUB_USERNAME';
const GITHUB_REPO = 'YOUR_REPO_NAME';
const BRANCH      = 'main';

// ⚠️ CHANGE THIS to where your events come from:
const FEED_URL = 'https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/events.json';
// OR if it's already in the repo:
// const FEED_URL = null;

(async () => {
  const postersDir = path.join(__dirname, '..', 'posters');
  const apiOutPath = path.join(__dirname, '..', 'api', 'events.json');
  fs.mkdirSync(postersDir, { recursive: true });
  fs.mkdirSync(path.dirname(apiOutPath), { recursive: true });

  // ---- Load the feed ----
  let feed;
  if (FEED_URL) {
    console.log(`Fetching feed from: ${FEED_URL}`);
    const res = await fetch(FEED_URL);
    if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`);
    feed = await res.json();
  } else {
    const localPath = path.join(__dirname, '..', 'events.json');
    console.log(`Reading feed from: ${localPath}`);
    feed = JSON.parse(fs.readFileSync(localPath, 'utf8'));
  }

  let generated = 0, skipped = 0, failed = 0;

  // Clean up old posters
  const validIds = new Set(feed.events.map(e => e.id));
  for (const f of fs.readdirSync(postersDir)) {
    if (f.endsWith('.svg') && !validIds.has(f.slice(0, -4))) {
      fs.unlinkSync(path.join(postersDir, f));
    }
  }

  const CONCURRENCY = 12;
  const queue = [...feed.events];

  async function worker() {
    while (queue.length > 0) {
      const ev = queue.shift();
      const outPath = path.join(postersDir, `${ev.id}.svg`);
      const publicUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${BRANCH}/posters/${ev.id}.svg`;

      if (fs.existsSync(outPath)) {
        ev.posterUrl = publicUrl;
        skipped++;
        continue;
      }

      try {
        const dataUrl = await generatePoster(ev);
        fs.writeFileSync(outPath, decodeURIComponent(dataUrl.split(',')[1]));
        ev.posterUrl = publicUrl;
        generated++;
        if (generated % 50 === 0) console.log(`Generated ${generated}...`);
      } catch (e) {
        console.error(`❌ ${ev.id}: ${e.message}`);
        ev.posterUrl = ev.poster || ev.sportIcon;
        failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  fs.writeFileSync(apiOutPath, JSON.stringify(feed, null, 2));

  console.log(`\n✅ DONE!`);
  console.log(`   Generated: ${generated}`);
  console.log(`   Skipped:   ${skipped}`);
  console.log(`   Failed:    ${failed}`);
  console.log(`   Total:     ${feed.events.length}`);
})();
