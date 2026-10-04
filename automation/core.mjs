import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

export const VERSION = 1;
export const PRESETS = Object.freeze({
  daily: { hours: 30, de: 'letzte 24 Stunden', en: 'Last 24 hours', cadence: 'daily' },
  twoDay: { hours: 55, de: 'letzte 48 Stunden', en: 'Last 48 hours', cadence: '48h' },
  weekly: { hours: 192, de: 'letzte 7 Tage', en: 'Last 7 days', cadence: 'weekly' }
});
export const MODEL_PROFILES = Object.freeze({
  'gpt-6.1-sol': { effort: 'medium', version: 'sol-1', instruction: 'Complete the bounded research task autonomously. Follow the explicit checklist, resolve duplicates, and produce concise evidence-led analysis. Do not ask follow-up questions; record missing evidence as a limitation.' },
  'gpt-6-astra': { effort: 'high', version: 'astra-1', instruction: 'Independently cross-check conflicting evidence and synthesise developments across the whole window. Prioritise corroborated patterns, changes and uncertainties. Stop when the bounded coverage contract is satisfied; do not expand the mission or invent missing evidence.' }
});
export const TOPICS = Object.freeze({
  hybrid: 'Maritime hybrid interference, sabotage, drones, espionage and influence',
  shadow: 'Shadow fleet, sanctions evasion and maritime dual-use supply chains',
  drugs: 'Maritime narcotics smuggling and port organised crime',
  iuu: 'Illegal, unreported and unregulated fishing',
  cyber: 'Maritime IT/OT cyber incidents and critical infrastructure; check relevant cyber authorities',
  safety: 'Maritime safety, accidents, environmental incidents and navigational disruptions',
  economic: 'Russia/China economic security, espionage, influence and maritime supply chains; check BAFA and BfV where relevant',
  ukmto: 'Check UKMTO maritime warnings and advisories',
  authorities: 'Check German Marineschifffahrtleitung and relevant maritime shipping authorities',
  maritimeExecutive: 'Check The Maritime Executive maritime reporting',
  gcaptain: 'Check gCaptain maritime reporting',
  vesseltracker: 'Check Vesseltracker maritime reporting'
});
export const hash = text => createHash('sha256').update(Buffer.isBuffer(text) ? text : String(text)).digest('hex');
export const iso = value => {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/);
    if (!match || new Date(match[1]).toISOString().slice(0, 10) !== match[1]) throw new Error('Explicit valid timezone timestamp required: ' + value);
  }
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) throw new Error('Invalid UTC timestamp: ' + value);
  return d.toISOString();
};
export function canonicalURL(value) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Invalid source URL');
  if (/magic[-_]?paws/i.test(u.hostname + u.pathname)) throw new Error('MagicPaws access is disabled');
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
  return u.href;
}
export function defaultConfig(now = new Date()) {
  const anchor = localDate(now, 'Europe/Berlin');
  const region = 'Nordsee, Ostsee, Ärmelkanal, Atlantikzugänge, Mittelmeer, Schwarzmeerraum, globale maritime Brennpunkte';
  return { version: VERSION, mode: 'manual', profiles: Object.entries(PRESETS).map(([preset, spec]) => ({
    id: preset, name: spec.de, enabled: false, preset, language: 'both', model: 'gpt-6.1-sol',
    region, audience: 'OSINT-Analyst', mapMode: 'auto', topics: Object.keys(TOPICS), recipients: [],
    schedule: { cadence: spec.cadence, timezone: 'Europe/Berlin', time: '07:00', anchorDate: anchor }
  })) };
}
export function validateConfig(config) {
  if (config?.version !== VERSION || !['manual', 'review', 'automatic'].includes(config.mode)) throw new Error('Invalid automation configuration');
  if (!Array.isArray(config.profiles) || config.profiles.length > 30) throw new Error('Expected at most 30 output profiles');
  const ids = new Set();
  for (const p of config.profiles) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(p.id) || ids.has(p.id)) throw new Error('Invalid or duplicate profile id');
    ids.add(p.id);
    if (typeof p.enabled !== 'boolean' || !PRESETS[p.preset] || !MODEL_PROFILES[p.model]) throw new Error('Unsupported preset/model');
    if (!['de', 'en', 'both'].includes(p.language) || !['auto', 'world', 'europe'].includes(p.mapMode)) throw new Error('Invalid report language/map scope');
    if (!['OSINT-Analyst', 'Behördenlage / LvU-tauglich'].includes(p.audience)) throw new Error('Invalid report audience');
    if (typeof p.region !== 'string' || !p.region.trim() || p.region.length > 2000 || typeof p.name !== 'string' || !p.name.trim()) throw new Error('Name and region are required');
    if (!Array.isArray(p.topics) || !p.topics.length || p.topics.some(t => !TOPICS[t]) || new Set(p.topics).size !== p.topics.length) throw new Error('Invalid research topics');
    if (!Array.isArray(p.recipients) || p.recipients.length > 100 || p.recipients.some(r => typeof r !== 'string' || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(r))) throw new Error('Invalid distribution list');
    if (new Set(p.recipients.map(r => r.toLowerCase())).size !== p.recipients.length) throw new Error('Duplicate recipients');
    if (config.mode === 'automatic' && p.enabled && !p.recipients.length) throw new Error('Active automatic profiles require a distribution list');
    const s = p.schedule;
    if (!s || !['daily', '48h', 'weekly'].includes(s.cadence) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) || !/^\d{4}-\d{2}-\d{2}$/.test(s.anchorDate)) throw new Error('Invalid schedule');
    if (new Date(s.anchorDate).toISOString().slice(0, 10) !== s.anchorDate) throw new Error('Invalid anchor date');
    new Intl.DateTimeFormat('en', { timeZone: s.timezone }).format(new Date());
    zonedTime(s.anchorDate, s.time, s.timezone);
  }
  return structuredClone(config);
}
export function localDate(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const get = key => parts.find(p => p.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function localParts(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const get = key => Number(parts.find(p => p.type === key).value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}
export function zonedTime(date, time, timezone) {
  const target = Date.parse(`${date}T${time}:00Z`);
  let value = target;
  for (let i = 0; i < 5; i++) value += target - localParts(value, timezone);
  if (localParts(value, timezone) !== target) throw new Error('Schedule time does not exist in timezone (DST); choose another time');
  return iso(value);
}
export function scheduledEnd(profile, now = new Date()) {
  const s = profile.schedule, anchor = Date.parse(zonedTime(s.anchorDate, s.time, s.timezone)), instant = new Date(now).getTime();
  if (instant < anchor) return null;
  if (s.cadence === '48h') return iso(anchor + Math.floor((instant - anchor) / (48 * 36e5)) * 48 * 36e5);
  const step = s.cadence === 'weekly' ? 7 : 1, day = 864e5;
  const days = Math.floor((Date.parse(localDate(now, s.timezone)) - Date.parse(s.anchorDate)) / day);
  let date = iso(Date.parse(s.anchorDate) + Math.floor(days / step) * step * day).slice(0, 10);
  let end = zonedTime(date, s.time, s.timezone);
  if (Date.parse(end) > instant) {
    date = iso(Date.parse(date) - step * day).slice(0, 10);
    end = zonedTime(date, s.time, s.timezone);
  }
  return Date.parse(end) < anchor ? null : end;
}
export function windowFor(profile, end) {
  const endUTC = iso(end);
  return { start: iso(Date.parse(endUTC) - PRESETS[profile.preset].hours * 36e5), end: endUTC, hours: PRESETS[profile.preset].hours, label: PRESETS[profile.preset].de, label_en: PRESETS[profile.preset].en };
}
export const runId = (profile, end) => profile.id + '-' + iso(end).replace(/[-:.]/g, '');
export const scopeKey = profile => hash(profile.region.trim().toLowerCase());

export function uncoveredIntervals(start, end, covered) {
  let cursor = Date.parse(start), stop = Date.parse(end), out = [];
  const intervals = covered.map(c => [Date.parse(c.start), Date.parse(c.end)]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && a < b).sort((a, b) => a[0] - b[0]);
  for (const [a, b] of intervals) {
    if (b <= cursor || a >= stop) continue;
    if (a > cursor) out.push({ start: iso(cursor), end: iso(Math.min(a, stop)) });
    cursor = Math.max(cursor, b);
    if (cursor >= stop) break;
  }
  if (cursor < stop) out.push({ start: iso(cursor), end: iso(stop) });
  return out;
}
export function planResearch(profile, window, coverage = [], sources = [], previousReports = []) {
  const scope = scopeKey(profile), jobs = new Map();
  for (const topic of profile.topics) {
    const completed = coverage.filter(c => c.status === 'complete' && c.scope === scope && c.topics.includes(topic));
    for (const gap of uncoveredIntervals(window.start, window.end, completed)) {
      const key = gap.start + '/' + gap.end;
      if (!jobs.has(key)) jobs.set(key, { ...gap, topics: [], scope });
      jobs.get(key).topics.push(topic);
    }
  }
  const start = Date.parse(window.start), end = Date.parse(window.end);
  const relevant = sources.filter(s => {
    const t = Date.parse(s.event_at || s.published_at);
    return s.status === 'verified' && t > start && t <= end && (s.scope === scope || s.kind === 'import') && s.topics.some(t => profile.topics.includes(t));
  });
  return { window, scope, jobs: [...jobs.values()], sources: dedupeSources(relevant), candidates: sources.filter(s => s.kind === 'import' && s.status === 'pending' && s.topics.some(t => profile.topics.includes(t))), previous_reports: previousReports.filter(r => r.scope === scope && Date.parse(r.window.end) >= start && Date.parse(r.window.start) <= end).map(r => ({ id: r.id, window: r.window, source_ids: r.source_ids })) };
}
export function dedupeSources(sources) {
  const seen = new Set();
  return sources.filter(s => { const key = canonicalURL(s.source_url) + ':' + hash(s.body); if (seen.has(key)) return false; seen.add(key); return true; });
}

// YAML front matter uses JSON values (a subset of YAML). Full report JSON stays in
// an explicitly marked block, so round trips retain all analytical and geo fields.
export function markdownDocument(meta, body = '', data) {
  const front = Object.entries(meta).map(([k, v]) => {
    if (!/^[a-z_]+$/.test(k)) throw new Error('Invalid metadata key');
    return `${k}: ${JSON.stringify(v)}`;
  }).join('\n');
  return `---\n${front}\n---\n\n${body.trim()}\n` + (data === undefined ? '' : '\n<!-- honkytonk:data -->\n~~~json\n' + JSON.stringify(data, null, 2) + '\n~~~\n');
}
export function parseDocument(text) {
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error('Markdown front matter is required');
  const meta = {};
  for (const line of match[1].split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'))) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!m || Object.hasOwn(meta, m[1]) || ['__proto__', 'constructor', 'prototype'].includes(m[1])) throw new Error('Invalid Markdown metadata');
    try { meta[m[1]] = JSON.parse(m[2]); } catch { meta[m[1]] = m[2]; }
  }
  const remaining = text.slice(match[0].length);
  const marker = remaining.lastIndexOf('<!-- honkytonk:data -->');
  if (marker < 0) return { meta, body: remaining.trim(), data: undefined };
  const block = remaining.slice(marker).match(/^<!-- honkytonk:data -->\s*~~~json\s*\n([\s\S]*?)\n~~~\s*$/);
  if (!block) throw new Error('Invalid Markdown data block');
  return { meta, body: remaining.slice(0, marker).trim(), data: JSON.parse(block[1]) };
}
export function sourceDocument(source) {
  const { body, ...meta } = source;
  return markdownDocument({ ...meta, content_hash: hash(body.trim()) }, body);
}
export function readSource(text) {
  const { meta, body } = parseDocument(text);
  if (!body || !meta.id || !['import', 'web'].includes(meta.kind) || !Array.isArray(meta.topics)) throw new Error('Invalid source Markdown');
  canonicalURL(meta.source_url);
  if (meta.content_hash && meta.content_hash !== hash(body)) throw new Error('Source content hash mismatch');
  if (meta.published_at) iso(meta.published_at);
  if (meta.event_at) iso(meta.event_at);
  return { ...meta, body };
}
