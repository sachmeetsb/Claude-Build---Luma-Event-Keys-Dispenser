import crypto from 'node:crypto';
import { roster as rosterStore } from './store.js';

const ACTOR = process.env.APIFY_ACTOR || 'forkoff~luma-get-attendees';
const HANDLE_FIELDS = [
  'username',
  'twitter_handle',
  'linkedin_handle',
  'instagram_handle',
  'tiktok_handle',
  'youtube_handle',
];

// ---------- normalization ----------

export function normName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
// Emails are never stored in clear: only a salted hash is kept for matching.
const hashEmail = (e) =>
  'e:' + crypto.createHash('sha256').update(`${process.env.LINK_SECRET || ''}|${e.trim().toLowerCase()}`).digest('base64url').slice(0, 24);

export function normHandle(s) {
  let h = String(s || '').trim().toLowerCase();
  if (!h) return '';
  if (isEmail(h)) return hashEmail(h);
  h = h.replace(/^https?:\/\/(www\.)?/, '');
  h = h.replace(
    /^(x\.com|twitter\.com|instagram\.com|tiktok\.com|youtube\.com|linkedin\.com\/in|linkedin\.com|lu\.ma\/user|luma\.com\/user|lu\.ma|luma\.com)\//,
    '',
  );
  h = h.replace(/^@/, '').replace(/\/.*$/, '').replace(/[?#].*$/, '');
  return h;
}

function attendeeId(a) {
  return a.api_id || a.user_api_id || a.username || `name:${normName(a.name)}`;
}

function handlesOf(a) {
  const set = new Set();
  for (const f of HANDLE_FIELDS) if (a[f]) set.add(normHandle(a[f]));
  if (a.email && isEmail(String(a.email).trim().toLowerCase())) set.add(hashEmail(a.email));
  return [...set].filter(Boolean);
}

function toAttendee(a) {
  const name = a.name || [a.first_name, a.last_name].filter(Boolean).join(' ');
  return {
    id: attendeeId(a),
    name,
    first_name: a.first_name || name.split(' ')[0] || null,
    last_name: a.last_name || null,
    username: a.username || null,
    avatar_url: a.avatar_url || null,
    has_email: Boolean(a.email),
    handles: handlesOf(a),
    _norm: normName(name),
  };
}

function saveRoster(attendees, { source, eventUrl }) {
  const data = {
    syncedAt: new Date().toISOString(),
    source,
    eventUrl: eventUrl || process.env.LUMA_EVENT_URL || null,
    count: attendees.length,
    attendees,
  };
  rosterStore.set(data);
  return data;
}

// ---------- Apify sync ----------

export async function fetchAttendeesFromApify({ token, lumaCookie, eventUrl }) {
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(
    token,
  )}&timeout=300&format=json&clean=true`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lumaCookie, eventUrl, limit: 100 }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify ${res.status}: ${text.slice(0, 500)}`);
  }
  const items = await res.json();
  if (!Array.isArray(items)) throw new Error('Apify returned non-array');
  return items;
}

export async function syncRoster() {
  const token = process.env.APIFY_TOKEN;
  const lumaCookie = process.env.LUMA_COOKIE;
  const eventUrl = process.env.LUMA_EVENT_URL;
  if (!token || !lumaCookie || !eventUrl) {
    throw new Error('APIFY_TOKEN, LUMA_COOKIE and LUMA_EVENT_URL are required');
  }
  const raw = await fetchAttendeesFromApify({ token, lumaCookie, eventUrl });
  const attendees = raw.filter((a) => a && (a.name || a.username)).map(toAttendee);
  return saveRoster(attendees, { source: 'apify', eventUrl });
}

// ---------- CSV import (Luma host "Guests" export, or any CSV with a name column) ----------

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const HEADER_ALIASES = {
  api_id: ['api_id', 'guest_api_id', 'user_api_id', 'id'],
  name: ['name', 'full_name', 'guest_name'],
  first_name: ['first_name', 'firstname', 'first'],
  last_name: ['last_name', 'lastname', 'last'],
  email: ['email', 'email_address', 'e-mail'],
  username: ['username', 'luma_username', 'luma'],
  twitter_handle: ['twitter_handle', 'twitter', 'x', 'x_handle', 'twitter_url'],
  linkedin_handle: ['linkedin_handle', 'linkedin', 'linkedin_url'],
  instagram_handle: ['instagram_handle', 'instagram', 'instagram_url'],
  tiktok_handle: ['tiktok_handle', 'tiktok'],
  youtube_handle: ['youtube_handle', 'youtube'],
  approval_status: ['approval_status', 'status', 'registration_status'],
};

export function importRosterFromCsv(text, { source = 'csv', onlyApproved = true } = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one guest');
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const col = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = header.findIndex((h) => aliases.includes(h));
    if (i >= 0) col[field] = i;
  }
  if (col.name === undefined && col.first_name === undefined) {
    throw new Error(`CSV must have a "name" (or first_name/last_name) column. Found: ${header.join(', ')}`);
  }
  let skipped = 0;
  const attendees = [];
  for (const r of rows.slice(1)) {
    const g = {};
    for (const [f, i] of Object.entries(col)) g[f] = (r[i] || '').trim();
    if (onlyApproved && g.approval_status && !/^(approved|going|checked[_ ]?in|yes)$/i.test(g.approval_status)) {
      skipped++;
      continue;
    }
    if (!g.name && !g.first_name) { skipped++; continue; }
    attendees.push(toAttendee(g));
  }
  const data = saveRoster(attendees, { source });
  return { ...data, skipped };
}

// ---------- matching ----------

function nameMatches(query, a) {
  if (!query) return false;
  if (a._norm === query) return true;
  const qa = query.split(' ').filter(Boolean);
  const na = a._norm.split(' ').filter(Boolean);
  if (qa.length < 2 || na.length < 2) return false;
  if (qa.length === na.length && qa.every((t) => na.includes(t))) return true; // order-insensitive
  return qa[0] === na[0] && qa.at(-1) === na.at(-1); // first + last, ignoring middles
}

/**
 * @returns {{status:'ok', attendee} | {status:'not_found'} | {status:'need_handle', candidates:number} | {status:'handle_mismatch'}}
 */
export function verifyAttendee({ name, handle }, policy = process.env.REQUIRE_HANDLE || 'when_available') {
  const { attendees } = rosterStore.get();
  const q = normName(name);
  const h = normHandle(handle);
  if (!q) return { status: 'not_found' };

  const byName = attendees.filter((a) => nameMatches(q, a));
  if (byName.length === 0) return { status: 'not_found' };

  const requireHandle = (a) =>
    policy === 'always' ? true : policy === 'never' ? false : a.handles.length > 0;

  if (h) {
    const hit = byName.find((a) => a.handles.includes(h));
    if (hit) return { status: 'ok', attendee: hit };
    if (byName.length === 1 && !requireHandle(byName[0])) return { status: 'ok', attendee: byName[0] };
    return { status: 'handle_mismatch' };
  }

  if (byName.length === 1 && !requireHandle(byName[0])) return { status: 'ok', attendee: byName[0] };
  return { status: 'need_handle', candidates: byName.length };
}

export function getAttendee(id) {
  return rosterStore.get().attendees.find((a) => a.id === id) || null;
}
