// POSTA/generatePoster.js — Node 18+
'use strict';

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
           .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

async function fetchLogoAsBase64(url, timeoutMs = 10000) {
  if (!url) return null;
  let target = url.startsWith('http://') ? 'https://' + url.slice(7) : url;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; PosterBot/1.0)' },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = (res.headers.get('content-type') || '').split(';')[0] || 'image/png';
    return `data:${ct};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Generates a vibrant, deterministic color based on the team name
function getTeamColor(teamName, isHome) {
  if (!teamName) return isHome ? '#111' : '#222';
  let hash = 0;
  for (let i = 0; i < teamName.length; i++) {
    hash = teamName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  const s = 75 + (Math.abs(hash) % 20); // 75-95% saturation
  const l = 40 + (Math.abs(hash) % 15); // 40-55% lightness
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// Base color for solo events
function getSoloColor(sport) {
  const map = {
    football: '#0a3d1f', cricket: '#0a2f3d', motorsport: '#3d0a0a',
    basketball: '#3d2205', hockey: '#0a2a4d', mma: '#2a0a33',
    boxing: '#3d0a1a', tennis: '#2e3d0a', golf: '#0a3320',
  };
  return map[String(sport).toLowerCase()] || '#1c1c28';
}

const HALFTONE_DEFS = `
  <pattern id="ht" width="8" height="8" patternUnits="userSpaceOnUse">
    <circle cx="4" cy="4" r="2.5" fill="#ffffff" />
  </pattern>
  <radialGradient id="fade" cx="50%" cy="50%" r="70%">
    <stop offset="0%"   stop-color="#000" stop-opacity="1" />
    <stop offset="60%"  stop-color="#000" stop-opacity="0.5" />
    <stop offset="100%" stop-color="#000" stop-opacity="0" />
  </radialGradient>
  <mask id="dotMask">
    <rect width="1280" height="720" fill="url(#fade)" />
  </mask>
`;

async function generatePoster(event) {
  const W = 1280, H = 720, CX = W / 2, CY = H / 2;
  
  // Use the league/sport logo
  const logoUrl = event.poster || event.sportIcon; 
  const logoHref = await fetchLogoAsBase64(logoUrl);

  // 1. Build Background
  let bgMarkup = '';
  if (event.isSolo) {
    const color = getSoloColor(event.sport);
    bgMarkup = `<rect width="${W}" height="${H}" fill="${color}" />`;
  } else {
    const leftColor = getTeamColor(event.homeTeam, true);
    const rightColor = getTeamColor(event.awayTeam, false);
    bgMarkup = `
      <rect x="0" y="0" width="${CX}" height="${H}" fill="${leftColor}" />
      <rect x="${CX}" y="0" width="${CX}" height="${H}" fill="${rightColor}" />
      <line x1="${CX}" y1="0" x2="${CX}" y2="${H}" stroke="#000" stroke-opacity="0.2" stroke-width="4" />
    `;
  }

  // 2. Build SVG
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<defs>${HALFTONE_DEFS}</defs>` +
      bgMarkup +
      // Halftone dots fading from edges to center
      `<rect width="${W}" height="${H}" fill="url(#ht)" mask="url(#dotMask)" opacity="0.35" />` +
      // Dark vignette right behind the logo to ensure contrast
      `<circle cx="${CX}" cy="${CY}" r="250" fill="url(#fade)" opacity="0.6" />` +
      // Central Logo (Contained, never stretched)
      (logoHref ? `
        <image href="${logoHref}" 
               x="${CX - 140}" y="${CY - 140}" 
               width="280" height="280" 
               preserveAspectRatio="xMidYMid meet" />` : '') +
    `</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

module.exports = { generatePoster };
