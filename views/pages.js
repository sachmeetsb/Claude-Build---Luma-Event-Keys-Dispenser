import { layout, esc } from './layout.js';

const EVENT_NAME = process.env.EVENT_NAME || 'Claude Code Build Day';
const LUMA_EVENT_URL = process.env.LUMA_EVENT_URL || 'https://luma.com';

const ERRORS = {
  not_found:
    "We couldn't find that name on the approved guest list. Use your name exactly as it appears on your Luma profile. If you registered recently, your approval may not have synced yet — try again in a few minutes.",
  need_handle:
    'Please also enter the email you registered with, your Luma username, or a social handle (X / LinkedIn / Instagram) from your Luma profile so we can confirm it is you.',
  handle_mismatch:
    "That email / username / handle doesn't match your Luma registration. Double-check and try again.",
  ratelimited: 'Too many attempts. Please wait a few minutes and try again.',
  roster_empty: 'The guest list has not been loaded yet. Please ask the organiser.',
  bad_token: 'This link is invalid or has expired. Please verify again.',
  sid_mismatch:
    'This link is personal to the device that verified. Please verify yourself on this device to get your own link.',
  already_claimed: 'Your credits link has already been opened once. Each attendee can claim once.',
};

export function homePage({ error, values = {}, needHandle = false } = {}) {
  const body = `
  <h1>${esc(EVENT_NAME)}</h1>
  <p class="sub">Verify your Luma registration to get Wi-Fi access and your API credits.</p>
  <div class="card">
    ${error ? `<div class="msg err">${esc(ERRORS[error] || error)}</div>` : ''}
    <form method="post" action="/verify" autocomplete="off">
      <label for="name">Your name (as on Luma)</label>
      <input id="name" name="name" required maxlength="120" value="${esc(values.name)}" placeholder="e.g. Priya Sharma">
      <label for="handle">Email you registered with, Luma username, or social handle ${needHandle ? '' : '<span class="small">(if asked)</span>'}</label>
      <input id="handle" name="handle" maxlength="120" value="${esc(values.handle)}" placeholder="you@example.com or @yourhandle" ${needHandle ? 'required autofocus' : ''}>
      <button type="submit">Verify registration</button>
    </form>
    <p class="small" style="margin-top:16px">Only approved registrants of <a href="${esc(LUMA_EVENT_URL)}" style="color:var(--accent)">this Luma event</a> can claim. One claim per attendee.</p>
  </div>`;
  return layout('Verify', body);
}

export function claimPage({ attendee, token, wifi, claimed }) {
  const body = `
  <h1>Welcome, ${esc(attendee.first_name || attendee.name)}</h1>
  <p class="sub">You're verified as <b>${esc(attendee.name)}</b>${attendee.username ? ` (@${esc(attendee.username)})` : ''}.</p>

  <div class="card">
    <h2 style="margin:0 0 6px;font-size:1.1rem">Wi-Fi</h2>
    <p class="small" style="margin:0">Scan with your camera to connect.</p>
    <img class="qr" src="/wifi.png" alt="Wi-Fi QR code">
    ${
      wifi?.ssid
        ? `<div class="kv"><b>Network</b><code>${esc(wifi.ssid)}</code>${wifi.password ? `<b>Password</b><code>${esc(wifi.password)}</code>` : ''}</div>`
        : ''
    }
  </div>

  <div class="card">
    <h2 style="margin:0 0 6px;font-size:1.1rem">API credits</h2>
    ${
      claimed
        ? `<div class="msg info">You already opened your credits link on ${esc(new Date(claimed.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))} IST. If the page didn't load, you can retry within a few minutes of your first click.</div>`
        : `<p class="small" style="margin:0 0 4px">This opens your personal credits link. <b>It works once</b>, so make sure you're signed in to your account first.</p>`
    }
    <form method="post" action="/go/${esc(token)}">
      <button type="submit">Get my credits</button>
    </form>
    <p class="small" style="margin-top:12px">Please don't share this page — the link is tied to your registration and this device.</p>
  </div>`;
  return layout('Your access', body);
}

export function errorPage(code, { retryHref = '/' } = {}) {
  const body = `
  <h1>${esc(EVENT_NAME)}</h1>
  <div class="card">
    <div class="msg err">${esc(ERRORS[code] || code)}</div>
    <a class="btn" href="${esc(retryHref)}">Back</a>
  </div>`;
  return layout('Error', body);
}

export function adminPage({ key, roster, claims, message, error }) {
  const claimRows = Object.entries(claims)
    .sort((a, b) => (a[1].at < b[1].at ? 1 : -1))
    .map(
      ([id, c]) => `<tr>
        <td>${esc(new Date(c.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))}</td>
        <td>${esc(c.name)}</td>
        <td><code>${esc(id)}</code></td>
        <td class="small">${esc(c.ip)}</td>
        <td><form method="post" action="/admin/reset?key=${esc(key)}" onsubmit="return confirm('Reset claim for ${esc(c.name)}?')"><input type="hidden" name="id" value="${esc(id)}"><button class="secondary" style="padding:6px 10px;margin:0;font-size:.85rem">Reset</button></form></td>
      </tr>`,
    )
    .join('');

  const attendeeRows = roster.attendees
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (a) => `<tr>
        <td>${esc(a.name)}</td>
        <td>${a.username ? '@' + esc(a.username) : '<span class="small">—</span>'}</td>
        <td class="small">${esc(
          a.handles
            .filter((h) => h !== (a.username || '').toLowerCase())
            .map((h) => (h.startsWith('e:') ? 'email ✓' : h))
            .join(', '),
        )}</td>
        <td>${claims[a.id] ? '<span style="color:var(--ok)">claimed</span>' : '<span class="small">—</span>'}</td>
      </tr>`,
    )
    .join('');

  const body = `
  <h1>Admin</h1>
  <p class="sub">${esc(EVENT_NAME)}</p>
  ${message ? `<div class="msg ok">${esc(message)}</div>` : ''}
  ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
  <div class="card">
    <div class="kv">
      <b>Roster</b><span>${roster.attendees.length} attendees · source: ${esc(roster.source || 'none')} · updated ${roster.syncedAt ? esc(new Date(roster.syncedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })) + ' IST' : 'never'}</span>
      <b>Claims</b><span>${Object.keys(claims).length}</span>
      <b>Event</b><span><a style="color:var(--accent)" href="${esc(roster.eventUrl || LUMA_EVENT_URL)}">${esc(roster.eventUrl || LUMA_EVENT_URL)}</a></span>
    </div>
    <div class="row" style="margin-top:16px">
      <form method="post" action="/admin/sync?key=${esc(key)}"><button>Sync roster from Luma (Apify)</button></form>
      <form method="get" action="/admin/claims.csv"><input type="hidden" name="key" value="${esc(key)}"><button class="secondary">Download claims CSV</button></form>
    </div>
    <form method="post" action="/admin/import?key=${esc(key)}" enctype="multipart/form-data" style="margin-top:18px;padding-top:16px;border-top:1px solid var(--line)">
      <label for="csv" style="margin-top:0">Import guest list CSV <span class="small">(Luma host dashboard → Guests → Export, or any CSV with name / email / username columns)</span></label>
      <div class="row" style="align-items:center">
        <input id="csv" name="csv" type="file" accept=".csv,text/csv" required style="flex:1">
        <button style="flex:0 0 auto;width:auto;padding:12px 18px">Import CSV</button>
      </div>
      <label class="small" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" name="only_approved" value="1" checked style="width:auto"> Only import guests with approval_status = approved</label>
    </form>
    <form method="post" action="/admin/wifi?key=${esc(key)}" enctype="multipart/form-data" style="margin-top:14px">
      <label for="wifi" style="margin-top:0">Wi-Fi QR image (PNG) <span class="small">— current: <a href="/wifi.png" target="_blank" style="color:var(--accent)">view</a></span></label>
      <div class="row" style="align-items:center">
        <input id="wifi" name="wifi" type="file" accept="image/png" required style="flex:1">
        <button style="flex:0 0 auto;width:auto;padding:12px 18px" class="secondary">Upload</button>
      </div>
    </form>
  </div>
  <div class="card">
    <h2 style="margin:0 0 10px;font-size:1.1rem">Claims (${Object.keys(claims).length})</h2>
    <table><thead><tr><th>When (IST)</th><th>Name</th><th>ID</th><th>IP</th><th></th></tr></thead><tbody>${claimRows || '<tr><td colspan="5" class="small">No claims yet</td></tr>'}</tbody></table>
  </div>
  <div class="card">
    <h2 style="margin:0 0 10px;font-size:1.1rem">Roster (${roster.attendees.length})</h2>
    <table><thead><tr><th>Name</th><th>Username</th><th>Other handles</th><th>Status</th></tr></thead><tbody>${attendeeRows || '<tr><td colspan="4" class="small">Empty — run a sync</td></tr>'}</tbody></table>
  </div>`;
  return layout('Admin', body, { wide: true });
}
