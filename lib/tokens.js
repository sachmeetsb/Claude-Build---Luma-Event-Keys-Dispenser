import crypto from 'node:crypto';

const SECRET = process.env.LINK_SECRET;
if (!SECRET || SECRET.length < 16) {
  throw new Error('LINK_SECRET must be set (>=16 chars). Generate: openssl rand -hex 32');
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');

function sign(payloadB64) {
  return crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
}

export function sidHash(sid) {
  return crypto.createHash('sha256').update(`sid:${sid}`).digest('base64url').slice(0, 16);
}

export function newSid() {
  return crypto.randomBytes(24).toString('base64url');
}

/** Issue a token bound to attendee id and browser session id. */
export function issue({ id, sid, ttlSec = 6 * 3600 }) {
  const payload = {
    id,
    s: sidHash(sid),
    exp: Math.floor(Date.now() / 1000) + ttlSec,
    n: crypto.randomBytes(6).toString('base64url'),
  };
  const p = b64u(JSON.stringify(payload));
  return `${p}.${sign(p)}`;
}

/** @returns {{id:string, s:string, exp:number}|null} */
export function verify(token, sid) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [p, sig] = token.split('.');
  const expect = sign(p);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  let payload;
  try {
    payload = JSON.parse(unb64u(p).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.id || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (!sid || payload.s !== sidHash(sid)) return { ...payload, sidMismatch: true };
  return payload;
}
