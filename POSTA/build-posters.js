const fs = require('node:fs');
const path = require('node:path');
const { generatePoster } = require('./generatePoster');

const GITHUB_USER = 'UNFTHE4';
const GITHUB_REPO = 'UNF-SERVICES-MANAGEMENT';
const BRANCH      = 'main';

// YOUR REAL DATA SOURCE
const LIVE_FEED_URL = 'https://raw.githubusercontent.com/UNFTHE4/UNF-SERVICES-MANAGEMENT/refs/heads/main/api/schedule.json';

(async () => {
  const postersDir = path.join(__dirname, '..', 'posters');
  const apiOutPath = path.join(__dirname, '..', 'api', 'events.json');
  
  fs.mkdirSync(postersDir, { recursive: true });
  fs.mkdirSync(path.dirname(apiOutPath), { recursive: true });

  console.log(`Fetching live feed from: ${LIVE_FEED_URL}`);
  const res = await fetch(LIVE_FEED_URL);
  if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`);
  const schedule = await res.json();
  
  const events = schedule.events;
  if (!events || events.length === 0) {
    throw new Error("Fetched schedule is empty or invalid format.");
  }
  console.log(`Loaded ${events.length} events. Generating banners...`);

  let generated = 0;

  for (const ev of events) {
    // Generate a unique ID based on the event name and time
    const cleanName = ev.name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const eventId = `${cleanName}-${new Date(ev.start_time_utc).getTime()}`;
    const outPath = path.join(postersDir, `${eventId}.svg`);
    
    // Construct the URL your app will use
    const publicUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/refs/heads/${BRANCH}/posters/${eventId}.svg`;

    // Map the ESPN schedule data to what the poster generator expects
    const posterEvent = {
      id: eventId,
      isSolo: !ev.home_team, // If no home_team, it's a solo event (F1, UFC)
      sport: ev.sport,
      poster: ev.league_logo,
      homeTeam: ev.home_team || '',
      awayTeam: ev.away_team || ''
    };

    try {
      // Generate the SVG banner
      const dataUrl = await generatePoster(posterEvent);
      fs.writeFileSync(outPath, decodeURIComponent(dataUrl.split(',')[1]));
      
      // Add the new poster URL to the event object
      ev.posterUrl = publicUrl;
      generated++;
      
      if (generated % 50 === 0) console.log(`Generated ${generated} banners...`);
    } catch (e) {
      console.error(`❌ Failed to generate banner for ${ev.name}: ${e.message}`);
      ev.posterUrl = ev.league_logo; // Fallback to the original logo
    }
  }

  // Save the new API file
  fs.writeFileSync(apiOutPath, JSON.stringify(schedule, null, 2));

  console.log(`\n✅ DONE!`);
  console.log(`   Generated ${generated} banners.`);
  console.log(`   Saved new API feed to api/events.json`);
})();
