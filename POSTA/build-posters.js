// POSTA/build-posters.js
const fs = require('node:fs');
const path = require('node:path');
const { generatePoster } = require('./generatePoster');

// ⚠️ IMPORTANT: Change these to match your GitHub details
const GITHUB_USER = 'YOUR_GITHUB_USERNAME';
const GITHUB_REPO = 'YOUR_REPO_NAME';
const BRANCH = 'main';

(async () => {
  // Paths relative to the repo root
  const apiFilePath = path.join(__dirname, '..', 'api', 'events.json');
  const outDir = path.join(__dirname, '..', 'posters');
  
  // Read the existing events feed
  const feed = JSON.parse(fs.readFileSync(apiFilePath, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });

  let generated = 0, skipped = 0;

  // Clean up old posters that are no longer in the feed
  const validIds = new Set(feed.events.map(e => e.id));
  for (const f of fs.readdirSync(outDir)) {
    if (f.endsWith('.svg') && !validIds.has(f.slice(0, -4))) {
      fs.unlinkSync(path.join(outDir, f));
    }
  }

  const CONCURRENCY = 12;
  const queue = [...feed.events];

  async function worker() {
    while (queue.length) {
      const ev = queue.shift();
      const outPath = path.join(outDir, `${ev.id}.svg`);
      
      // The URL your app will consume
      const publicUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${BRANCH}/posters/${ev.id}.svg`;

      // Skip generating if file already exists to save time
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
      } catch (e) {
        console.error(`❌ Failed to generate ${ev.id}: ${e.message}`);
        ev.posterUrl = ev.poster; // Fallback to original logo if it fails
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  
  // Write the updated feed back into the API folder
  fs.writeFileSync(apiFilePath, JSON.stringify(feed, null, 2));
  
  console.log(`✅ Generated ${generated}, skipped ${skipped}, total ${feed.events.length}`);
  console.log(`✅ Saved updated API feed to: api/events.json`);
})();
