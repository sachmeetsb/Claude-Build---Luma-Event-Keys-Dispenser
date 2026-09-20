import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

import { roster as rosterStore, claims as claimStore, DATA_DIR } from './lib/store.js';
import multer from 'multer';
import { syncRoster, importRosterFromCsv, verifyAttendee, getAttendee } from './lib/roster.js';
import { issue, verify as verifyToken, newSid } from './lib/tokens.js';
import { homePage, claimPage, errorPage, adminPage } from './views/pages.js';

const PORT = Number(process.env.PORT || 3000);
const PROMO_URL = process.env.PROMO_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;
const SYNC_INTERVAL_MIN = Number(process.env.SYNC_INTERVAL_MIN || 10);
const RECLAIM_GRACE_SEC = Number(process.env.RECLAIM_GRACE_SEC || 180);
const WIFI = { ssid: process.env.WIFI_SSID, password: process.env.WIFI_PASSWORD };
const ASSETS = path.resolve(process.env.ASSETS_DIR || 'assets');

if (!PROMO_URL) throw new Error('PROMO_URL is required');
if (!ADMIN_KEY || ADMIN_KEY.length < 12) throw new Error('ADMIN_KEY is required (>=12 chars)');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// security-ish headers everywhere; never cache anything
app.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  next();
});

// ---------- tiny helpers ----------

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function ensureSid(req, res) {
  let sid = cookies(req).sid;
  if (!sid || sid.length < 20) {
    sid = newSid();
    res.cookie('sid', sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      maxAge: 12 * 3600 * 1000,
      path: '/',
    });
  }
  return sid;
}

// per-IP sliding window rate limiter (in-memory; fine for a single-instance event app)
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${req.path}:${req.ip}`;
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).send(errorPage('ratelimited'));
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t > windowMs)) hits.delete(k);
    next();
  };
}

const isAdmin = (req) => {
  const k = String(req.query.key || req.body?.key || '');
  return (
    k.length === ADMIN_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ADMIN_KEY))
  );
};

// ---------- public routes ----------

app.get('/health', (_req, res) => res.json({ ok: true, roster: rosterStore.get().attendees.length }));

app.get('/wifi.png', (_req, res) => {
  const f = [path.join(DATA_DIR, 'wifi.png'), path.join(ASSETS, 'wifi.png'), path.join(ASSETS, 'wifi.placeholder.png')].find((p) => fs.existsSync(p));
  if (!f) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=3600').sendFile(f);
});

app.get('/', (req, res) => {
  ensureSid(req, res);
  res.send(homePage({ error: req.query.e }));
});

app.post('/verify', rateLimit(15, 10 * 60 * 1000), (req, res) => {
  const sid = ensureSid(req, res);
  const name = String(req.body.name || '').slice(0, 120);
  const handle = String(req.body.handle || '').slice(0, 120);

  if (rosterStore.get().attendees.length === 0) return res.status(503).send(homePage({ error: 'roster_empty', values: { name, handle } }));

  const r = verifyAttendee({ name, handle });
  if (r.status !== 'ok') {
    console.log(`[verify] ${r.status} name="${name}" handle="${handle}" ip=${req.ip}`);
    return res.status(r.status === 'need_handle' ? 200 : 404).send(
      homePage({ error: r.status, values: { name, handle }, needHandle: r.status !== 'not_found' }),
    );
  }

  console.log(`[verify] ok id=${r.attendee.id} name="${r.attendee.name}" ip=${req.ip}`);
  const token = issue({ id: r.attendee.id, sid });
  res.redirect(303, `/a/${token}`);
});

app.get('/a/:token', (req, res) => {
  const sid = cookies(req).sid;
  const t = verifyToken(req.params.token, sid);
  if (!t) return res.status(400).send(errorPage('bad_token'));
  if (t.sidMismatch) return res.status(403).send(errorPage('sid_mismatch'));
  const attendee = getAttendee(t.id);
  if (!attendee) return res.status(400).send(errorPage('bad_token'));
  const claimed = claimStore.get()[t.id] || null;
  res.send(claimPage({ attendee, token: req.params.token, wifi: WIFI, claimed }));
});

// POST-only so link previewers / prefetchers can't burn the claim.
app.post('/go/:token', rateLimit(10, 60 * 1000), (req, res) => {
  const sid = cookies(req).sid;
  const t = verifyToken(req.params.token, sid);
  if (!t) return res.status(400).send(errorPage('bad_token'));
  if (t.sidMismatch) return res.status(403).send(errorPage('sid_mismatch'));
  const attendee = getAttendee(t.id);
  if (!attendee) return res.status(400).send(errorPage('bad_token'));

  const existing = claimStore.get()[t.id];
  if (existing) {
    const ageSec = (Date.now() - new Date(existing.at).getTime()) / 1000;
    const sameDevice = existing.sid === sid;
    if (!(sameDevice && ageSec < RECLAIM_GRACE_SEC)) {
      console.log(`[claim] blocked (already) id=${t.id} ip=${req.ip}`);
      return res.status(409).send(errorPage('already_claimed', { retryHref: `/a/${req.params.token}` }));
    }
    console.log(`[claim] regrant within grace id=${t.id}`);
  } else {
    claimStore.add(t.id, { name: attendee.name, ip: req.ip, ua: req.headers['user-agent'] || '', sid });
    console.log(`[claim] granted id=${t.id} name="${attendee.name}" ip=${req.ip}`);
  }
  res.redirect(303, PROMO_URL);
});

// ---------- admin ----------

app.use('/admin', rateLimit(60, 10 * 60 * 1000), (req, res, next) => {
  if (!isAdmin(req)) return res.status(404).end();
  next();
});

app.get('/admin', (req, res) => {
  res.send(
    adminPage({
      key: req.query.key,
      roster: rosterStore.get(),
      claims: claimStore.get(),
      message: req.query.m,
      error: req.query.err,
    }),
  );
});

app.post('/admin/sync', async (req, res) => {
  try {
    const r = await syncRoster();
    res.redirect(303, `/admin?key=${encodeURIComponent(req.query.key)}&m=${encodeURIComponent(`Synced ${r.count} attendees`)}`);
  } catch (e) {
    res.redirect(303, `/admin?key=${encodeURIComponent(req.query.key)}&err=${encodeURIComponent(e.message)}`);
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
app.post('/admin/import', upload.single('csv'), (req, res) => {
  const key = encodeURIComponent(req.query.key);
  try {
    if (!req.file) throw new Error('No CSV file received');
    const r = importRosterFromCsv(req.file.buffer.toString('utf8'), { onlyApproved: req.body.only_approved === '1' });
    res.redirect(303, `/admin?key=${key}&m=${encodeURIComponent(`Imported ${r.count} attendees from CSV (${r.skipped} skipped)`)}`);
  } catch (e) {
    res.redirect(303, `/admin?key=${key}&err=${encodeURIComponent(e.message)}`);
  }
});

// Upload the Wi-Fi QR image (kept on the data volume, never in git)
app.post('/admin/wifi', upload.single('wifi'), (req, res) => {
  const key = encodeURIComponent(req.query.key);
  if (!req.file || !/^image\/png$/.test(req.file.mimetype)) return res.redirect(303, `/admin?key=${key}&err=Upload+a+PNG`);
  fs.writeFileSync(path.join(DATA_DIR, 'wifi.png'), req.file.buffer);
  res.redirect(303, `/admin?key=${key}&m=Wi-Fi+QR+updated`);
});

app.post('/admin/reset', (req, res) => {
  claimStore.remove(String(req.body.id || ''));
  res.redirect(303, `/admin?key=${encodeURIComponent(req.query.key)}&m=Claim+reset`);
});

app.get('/admin/claims.csv', (req, res) => {
  const rows = [['claimed_at', 'name', 'attendee_id', 'ip', 'user_agent']];
  for (const [id, c] of Object.entries(claimStore.get())) rows.push([c.at, c.name, id, c.ip, c.ua]);
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  res.set('Content-Type', 'text/csv').attachment('claims.csv').send(csv);
});

app.use((_req, res) => res.status(404).send(errorPage('Page not found')));

// ---------- boot ----------

async function boot() {
  let current = rosterStore.get();
  console.log(`[boot] data dir ${DATA_DIR}; roster has ${current.attendees.length} attendees (source: ${current.source || 'none'})`);

  // Seed from a CSV file if the roster is empty (e.g. first boot, or a Luma host export mounted into the container)
  if (current.attendees.length === 0 && process.env.ROSTER_CSV && fs.existsSync(process.env.ROSTER_CSV)) {
    try {
      const r = importRosterFromCsv(fs.readFileSync(process.env.ROSTER_CSV, 'utf8'));
      console.log(`[boot] seeded ${r.count} attendees from ${process.env.ROSTER_CSV}`);
      current = rosterStore.get();
    } catch (e) {
      console.error(`[boot] CSV seed failed: ${e.message}`);
    }
  }

  const canSync = process.env.APIFY_TOKEN && process.env.LUMA_COOKIE && process.env.LUMA_EVENT_URL;

  const doSync = async (why) => {
    if (why === 'interval' && rosterStore.get().source === 'csv') return; // don't clobber a hand-imported roster
    try {
      const r = await syncRoster();
      console.log(`[sync] ${why}: ${r.count} attendees`);
    } catch (e) {
      console.error(`[sync] ${why} failed: ${e.message}`);
    }
  };

  app.listen(PORT, () => console.log(`[boot] listening on :${PORT}`));

  if (canSync) {
    if (current.attendees.length === 0 || process.env.SYNC_ON_BOOT === '1') await doSync('boot');
    if (SYNC_INTERVAL_MIN > 0) setInterval(() => doSync('interval'), SYNC_INTERVAL_MIN * 60 * 1000).unref();
  } else {
    console.warn('[boot] APIFY_TOKEN / LUMA_COOKIE / LUMA_EVENT_URL missing — roster sync disabled');
  }
}

boot();
