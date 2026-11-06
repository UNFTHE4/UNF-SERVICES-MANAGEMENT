const fs = require('node:fs');
const path = require('node:path');
const { generatePoster } = require('./generatePoster');

const GITHUB_USER = 'UNFTHE4';
const GITHUB_REPO = 'UNF-SERVICES-MANAGEMENT';
const BRANCH      = 'main';

(async () => {
  const postersDir = path.join(__dirname, '..', 'posters');
  const apiOutPath = path.join(__dirname, '..', 'api', 'events.json');
  
  fs.mkdirSync(postersDir, { recursive: true });

  const res = await fetch('https://raw.githubusercontent.com/UNFTHE4/UNF-SERVICES-MANAGEMENT/refs/heads/main/api/schedule.json');
  const schedule = await res.json();
  const events = schedule.events;

  for (const ev of events) {
    const eventId = `${ev.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date(ev.start_time_utc).getTime()}`;
    const outPath = path.join(postersDir, `${eventId}.svg`);
    
    // Skip if it already exists so we don't re-generate everything
    if (fs.existsSync(outPath)) continue; 

    const posterEvent = {
      isSolo: !ev.home_team,
      sport: ev.sport,
      poster: ev.league_logo, // Maps your schedule data to the poster script
      homeTeam: ev.home_team || '',
      awayTeam: ev.away_team || ''
    };

    const dataUrl = await generatePoster(posterEvent);
    fs.writeFileSync(outPath, decodeURIComponent(dataUrl.split(',')[1]));

    ev.posterUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/refs/heads/${BRANCH}/posters/${eventId}.svg`;
  }

  fs.writeFileSync(apiOutPath, JSON.stringify(schedule, null, 2));
  console.log(`✅ Done. Created files and updated api/events.json`);
})();
