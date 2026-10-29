/*
 * බලපත්‍ර හා දීමනා පත්‍ර තෝම්බුව — backend
 * Zero dependencies: Node.js (>= 22.13) built-ins only (http + node:sqlite).
 *
 *   node server.js            -> http://localhost:3000
 *   PORT=8080 node server.js  -> custom port
 *   DB_PATH=/data/registry.db node server.js
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Friendly Node version check (node:sqlite needs >= 22.13)
{
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) {
    console.error('\nError: Node.js ' + process.versions.node + ' is too old. Install Node.js 22 LTS or newer from https://nodejs.org\n');
    console.error('දෝෂය: ඔබේ Node.js අනුවාදය (' + process.versions.node + ') පරණයි. https://nodejs.org වෙතින් අලුත් LTS (22 හෝ ඊට වැඩි) install කරන්න.\n');
    process.exit(1);
  }
}
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'registry.db');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 25 * 1024 * 1024; // 25MB (large backup imports)

/* ---------------------------------------------------------------- database */
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS records (
    id                 TEXT PRIMARY KEY,
    wasama             TEXT NOT NULL DEFAULT '',
    permit_holder      TEXT NOT NULL DEFAULT '',
    permit_holder_nic  TEXT NOT NULL DEFAULT '',
    spouse             TEXT NOT NULL DEFAULT '',
    spouse_nic         TEXT NOT NULL DEFAULT '',
    license_no         TEXT NOT NULL DEFAULT '',
    license_inheritance TEXT NOT NULL DEFAULT '',
    surveyed           INTEGER NOT NULL DEFAULT 0,
    parcel_no          TEXT NOT NULL DEFAULT '',
    extent             TEXT NOT NULL DEFAULT '',
    boundary_north     TEXT NOT NULL DEFAULT '',
    boundary_south     TEXT NOT NULL DEFAULT '',
    boundary_east      TEXT NOT NULL DEFAULT '',
    boundary_west      TEXT NOT NULL DEFAULT '',
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
  );

  -- දරුවන් (නම + හැඳුනුම්පත් අංකය) වෙනම table එකක
  CREATE TABLE IF NOT EXISTS children (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id  TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL DEFAULT 0,
    name       TEXT NOT NULL DEFAULT '',
    nic        TEXT NOT NULL DEFAULT ''
  );

  -- 11. පසු කටයුතු (checkbox group)
  CREATE TABLE IF NOT EXISTS subsequent_actions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id  TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    action     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_records_license ON records(license_no);
  CREATE INDEX IF NOT EXISTS idx_records_nic     ON records(permit_holder_nic);
  CREATE INDEX IF NOT EXISTS idx_records_created ON records(created_at);
  CREATE INDEX IF NOT EXISTS idx_children_record ON children(record_id);
  CREATE INDEX IF NOT EXISTS idx_actions_record  ON subsequent_actions(record_id);
`);

const TEXT_FIELDS = {
  wasama: 'wasama',
  permitHolder: 'permit_holder',
  permitHolderNic: 'permit_holder_nic',
  spouse: 'spouse',
  spouseNic: 'spouse_nic',
  licenseNo: 'license_no',
  licenseInheritance: 'license_inheritance',
  parcelNo: 'parcel_no',
  extent: 'extent',
  boundaryNorth: 'boundary_north',
  boundarySouth: 'boundary_south',
  boundaryEast: 'boundary_east',
  boundaryWest: 'boundary_west',
};

const str = (v) => (v == null ? '' : String(v)).trim();

/** Normalise untrusted client input into a clean record payload. */
function clean(input) {
  const d = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const k of Object.keys(TEXT_FIELDS)) out[k] = str(d[k]);
  out.surveyed = d.surveyed === true || d.surveyed === 1 || d.surveyed === 'true';
  out.children = (Array.isArray(d.children) ? d.children : [])
    .map((c) => ({ name: str(c && c.name), nic: str(c && c.nic) }))
    .filter((c) => c.name || c.nic);
  out.subsequentActions = (Array.isArray(d.subsequentActions) ? d.subsequentActions : [])
    .map(str)
    .filter(Boolean);
  return out;
}

/* prepared statements */
const insertRecord = db.prepare(`
  INSERT INTO records (id, wasama, permit_holder, permit_holder_nic, spouse, spouse_nic,
    license_no, license_inheritance, surveyed, parcel_no, extent,
    boundary_north, boundary_south, boundary_east, boundary_west, created_at, updated_at)
  VALUES (@id, @wasama, @permitHolder, @permitHolderNic, @spouse, @spouseNic,
    @licenseNo, @licenseInheritance, @surveyed, @parcelNo, @extent,
    @boundaryNorth, @boundarySouth, @boundaryEast, @boundaryWest, @createdAt, @updatedAt)
`);
const updateRecord = db.prepare(`
  UPDATE records SET wasama=@wasama, permit_holder=@permitHolder, permit_holder_nic=@permitHolderNic,
    spouse=@spouse, spouse_nic=@spouseNic, license_no=@licenseNo, license_inheritance=@licenseInheritance,
    surveyed=@surveyed, parcel_no=@parcelNo, extent=@extent, boundary_north=@boundaryNorth,
    boundary_south=@boundarySouth, boundary_east=@boundaryEast, boundary_west=@boundaryWest,
    updated_at=@updatedAt
  WHERE id=@id
`);
const deleteRecord = db.prepare('DELETE FROM records WHERE id = ?');
const deleteChildren = db.prepare('DELETE FROM children WHERE record_id = ?');
const deleteActions = db.prepare('DELETE FROM subsequent_actions WHERE record_id = ?');
const insertChild = db.prepare('INSERT INTO children (record_id, position, name, nic) VALUES (?, ?, ?, ?)');
const insertAction = db.prepare('INSERT INTO subsequent_actions (record_id, action) VALUES (?, ?)');
const selectRecord = db.prepare('SELECT * FROM records WHERE id = ?');
const selectAllRecords = db.prepare('SELECT * FROM records ORDER BY created_at DESC, rowid DESC');
const selectChildren = db.prepare('SELECT name, nic FROM children WHERE record_id = ? ORDER BY position, id');
const selectActions = db.prepare('SELECT action FROM subsequent_actions WHERE record_id = ? ORDER BY id');
const countRecords = db.prepare('SELECT COUNT(*) AS n FROM records');
const selectSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const upsertSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

/** DB row -> the exact shape the frontend expects. */
function toApi(row) {
  return {
    id: row.id,
    wasama: row.wasama,
    permitHolder: row.permit_holder,
    permitHolderNic: row.permit_holder_nic,
    spouse: row.spouse,
    spouseNic: row.spouse_nic,
    children: selectChildren.all(row.id).map((c) => ({ name: c.name, nic: c.nic })),
    licenseNo: row.license_no,
    licenseInheritance: row.license_inheritance,
    surveyed: !!row.surveyed,
    parcelNo: row.parcel_no,
    extent: row.extent,
    boundaryNorth: row.boundary_north,
    boundarySouth: row.boundary_south,
    boundaryEast: row.boundary_east,
    boundaryWest: row.boundary_west,
    subsequentActions: selectActions.all(row.id).map((a) => a.action),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Run fn inside a transaction (node:sqlite has no helper for this). */
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function writeRecord(id, data, createdAt, updatedAt, isNew) {
  // node:sqlite rejects unknown named parameters, so pass only the scalar columns
  const params = { id, surveyed: data.surveyed ? 1 : 0, updatedAt };
  for (const k of Object.keys(TEXT_FIELDS)) params[k] = data[k];
  if (isNew) insertRecord.run({ ...params, createdAt });
  else updateRecord.run(params);
  deleteChildren.run(id);
  deleteActions.run(id);
  data.children.forEach((c, i) => insertChild.run(id, i, c.name, c.nic));
  data.subsequentActions.forEach((a) => insertAction.run(id, a));
}

/* ------------------------------------------------------------------ helpers */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------ authentication */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',   -- 'admin' | 'user'
    created_at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`);

const SESSION_MS = 12 * 60 * 60 * 1000; // පැය 12කින් නැවත login විය යුතුයි
const TRUST_PROXY = process.env.TRUST_PROXY === '1';   // reverse proxy (Caddy/nginx/Cloudflare) පිටුපස නම් 1
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1'; // HTTPS භාවිතා කරන්නේ නම් 1

const qUserByName = db.prepare('SELECT * FROM users WHERE username = ?');
const qUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const qUsers = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id');
const qCountUsers = db.prepare('SELECT COUNT(*) AS n FROM users');
const qCountAdmins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
const qInsertUser = db.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)');
const qSetPassword = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const qSetRole = db.prepare('UPDATE users SET role = ? WHERE id = ?');
const qDeleteUser = db.prepare('DELETE FROM users WHERE id = ?');
const qInsertSession = db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)');
const qSession = db.prepare(
  'SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'
);
const qDeleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
const qDeleteUserSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?');
const qPurgeSessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, s, h] = String(stored).split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const calc = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
  const exp = Buffer.from(h, 'hex');
  return exp.length === calc.length && crypto.timingSafeEqual(calc, exp);
}
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex'));
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function validUsername(u) {
  return typeof u === 'string' && /^[A-Za-z0-9._-]{3,32}$/.test(u);
}
function validPassword(p) {
  return typeof p === 'string' && p.length >= 8 && p.length <= 200;
}
const BAD_USERNAME = 'පරිශීලක නාමය අකුරු/ඉලක්කම් 3-32ක් විය යුතුයි (a-z, 0-9, . _ -)';
const BAD_PASSWORD = 'මුරපදය අවම අකුරු 8ක් විය යුතුයි';

function getToken(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}
function currentUser(req) {
  const token = getToken(req);
  return token ? qSession.get(sha(token), Date.now()) || null : null;
}
function cookieHeader(req, token, maxAgeSec) {
  const secure = COOKIE_SECURE || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
  return `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}
function startSession(req, userId) {
  qPurgeSessions.run(Date.now());
  const token = crypto.randomBytes(32).toString('hex');
  qInsertSession.run(sha(token), userId, Date.now() + SESSION_MS);
  return cookieHeader(req, token, SESSION_MS / 1000);
}

// වැරදි මුරපද උත්සාහ සීමා කිරීම (brute-force ආරක්ෂාව)
const attempts = new Map();
function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}
function checkLock(ip) {
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) throw new HttpError(429, 'වැරදි උත්සාහ වැඩියි. විනාඩි 10කින් පසු නැවත උත්සාහ කරන්න');
}
function recordFail(ip) {
  const a = attempts.get(ip) || { n: 0, until: 0 };
  if (a.until && a.until <= Date.now()) { a.n = 0; a.until = 0; }
  if (++a.n >= 8) { a.until = Date.now() + 10 * 60 * 1000; a.n = 0; }
  attempts.set(ip, a);
}

// CSRF: වෙනත් අඩවියකින් එන ලිවීමේ ඉල්ලීම් ප්‍රතික්ෂේප කිරීම
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host;
  try { host = new URL(origin).host; } catch { throw new HttpError(403, 'Forbidden'); }
  if (host !== req.headers.host) throw new HttpError(403, 'Forbidden');
}

// අමතක වූ මුරපදය: node server.js reset-password <නම> <අලුත් මුරපදය>
if (process.argv[2] === 'reset-password') {
  const [uname, pw] = [process.argv[3], process.argv[4]];
  const u = uname && qUserByName.get(uname);
  if (!u) { console.error('එම පරිශීලකයා හමු නොවීය'); process.exit(1); }
  if (!validPassword(pw)) { console.error(BAD_PASSWORD); process.exit(1); }
  qSetPassword.run(hashPassword(pw), u.id);
  qDeleteUserSessions.run(u.id);
  console.log(`"${u.username}" ගේ මුරපදය වෙනස් කළා.`);
  db.close();
  process.exit(0);
}

async function handleAuth(req, res, sub, method) {
  if (sub === 'status' && method === 'GET') {
    return sendJson(res, 200, { setupNeeded: qCountUsers.get().n === 0, user: currentUser(req) });
  }

  // පළමු admin ගිණුම (පරිශීලකයින් කිසිවෙක් නැති විට පමණි)
  if (sub === 'setup' && method === 'POST') {
    if (qCountUsers.get().n > 0) throw new HttpError(403, 'දැනටමත් සකස් කර ඇත');
    const b = await readJson(req);
    if (!validUsername(b.username)) throw new HttpError(400, BAD_USERNAME);
    if (!validPassword(b.password)) throw new HttpError(400, BAD_PASSWORD);
    const info = qInsertUser.run(b.username, hashPassword(b.password), 'admin', new Date().toISOString());
    const cookie = startSession(req, Number(info.lastInsertRowid));
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie });
  }

  if (sub === 'login' && method === 'POST') {
    const ip = clientIp(req);
    checkLock(ip);
    const b = await readJson(req);
    const row = typeof b.username === 'string' ? qUserByName.get(b.username) : null;
    const ok = verifyPassword(String(b.password || ''), row ? row.password_hash : DUMMY_HASH) && !!row;
    if (!ok) {
      recordFail(ip);
      throw new HttpError(401, 'පරිශීලක නාමය හෝ මුරපදය වැරදියි');
    }
    attempts.delete(ip);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': startSession(req, row.id) });
  }

  if (sub === 'logout' && method === 'POST') {
    const token = getToken(req);
    if (token) qDeleteSession.run(sha(token));
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
  }

  // තමාගේ මුරපදය වෙනස් කිරීම
  if (sub === 'password' && method === 'POST') {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'පිවිසීම අවශ්‍යයි');
    const b = await readJson(req);
    const row = qUserById.get(user.id);
    if (!verifyPassword(String(b.current || ''), row.password_hash)) throw new HttpError(400, 'වත්මන් මුරපදය වැරදියි');
    if (!validPassword(b.next)) throw new HttpError(400, BAD_PASSWORD);
    qSetPassword.run(hashPassword(b.next), user.id);
    qDeleteUserSessions.run(user.id); // අනිත් සියලු sessions වසා දමයි
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': startSession(req, user.id) });
  }

  throw new HttpError(404, 'Not found');
}

// පරිශීලක කළමනාකරණය (admin පමණි)
async function handleUsers(req, res, me, id, method) {
  if (me.role !== 'admin') throw new HttpError(403, 'Admin පමණි');
  const toApiUser = (u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.created_at });

  if (!id && method === 'GET') return sendJson(res, 200, qUsers.all().map(toApiUser));

  if (!id && method === 'POST') {
    const b = await readJson(req);
    if (!validUsername(b.username)) throw new HttpError(400, BAD_USERNAME);
    if (!validPassword(b.password)) throw new HttpError(400, BAD_PASSWORD);
    if (qUserByName.get(b.username)) throw new HttpError(409, 'එම පරිශීලක නාමය දැනටමත් ඇත');
    const role = b.role === 'admin' ? 'admin' : 'user';
    const info = qInsertUser.run(b.username, hashPassword(b.password), role, new Date().toISOString());
    return sendJson(res, 201, toApiUser(qUserById.get(Number(info.lastInsertRowid))));
  }

  const target = id && qUserById.get(Number(id));
  if (id && !target) throw new HttpError(404, 'පරිශීලකයා හමු නොවීය');

  if (id && method === 'PUT') {
    const b = await readJson(req);
    if (b.password !== undefined) {
      if (!validPassword(b.password)) throw new HttpError(400, BAD_PASSWORD);
      qSetPassword.run(hashPassword(b.password), target.id);
      qDeleteUserSessions.run(target.id);
    }
    if (b.role !== undefined) {
      const role = b.role === 'admin' ? 'admin' : 'user';
      if (target.role === 'admin' && role !== 'admin' && qCountAdmins.get().n <= 1) {
        throw new HttpError(400, 'අවසාන admin ගිණුම user බවට වෙනස් කළ නොහැක');
      }
      qSetRole.run(role, target.id);
    }
    return sendJson(res, 200, toApiUser(qUserById.get(target.id)));
  }

  if (id && method === 'DELETE') {
    if (target.id === me.id) throw new HttpError(400, 'ඔබේම ගිණුම මැකිය නොහැක');
    if (target.role === 'admin' && qCountAdmins.get().n <= 1) throw new HttpError(400, 'අවසාන admin ගිණුම මැකිය නොහැක');
    qDeleteUser.run(target.id);
    return sendJson(res, 200, { ok: true });
  }

  throw new HttpError(404, 'Not found');
}

/* --------------------------------------------------------------- API routes */
async function handleApi(req, res, pathname) {
  const method = req.method;
  const parts = pathname.split('/').filter(Boolean); // ['api', 'records', ':id']
  const resource = parts[1];
  const id = parts[2];

  if (method !== 'GET' && method !== 'HEAD') checkOrigin(req);
  if (resource === 'auth') return handleAuth(req, res, id, method);
  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'පිවිසීම අවශ්‍යයි');
  if (resource === 'users') return handleUsers(req, res, user, id, method);

  // GET /api/records
  if (resource === 'records' && !id && method === 'GET') {
    return sendJson(res, 200, selectAllRecords.all().map(toApi));
  }

  // POST /api/records
  if (resource === 'records' && !id && method === 'POST') {
    const data = clean(await readJson(req));
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    transaction(() => writeRecord(newId, data, now, now, true));
    return sendJson(res, 201, toApi(selectRecord.get(newId)));
  }

  // GET /api/records/:id
  if (resource === 'records' && id && method === 'GET') {
    const row = selectRecord.get(id);
    if (!row) throw new HttpError(404, 'Record not found');
    return sendJson(res, 200, toApi(row));
  }

  // PUT /api/records/:id
  if (resource === 'records' && id && method === 'PUT') {
    const row = selectRecord.get(id);
    if (!row) throw new HttpError(404, 'Record not found');
    const data = clean(await readJson(req));
    transaction(() => writeRecord(id, data, row.created_at, new Date().toISOString(), false));
    return sendJson(res, 200, toApi(selectRecord.get(id)));
  }

  // DELETE /api/records/:id
  if (resource === 'records' && id && method === 'DELETE') {
    const info = deleteRecord.run(id);
    if (!info.changes) throw new HttpError(404, 'Record not found');
    return sendJson(res, 200, { ok: true });
  }

  // GET /api/settings  |  PUT /api/settings
  if (resource === 'settings' && method === 'GET') {
    const row = selectSetting.get('sabhaName');
    return sendJson(res, 200, row ? { sabhaName: row.value } : {});
  }
  if (resource === 'settings' && method === 'PUT') {
    const body = await readJson(req);
    if (typeof body.sabhaName === 'string') upsertSetting.run('sabhaName', body.sabhaName.slice(0, 300));
    return sendJson(res, 200, { ok: true });
  }

  // GET /api/is-local  (backup panel is only shown on the main server machine)
  if (resource === 'is-local' && method === 'GET') {
    return sendJson(res, 200, { isLocal: user.role === 'admin' });
  }

  // GET /api/export  (main server only)
  if (resource === 'export' && method === 'GET') {
    if (user.role !== 'admin') throw new HttpError(403, 'Backup කළ හැක්කේ admin ට පමණි');
    const settingRow = selectSetting.get('sabhaName');
    const payload = {
      app: 'land-permit-registry',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: settingRow ? { sabhaName: settingRow.value } : {},
      records: selectAllRecords.all().map(toApi),
    };
    const name = `registry-backup-${new Date().toISOString().slice(0, 10)}.json`;
    return sendJson(res, 200, payload, { 'Content-Disposition': `attachment; filename="${name}"` });
  }

  // POST /api/import  (main server only) — replaces ALL existing data
  if (resource === 'import' && method === 'POST') {
    if (user.role !== 'admin') throw new HttpError(403, 'Import කළ හැක්කේ admin ට පමණි');
    const body = await readJson(req);
    if (!body || !Array.isArray(body.records)) throw new HttpError(400, 'වලංගු backup ගොනුවක් නොවේ (records නැත)');

    const imported = transaction(() => {
      db.exec('DELETE FROM records'); // children/actions cascade
      const seen = new Set();
      let n = 0;
      // backups are newest-first; insert oldest-first so created_at order is preserved on re-export
      for (const raw of [...body.records].reverse()) {
        const data = clean(raw);
        let rid = raw && typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID();
        if (seen.has(rid)) rid = crypto.randomUUID();
        seen.add(rid);
        const created = (raw && raw.createdAt) || new Date().toISOString();
        const updated = (raw && raw.updatedAt) || created;
        writeRecord(rid, data, created, updated, true);
        n++;
      }
      if (body.settings && typeof body.settings.sabhaName === 'string') {
        upsertSetting.run('sabhaName', body.settings.sabhaName.slice(0, 300));
      }
      return n;
    });
    return sendJson(res, 200, { ok: true, imported });
  }

  throw new HttpError(404, 'Not found');
}

/* ------------------------------------------------------------ static files */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Forbidden');
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new HttpError(404, 'Not found');
  }
  if (!stat.isFile()) throw new HttpError(404, 'Not found');
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

/* ------------------------------------------------------------------ server */
const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (pathname === '/api' || pathname.startsWith('/api/')) return await handleApi(req, res, pathname);

    // පිටු: login.html පමණක් open; අනිත් සියල්ලට login අවශ්‍යයි
    const user = currentUser(req);
    const redirect = (to) => { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); };
    if (pathname === '/login.html') return user ? redirect('/') : serveStatic(req, res, pathname);
    if (!user) return redirect('/login.html');
    if (pathname === '/admin.html' && user.role !== 'admin') return redirect('/');
    return serveStatic(req, res, pathname);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (res.headersSent) return res.end();
    if (req.url && req.url.startsWith('/api')) return sendJson(res, status, { error: err.message });
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(status === 500 ? 'Server error' : err.message);
  }
});

server.listen(PORT, HOST, () => {
  const n = countRecords.get().n;
  console.log(`බලපත්‍ර හා දීමනා පත්‍ර තෝම්බුව  →  http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}  (සටහන් ${n})`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
