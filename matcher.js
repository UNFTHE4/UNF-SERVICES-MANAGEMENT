// ============================================================
// matcher.js — ESPN schedule + Sky + beIN AU + Airtel + XMLTV
// ============================================================
const fs    = require('fs');
const axios = require('axios');
const zlib  = require('zlib');
const dayjs = require('dayjs');
const utc   = require('dayjs/plugin/utc');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const { XMLParser } = require('fast-xml-parser');
dayjs.extend(utc);
dayjs.extend(customParseFormat);

const CHANNELS_FILE = 'assets/tv/channels.json';
const SCHEDULE_FILE = 'api/schedule.json';
const OUTPUT_FILE   = 'api/epg.json';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ─── helpers ───────────────────────────────────────────────

const norm = (s = '') =>
  String(s).toLowerCase()
    .replace(/\b(at|v|vs|versus|@|the|and)\b/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function teamsMatch(a, b) {
  const A = norm(a), B = norm(b);
  if (!A || !B) return false;
  const words = A.split(' ').filter(w => w.length > 2);
  if (!words.length) return false;
  let hits = 0;
  for (const w of words) if (B.includes(w)) hits++;
  return hits >= Math.ceil(words.length * 0.6);
}

function minutesDiff(a, b) { return Math.abs(a.diff(b, 'minute')); }

// ─── Sky ───────────────────────────────────────────────────

async function fetchSky(cfg, dates) {
  const out = [];
  if (!cfg || !cfg.channels) return out;
  const sids = Object.keys(cfg.channels);
  const territory = cfg.territory || 'GB';

  for (const dateStr of dates) {
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
            end: dayjs.unix(ev.st + (ev.d || 0))
          });
        }
      }
    } catch (e) { console.warn(`[warn] Sky ${dateStr}: ${e.message}`); }
  }
  return out;
}

// ─── beIN AU ───────────────────────────────────────────────

async function fetchBeinAU(cfg, dates) {
  const out = [];
  if (!cfg || !cfg.channels) return out;
  const ids = Object.keys(cfg.channels);

  for (const dateStr of dates) {
    const day = dayjs.utc(dateStr, 'YYYYMMDD');
    const qs = new URLSearchParams({
      startBefore: day.add(1, 'd').format('YYYY-MM-DDTHH:mm:ss.SSS') + 'Z',
      endAfter:    day.format('YYYY-MM-DDTHH:mm:ss.SSS') + 'Z',
      channelIds:  ids.join(',')
    });
    try {
      const { data } = await axios.get(
        `https://www.beinsports.com/api/opta/tv-event?${qs}`,
        { headers: { 'User-Agent': UA }, timeout: 20000 }
      );
      for (const row of (data.rows || [])) {
        const chId = row.channelId || row.channel_id || row.channel;
        const ourId = cfg.channels[String(chId)];
        if (!ourId || !row.title || !row.startDate) continue;
        out.push({
          channelId: String(ourId),
          title: row.title,
          start: dayjs.utc(row.startDate),
          end: row.endDate ? dayjs.utc(row.endDate) : dayjs.utc(row.startDate).add(2, 'hour')
        });
      }
    } catch (e) { console.warn(`[warn] beIN ${dateStr}: ${e.message}`); }
  }
  return out;
}

// ─── Airtel Xstream (India — replaces Tata Play) ───────────

async function fetchAirtel(cfg, dates) {
  const out = [];
  if (!cfg || !cfg.channels) return out;

  const HEADERS = {
    'User-Agent': UA,
    'Referer': 'https://www.airtelxstream.in/',
    'Origin': 'https://www.airtelxstream.in'
  };

  for (const dateStr of dates) {
    const day = dayjs.utc(dateStr, 'YYYYMMDD');
    const startTime = day.valueOf();
    const endTime = day.add(1, 'd').valueOf();

    for (const siteId of Object.keys(cfg.channels)) {
      const ourId = cfg.channels[siteId];
      const url = `https://epg.airtel.tv/app/v2/content/channel/epg?channelId=${encodeURIComponent(siteId)}&startTime=${startTime}&endTime=${endTime}`;

      try {
        const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
        const guide = data?.programGuide || {};
        const programs = guide[siteId] || Object.values(guide)[0] || [];

        for (const p of programs) {
          if (!p.title || !p.startTime) continue;
          out.push({
            channelId: String(ourId),
            title: p.title,
            start: dayjs(p.startTime),
            end: p.endTime ? dayjs(p.endTime) : dayjs(p.startTime).add(2, 'hour')
          });
        }
      } catch (e) {
        console.warn(`[warn] Airtel ${siteId}: ${e.message}`);
      }

      await new Promise(r => setTimeout(r, 120));
    }
  }
  console.log(`[info] Airtel → ${out.length} entries`);
  return out;
}

// ─── XMLTV (epgshare01) ────────────────────────────────────

function parseXmltvDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{14})\s*([+-]\d{4})?/);
  if (!m) return null;
  const base = dayjs.utc(m[1], 'YYYYMMDDHHmmss');
  if (!m[2]) return base;
  const sign = m[2][0] === '-' ? -1 : 1;
  const offMin = sign * (parseInt(m[2].slice(1, 3), 10) * 60 + parseInt(m[2].slice(3, 5), 10));
  return base.subtract(offMin, 'minute');
}

async function fetchXmltv(cfg) {
  const out = [];
  if (!cfg || !cfg.url || !cfg.channels) return out;

  let raw;
  try {
    const res = await axios.get(cfg.url, {
      responseType: 'arraybuffer',
      headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' },
      timeout: 60000
    });
    raw = res.data;
  } catch (e) { console.warn(`[warn] XMLTV fetch: ${e.message}`); return out; }

  let xml;
  try { xml = zlib.gunzipSync(Buffer.from(raw)).toString('utf8'); }
  catch { xml = Buffer.from(raw).toString('utf8'); }

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', textNodeName: '_text' });
  let doc;
  try { doc = parser.parse(xml); }
  catch (e) { console.warn(`[warn] XMLTV parse: ${e.message}`); return out; }

  const programmes = doc?.tv?.programme;
  if (!programmes) return out;
  const list = Array.isArray(programmes) ? programmes : [programmes];
  const wanted = new Set(Object.keys(cfg.channels));

  for (const p of list) {
    const ch = p.channel;
    if (!wanted.has(ch)) continue;
    const titleRaw = p.title;
    const title = Array.isArray(titleRaw)
      ? (titleRaw[0]?._text || titleRaw[0])
      : (titleRaw?._text || titleRaw);
    if (!title) continue;
    const start = parseXmltvDate(p.start);
    if (!start) continue;
    out.push({
      channelId: String(cfg.channels[ch]),
      title: String(title),
      start,
      end: parseXmltvDate(p.stop) || start.add(2, 'hour')
    });
  }
  console.log(`[info] XMLTV → ${out.length} entries`);
  return out;
}

// ─── matcher (sport check bug fixed) ───────────────────────

function matchEvent(event, epg, channelsMeta, leagueRules) {
  const kickoff = dayjs.utc(event.start_time_utc || event.start);
  const title   = event.name || event.title ||
    `${event.home_team || ''} at ${event.away_team || ''}`;

  const matched = new Map();
  for (const entry of epg) {
    if (minutesDiff(kickoff, entry.start) > 90) continue;
    if (!teamsMatch(title, entry.title)) continue;
    matched.set(entry.channelId, {
      id: entry.channelId,
      name: channelsMeta[entry.channelId]?.name || entry.channelId,
      source: 'epg'
    });
  }
  if (matched.size) return [...matched.values()];

  // fallback: check sport AND league
  const sport = (event.sport || '').toLowerCase();
  const league = (event.league || '').toLowerCase();

  for (const rule of leagueRules) {
    if (rule.sport && rule.sport.toLowerCase() !== sport) continue;
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

  const today    = dayjs.utc().format('YYYYMMDD');
  const tomorrow = dayjs.utc().add(1, 'd').format('YYYYMMDD');
  const dates    = [today, tomorrow];

  console.log(`[info] EPG dates: ${dates.join(', ')}`);

  const skyEpg   = await fetchSky(cfg.broadcasters?.sky, dates);
  console.log(`[info] Sky → ${skyEpg.length} entries`);

  const beinEpg  = await fetchBeinAU(cfg.broadcasters?.bein_au, dates);
  console.log(`[info] beIN AU → ${beinEpg.length} entries`);

  const airtelEpg = await fetchAirtel(cfg.broadcasters?.airtel, dates);

  const xmltvEpg = await fetchXmltv(cfg.broadcasters?.india_xmltv);

  const epg = [...skyEpg, ...beinEpg, ...airtelEpg, ...xmltvEpg];
  console.log(`[info] total EPG entries: ${epg.length}`);

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

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
    generated: new Date().toISOString(),
    count: matches.length,
    confirmed,
    matches
  }, null, 2));

  console.log(`[done] ${OUTPUT_FILE} — ${matches.length} matches, ${confirmed} confirmed`);
}

main().catch(e => { console.error(e); process.exit(1); });
