'use strict';

function getTeamColor(teamName, isHome) {
  if (!teamName) return isHome ? '#111' : '#222';
  let hash = 0;
  for (let i = 0; i < teamName.length; i++) {
    hash = teamName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360}, 80%, 45%)`;
}

function getSoloColor(sport) {
  const map = {
    football: '#0a3d1f', cricket: '#0a2f3d', motorsport: '#3d0a0a',
    basketball: '#3d2205', hockey: '#0a2a4d', mma: '#2a0a33',
    boxing: '#3d0a1a', tennis: '#2e3d0a', golf: '#0a3320',
  };
  return map[String(sport).toLowerCase()] || '#1c1c28';
}

async function generatePoster(event) {
  const W = 1280, H = 720, CX = W / 2, CY = H / 2;
  
  // Use the league logo from schedule.json
  const rawLogoUrl = event.poster || ''; 
  
  // Proxy the image so it loads on GitHub/apps without ESPN blocking it
  const finalLogoUrl = rawLogoUrl 
    ? `https://images.weserv.nl/?url=${encodeURIComponent(rawLogoUrl)}` 
    : '';

  let bgMarkup = '';
  if (event.isSolo) {
    bgMarkup = `<rect width="${W}" height="${H}" fill="${getSoloColor(event.sport)}" />`;
  } else {
    bgMarkup = `
      <rect x="0" y="0" width="${CX}" height="${H}" fill="${getTeamColor(event.homeTeam, true)}" />
      <rect x="${CX}" y="0" width="${CX}" height="${H}" fill="${getTeamColor(event.awayTeam, false)}" />
    `;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<defs>` +
        // Halftone dots
        `<pattern id="ht" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="2.5" fill="#fff" /></pattern>` +
        // Fade out towards center
        `<radialGradient id="fade" cx="50%" cy="50%" r="70%"><stop offset="0%" stop-color="#000" stop-opacity="1"/><stop offset="60%" stop-color="#000" stop-opacity="0.5"/><stop offset="100%" stop-color="#000" stop-opacity="0"/></radialGradient>` +
        `<mask id="dotMask"><rect width="${W}" height="${H}" fill="url(#fade)" /></mask>` +
      `</defs>` +
      bgMarkup +
      `<rect width="${W}" height="${H}" fill="url(#ht)" mask="url(#dotMask)" opacity="0.35" />` +
      `<circle cx="${CX}" cy="${CY}" r="250" fill="url(#fade)" opacity="0.6" />` +
      // Link the image directly
      (finalLogoUrl ? `<image href="${finalLogoUrl}" x="${CX - 150}" y="${CY - 150}" width="300" height="300" preserveAspectRatio="xMidYMid meet" />` : '') +
    `</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

module.exports = { generatePoster };
