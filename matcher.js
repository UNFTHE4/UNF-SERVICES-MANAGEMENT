// ============================================================
// matcher.js — ESPN schedule  +  Sky/beIN EPG  →  real channels
// ============================================================
const fs    = require('fs');
const axios = require('axios');
const dayjs = require('dayjs');
const utc   = require('dayjs/plugin/utc');
dayjs.extend(utc);

const CHANNELS_FILE = 'assets/tv/channels.json';
const SCHEDULE_FILE = 'api/schedule.json';
const OUTPUT_FILE   = 'api/epg.json';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ─── helpers ───────────────────────────────────────────────

const norm = (s = '') =>
  String(s)
    .toLowerCase()
    .replace(/\b(at|v|vs|versus|@|the)\b/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function teamsMatch(espnTitle, epgTitle) {
  const a = norm(espnTitle);
  const b = norm(epgTitle);
  if (!a || !b) return false;
  const words = a.split(' ').filter(w => w.length > 2);
  if (!words.length) return false;
  let hits = 0;
  for (const w of words) if (b.includes(w)) hits++;
  return hits >= Math.ceil(words.length * 0.6); // 60% word overlap
}

function minutesDiff(a, b) {
  return Math.abs(a.diff(b, 'minute'));
}

// ─── Sky fetcher ───────────────────────────────────────────

async function fetchSky(cfg, dates) {
  const out = [];
  if (!cfg || !cfg.channels) return out;

  const sids = Object.keys(cfg.channels);         // e.g. ["4002","4010",...]
  const territory = cfg.territory || 'GB';

  for (const dateStr of dates) {                   // "20261107"
    const url = `https://awk.epgsky.com/hawk/linear/schedule/${dateStr}/${sids.join(',')}`;
    try {
      const { data } = await axios.get(url, {
        headers: { 'X-SkyOTT-Territory': territory },
        timeout: 20000
      });

      for (const sched of (data.schedule || [])) {
        const ourId = cfg.channels[String(sched.sid)];
        if (!ourId) continue;
        for (const ev of (sched.events || [])) {
          if (!ev.t || !ev.st) continue;
          out.push({
            channelId: String(ourId),
            title: ev.t,
            start: dayjs.unix(ev.st),
            end:   dayjs.unix(ev.st + (ev.d || 0))
          });
        }
      }
    } catch (e) {
      console.warn(`[warn] Sky ${dateStr}: ${e.message}`);
    }
  }
  return out;
}

// ─── beIN AU fetcher ───────────────────────────────────────

async function fetchBeinAU(cfg, dates) {
  const out = [];
  if (!cfg || !cfg.channels) return out;

  const ids = Object.keys(cfg.channels);           // UUIDs

  for (const dateStr of dates) {
    const day = dayjs.utc(dateStr, 'YYYYMMDD');
    const qs = new URLSearchParams({
      startBefore: day.add(1, 'd').format('YYYY-MM-DDTHH:mm:ss.SSS') + 'Z',
      endAfter:    day.format('YYYY-MM-DDTHH:mm:ss.SSS') + 'Z',
      channelIds:  ids.join(',')
    });
    const url = `https://www.beinsports.com/api/opta/tv-event?${qs}`;
    try {
      const { data } = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 20000 });
      for (const row of (data.rows || [])) {
        // Row may include a channel id field — try common names
        const chId = row.channelId || row.channel_id || row.channel;
        const ourId = cfg.channels[String(chId)];
        if (!ourId) continue;
        if (!row.title || !row.startDate) continue;
        out.push({
          channelId: String(ourId),
          title: row.title,
          start: dayjs.utc(row.startDate),
          end:   row.endDate ? dayjs.utc(row.endDate) : dayjs.utc(row.startDate).add(2, 'hour')
        });
      }
    } catch (e) {
      console.warn(`[warn] beIN ${dateStr}: ${e.message}`);
    }
  }
  return out;
}

// ─── match one event against EPG index ─────────────────────

function matchEvent(event, epg, channelsMeta, leagueRules) {
  const kickoff = dayjs.utc(event.start_time_utc || event.start);
  const title   = event.name || event.title ||
    `${event.home_team || ''} at ${event.away_team || ''}`;

  // 1) Try EPG exact match
  const matched = new Map();
  for (const entry of epg) {
    const dMin = minutesDiff(kickoff, entry.start);
    if (dMin > 90) continue;                       // ±90min window
    if (!teamsMatch(title, entry.title)) continue;
    matched.set(entry.channelId, {
      id: entry.channelId,
      name: channelsMeta[entry.channelId]?.name || entry.channelId,
      source: 'epg'
    });
  }
  if (matched.size) return [...matched.values()];

  // 2) Fall back to league rules
  const league = (event.league || '').toLowerCase();
  for (const rule of leagueRules) {
    if (rule.league && !league.includes(rule.league.toLowerCase())) continue;
    const hit = (rule.channels || []).map(id => ({
      id: String(id),
      name: channelsMeta[String(id)]?.name || String(id),
      source: 'guess'
    }));
    if (hit.length) return hit;
  }
  return [];
}

// ─── main ──────────────────────────────────────────────────

async function main() {
  const cfg      = JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf8'));
  const schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));

  const events = Array.isArray(schedule) ? schedule : (schedule.events || []);

  // Dates to fetch — today and tomorrow in UTC
  const today    = dayjs.utc().format('YYYYMMDD');
  const tomorrow = dayjs.utc().add(1, 'd').format('YYYYMMDD');
  const dates    = [today, tomorrow];

  console.log(`[info] fetching EPG for ${dates.join(', ')}`);

  const epg = [
    ...await fetchSky(cfg.broadcasters?.sky, dates),
    ...await fetchBeinAU(cfg.broadcasters?.bein_au, dates)
  ];
  console.log(`[info] got ${epg.length} EPG entries`);

  const channelsMeta = cfg.channels || {};
  const leagueRules  = cfg.rules    || [];

  const matches = events.map(ev => ({
    sport:       ev.sport,
    league:      ev.league,
    league_logo: ev.league_logo,
    title:       ev.name || ev.title ||
                 `${ev.home_team || ''} vs ${ev.away_team || ''}`,
    home_team:   ev.home_team,
    away_team:   ev.away_team,
    home_logo:   ev.home_logo,
    away_logo:   ev.away_logo,
    venue:       ev.venue,
    start:       ev.start_time_utc || ev.start,
    channels:    matchEvent(ev, epg, channelsMeta, leagueRules)
  }));

  const confirmed = matches.filter(m => m.channels.some(c => c.source === 'epg')).length;

  const out = {
    generated: new Date().toISOString(),
    count: matches.length,
    confirmed,
    matches
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 2));
  console.log(`[done] ${OUTPUT_FILE} — ${matches.length} matches, ${confirmed} with confirmed channel`);
}

main().catch(e => { console.error(e); process.exit(1); });
