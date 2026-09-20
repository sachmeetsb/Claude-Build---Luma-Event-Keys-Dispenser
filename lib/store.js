import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const file = (name) => path.join(DATA_DIR, name);

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  const tmp = file(name + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file(name));
}

// roster: { syncedAt, eventUrl, attendees: [...] }
export const roster = {
  get: () => readJson('roster.json', { syncedAt: null, eventUrl: null, attendees: [] }),
  set: (v) => writeJson('roster.json', v),
};

// claims: { [attendeeId]: { at, ip, ua, name } }
export const claims = {
  get: () => readJson('claims.json', {}),
  set: (v) => writeJson('claims.json', v),
  has: (id) => Boolean(readJson('claims.json', {})[id]),
  add(id, info) {
    const all = readJson('claims.json', {});
    all[id] = { ...info, at: new Date().toISOString() };
    writeJson('claims.json', all);
    return all[id];
  },
  remove(id) {
    const all = readJson('claims.json', {});
    delete all[id];
    writeJson('claims.json', all);
  },
};

export { DATA_DIR };
