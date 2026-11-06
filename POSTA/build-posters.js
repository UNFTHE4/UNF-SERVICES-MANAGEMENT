const fs = require('node:fs');
const path = require('node:path');
const { generatePoster } = require('./generatePoster');

const GITHUB_USER = 'UNFTHE4';
const GITHUB_REPO = 'UNF-SERVICES-MANAGEMENT';
const BRANCH      = 'main';

(async () => {
  // 1. Read your original massive JSON file
  // (Assuming your file is named events.json and is in the root of the repo)
  const sourcePath = path.join(__dirname, '..', 'events.json');
  const outDir = path.join(__dirname, '..', 'posters');
  
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Reading your data from ${sourcePath}...`);
  const feed = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

  let generated = 0;

  // 2. Loop through every event
  console.log(`Starting to generate ${feed.events.length} banners...`);
  
  for (const ev of feed.events) {
    const outPath = path.join(outDir, `${ev.id}.svg`);
    
    // 3. Take the ESPN logo link, make the banner
    const dataUrl = await generatePoster(ev);
    fs.writeFileSync(outPath, decodeURIComponent(dataUrl.split(',')[1]));

    // 4. Add the link to the new poster into the data
    ev.posterUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/refs/heads/${BRANCH}/posters/${ev.id}.svg`;
    generated++;
  }

  // 5. Save the new JSON file so your app can use it
  fs.writeFileSync(path.join(__dirname, '..', 'api', 'events.json'), JSON.stringify(feed, null, 2));

  console.log(`✅ DONE! Made ${generated} banners.`);
  console.log(`✅ Saved new data to api/events.json`);
})();
