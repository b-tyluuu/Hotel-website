import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { db, ROOT, DATA_DIR, hashPassword, verifyPassword, firstRunCredentials, parseRoom } from './db.js';

const PUBLIC = path.join(ROOT, 'public');
const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const SECURE_COOKIE = process.env.NODE_ENV === 'production';
const TAX = 0.1;
const ACTIVE = `('new','confirmed','checked_in')`;
const STATUSES = ['new', 'confirmed', 'checked_in', 'checked_out', 'cancelled'];

/* ---------- session secret (persisted so logins survive restarts) ---------- */
const keyFile = path.join(DATA_DIR, 'secret.key');
if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = process.env.SESSION_SECRET || readFileSync(keyFile, 'utf8').trim();

/* ---------- helpers ---------- */
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const sign = v => createHmac('sha256', SECRET).update(v).digest('base64url');
function makeToken(payload) { const b = Buffer.from(JSON.stringify(payload)).toString('base64url'); return b + '.' + sign(b); }
function readToken(t) {
  if (!t || !t.includes('.')) return null;
  const [b, s] = t.split('.'); const good = sign(b);
  if (s.length !== good.length || !timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  try { const p = JSON.parse(Buffer.from(b, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split(/=(.*)/s).slice(0, 2)).filter(a => a[0]));
function currentUser(req) {
  const p = readToken(cookies(req).sid); if (!p) return null;
  return db.prepare('SELECT id,username,name,role FROM users WHERE id=?').get(p.uid) || null;
}
function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
async function readJson(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Ожидается JSON');
  let size = 0, chunks = [];
  for await (const c of req) { size += c.length; if (size > 100_000) throw new HttpError(413, 'Слишком большой запрос'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw new HttpError(400, 'Некорректный JSON'); }
}
const hits = new Map();
function limit(req, key, max, windowMs) {
  const ip = TRUST_PROXY ? (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress : req.socket.remoteAddress;
  const k = key + ':' + ip, now = Date.now(); let h = hits.get(k);
  if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(k, h); }
  if (++h.n > max) throw new HttpError(429, 'Слишком много попыток. Попробуйте позже.');
}
setInterval(() => { const n = Date.now(); for (const [k, h] of hits) if (h.reset < n) hits.delete(k); }, 60_000).unref();

const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z'));
const nightsBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (s, n) => new Date(Date.parse(s) + n * 864e5).toISOString().slice(0, 10);
const str = (v, max) => String(v ?? '').trim().slice(0, max);

/* free units of a room for [in,out) */
function freeUnits(room, inD, outD) {
  const rows = db.prepare(`SELECT check_in a, check_out b FROM bookings WHERE room_id=? AND status IN ${ACTIVE} AND check_in < ? AND check_out > ?`).all(room.id, outD, inD);
  let peak = 0;
  for (let d = inD; d < outD; d = addDays(d, 1)) peak = Math.max(peak, rows.filter(r => r.a <= d && r.b > d).length);
  return room.units - peak;
}

function createBooking(d, { source = 'web', status = 'new', allowPast = false } = {}) {
  const checkIn = d.checkIn, checkOut = d.checkOut;
  if (!isDate(checkIn) || !isDate(checkOut)) throw new HttpError(400, 'Укажите даты заезда и выезда.');
  const n = nightsBetween(checkIn, checkOut);
  if (n < 1 || n > 30) throw new HttpError(400, 'Срок проживания — от 1 до 30 ночей.');
  if (!allowPast && checkIn < addDays(todayStr(), -1)) throw new HttpError(400, 'Дата заезда уже прошла.');
  const adults = Math.trunc(+d.adults), kids = Math.trunc(+d.kids || 0);
  if (!(adults >= 1 && adults <= 10) || !(kids >= 0 && kids <= 10)) throw new HttpError(400, 'Проверьте число гостей.');
  const name = str(d.name, 100), email = str(d.email, 120), phone = str(d.phone, 40);
  if (name.length < 2) throw new HttpError(400, 'Введите имя и фамилию.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Введите корректный email.');
  if (phone.replace(/\D/g, '').length < 7) throw new HttpError(400, 'Введите корректный телефон.');
  const room = db.prepare('SELECT * FROM rooms WHERE id=? AND active=1').get(+d.roomId);
  if (!room) throw new HttpError(404, 'Номер не найден.');
  if (adults + kids > room.guests) throw new HttpError(400, `В этом номере максимум ${room.guests} гостей.`);

  db.exec('BEGIN IMMEDIATE');
  try {
    if (freeUnits(room, checkIn, checkOut) < 1) throw new HttpError(409, 'На выбранные даты этот номер уже занят. Выберите другие даты или другой номер.');
    const sub = room.price * n, total = sub + Math.round(sub * TAX);
    let code, tries = 0;
    do { code = 'TNG-' + randomBytes(4).toString('hex').slice(0, 5).toUpperCase(); } while (db.prepare('SELECT 1 FROM bookings WHERE code=?').get(code) && ++tries < 10);
    db.prepare(`INSERT INTO bookings(code,room_id,check_in,check_out,nights,adults,kids,guest_name,email,phone,total,status,source,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(code, room.id, checkIn, checkOut, n, adults, kids, name, email, phone, total, status, source, str(d.notes, 500));
    db.exec('COMMIT');
    return { code, room: room.name, checkIn, checkOut, nights: n, total, status };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

const bookingRow = `SELECT b.*, r.name room_name FROM bookings b JOIN rooms r ON r.id=b.room_id`;
const pubBooking = b => ({ code: b.code, roomId: b.room_id, room: b.room_name, checkIn: b.check_in, checkOut: b.check_out, nights: b.nights, total: b.total, status: b.status });

/* ---------- API ---------- */
async function api(req, res, url) {
  const m = req.method, p = url.pathname;

  /* public */
  if (m === 'GET' && p === '/api/rooms') {
    const inD = url.searchParams.get('checkIn'), outD = url.searchParams.get('checkOut');
    const check = isDate(inD) && isDate(outD) && inD < outD;
    const rooms = db.prepare('SELECT * FROM rooms WHERE active=1 ORDER BY sort,id').all().map(parseRoom).map(r => check ? { ...r, available: Math.max(0, freeUnits(r, inD, outD)) } : r);
    return send(res, 200, { rooms });
  }
  if (m === 'POST' && p === '/api/bookings') {
    limit(req, 'book', 10, 3_600_000);
    return send(res, 201, { booking: createBooking(await readJson(req)) });
  }
  if (m === 'POST' && p === '/api/bookings/lookup') {
    limit(req, 'lookup', 60, 600_000);
    const d = await readJson(req);
    const rows = (Array.isArray(d.items) ? d.items.slice(0, 20) : []).map(i => db.prepare(`${bookingRow} WHERE b.code=? AND lower(b.email)=lower(?)`).get(str(i.code, 20), str(i.email, 120))).filter(Boolean);
    return send(res, 200, { bookings: rows.map(pubBooking) });
  }
  if (m === 'POST' && p === '/api/bookings/cancel') {
    limit(req, 'cancel', 20, 600_000);
    const d = await readJson(req);
    const b = db.prepare('SELECT * FROM bookings WHERE code=? AND lower(email)=lower(?)').get(str(d.code, 20), str(d.email, 120));
    if (!b) throw new HttpError(404, 'Бронь не найдена.');
    if (!['new', 'confirmed'].includes(b.status)) throw new HttpError(409, 'Эту бронь уже нельзя отменить онлайн. Свяжитесь с отелем.');
    db.prepare(`UPDATE bookings SET status='cancelled' WHERE id=?`).run(b.id);
    return send(res, 200, { ok: true });
  }

  /* admin auth */
  if (m === 'POST' && p === '/api/admin/login') {
    limit(req, 'login', 8, 600_000);
    const d = await readJson(req);
    const u = db.prepare('SELECT * FROM users WHERE username=?').get(str(d.username, 50));
    const ok = u ? verifyPassword(String(d.password ?? ''), u.pass_hash) : (verifyPassword('x', 'aa:bb'), false);
    if (!ok) throw new HttpError(401, 'Неверный логин или пароль.');
    const token = makeToken({ uid: u.id, exp: Date.now() + 12 * 3_600_000 });
    return send(res, 200, { user: { username: u.username, name: u.name, role: u.role } },
      { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${12 * 3600}${SECURE_COOKIE ? '; Secure' : ''}` });
  }
  if (m === 'POST' && p === '/api/admin/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });

  if (!p.startsWith('/api/admin/')) throw new HttpError(404, 'Не найдено');
  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'Требуется вход.');
  const adminOnly = () => { if (user.role !== 'admin') throw new HttpError(403, 'Недостаточно прав.'); };

  if (m === 'GET' && p === '/api/admin/me') return send(res, 200, { user });

  if (m === 'POST' && p === '/api/admin/password') {
    const d = await readJson(req);
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if (!verifyPassword(String(d.old ?? ''), row.pass_hash)) throw new HttpError(400, 'Текущий пароль неверный.');
    if (String(d.new ?? '').length < 8) throw new HttpError(400, 'Новый пароль — не короче 8 символов.');
    db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hashPassword(String(d.new)), user.id);
    return send(res, 200, { ok: true });
  }

  if (m === 'GET' && p === '/api/admin/stats') {
    const t = todayStr(), month = t.slice(0, 7);
    const one = (sql, ...a) => db.prepare(sql).get(...a).c;
    const totalUnits = one('SELECT COALESCE(SUM(units),0) c FROM rooms WHERE active=1');
    const occupied = one(`SELECT COUNT(*) c FROM bookings WHERE status IN ('confirmed','checked_in') AND check_in <= ? AND check_out > ?`, t, t);
    const upcoming = db.prepare(`${bookingRow} WHERE b.status IN ('new','confirmed') AND b.check_in >= ? ORDER BY b.check_in LIMIT 6`).all(t);
    const recent = db.prepare(`${bookingRow} ORDER BY b.id DESC LIMIT 6`).all();
    const series = [];
    for (let i = 13; i >= 0; i--) { const d = addDays(t, -i); series.push({ date: d, count: one(`SELECT COUNT(*) c FROM bookings WHERE substr(created_at,1,10)=?`, d) }); }
    return send(res, 200, {
      newCount: one(`SELECT COUNT(*) c FROM bookings WHERE status='new'`),
      arrivals: one(`SELECT COUNT(*) c FROM bookings WHERE check_in=? AND status IN ('new','confirmed')`, t),
      departures: one(`SELECT COUNT(*) c FROM bookings WHERE check_out=? AND status='checked_in'`, t),
      inHouse: one(`SELECT COUNT(*) c FROM bookings WHERE status='checked_in'`),
      occupancy: totalUnits ? Math.round(occupied / totalUnits * 100) : 0, occupied, totalUnits,
      revenueMonth: one(`SELECT COALESCE(SUM(total),0) c FROM bookings WHERE status!='cancelled' AND substr(check_in,1,7)=?`, month),
      upcoming, recent, series
    });
  }

  if (m === 'GET' && p === '/api/admin/bookings') {
    const q = url.searchParams, where = [], args = [];
    const status = q.get('status'); if (status && STATUSES.includes(status)) { where.push('b.status=?'); args.push(status); }
    const s = str(q.get('q'), 60); if (s) { where.push(`(b.code LIKE ? OR b.guest_name LIKE ? OR b.email LIKE ? OR b.phone LIKE ?)`); const l = `%${s.replace(/[%_]/g, '')}%`; args.push(l, l, l, l); }
    const from = q.get('from'); if (isDate(from)) { where.push('b.check_out > ?'); args.push(from); }
    const rows = db.prepare(`${bookingRow} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.id DESC LIMIT 500`).all(...args);
    return send(res, 200, { bookings: rows });
  }
  if (m === 'POST' && p === '/api/admin/bookings') {
    const d = await readJson(req);
    return send(res, 201, { booking: createBooking(d, { source: 'staff', status: 'confirmed', allowPast: true }) });
  }
  let mm;
  if (m === 'PATCH' && (mm = p.match(/^\/api\/admin\/bookings\/(\d+)$/))) {
    const d = await readJson(req), b = db.prepare('SELECT * FROM bookings WHERE id=?').get(+mm[1]);
    if (!b) throw new HttpError(404, 'Бронь не найдена.');
    const status = d.status ?? b.status;
    if (!STATUSES.includes(status)) throw new HttpError(400, 'Неверный статус.');
    if (b.status === 'cancelled' && status !== 'cancelled') { // re-activating: make sure the room is still free
      const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(b.room_id);
      if (freeUnits(room, b.check_in, b.check_out) < 1) throw new HttpError(409, 'На эти даты номер уже занят другой бронью.');
    }
    db.prepare('UPDATE bookings SET status=?, notes=? WHERE id=?').run(status, d.notes !== undefined ? str(d.notes, 500) : b.notes, b.id);
    return send(res, 200, { ok: true });
  }

  if (m === 'GET' && p === '/api/admin/calendar') {
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : todayStr().slice(0, 7);
    const start = month + '-01', next = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5) , 1)).toISOString().slice(0, 10);
    const days = nightsBetween(start, next);
    const rooms = db.prepare('SELECT id,name,units FROM rooms WHERE active=1 ORDER BY sort,id').all();
    const bks = db.prepare(`SELECT room_id,check_in a,check_out b FROM bookings WHERE status IN ${ACTIVE} AND check_in < ? AND check_out > ?`).all(next, start);
    return send(res, 200, { month, days, rooms: rooms.map(r => ({ ...r, busy: Array.from({ length: days }, (_, i) => { const d = addDays(start, i); return bks.filter(x => x.room_id === r.id && x.a <= d && x.b > d).length; }) })) });
  }

  if (m === 'GET' && p === '/api/admin/rooms') return send(res, 200, { rooms: db.prepare('SELECT * FROM rooms ORDER BY sort,id').all().map(parseRoom) });
  if (m === 'PATCH' && (mm = p.match(/^\/api\/admin\/rooms\/(\d+)$/))) {
    adminOnly();
    const d = await readJson(req), r = db.prepare('SELECT * FROM rooms WHERE id=?').get(+mm[1]);
    if (!r) throw new HttpError(404, 'Номер не найден.');
    const price = d.price !== undefined ? Math.trunc(+d.price) : r.price, units = d.units !== undefined ? Math.trunc(+d.units) : r.units;
    if (!(price >= 1 && price <= 100000) || !(units >= 0 && units <= 500)) throw new HttpError(400, 'Проверьте цену и количество номеров.');
    db.prepare('UPDATE rooms SET price=?, units=?, active=?, name=?, desc=? WHERE id=?')
      .run(price, units, d.active !== undefined ? (d.active ? 1 : 0) : r.active, d.name !== undefined ? str(d.name, 100) || r.name : r.name, d.desc !== undefined ? str(d.desc, 600) : r.desc, r.id);
    return send(res, 200, { ok: true });
  }

  if (m === 'GET' && p === '/api/admin/users') { adminOnly(); return send(res, 200, { users: db.prepare('SELECT id,username,name,role FROM users ORDER BY id').all() }); }
  if (m === 'POST' && p === '/api/admin/users') {
    adminOnly();
    const d = await readJson(req), username = str(d.username, 40).toLowerCase(), name = str(d.name, 80) || username;
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new HttpError(400, 'Логин: 3–40 символов (латиница, цифры, . _ -).');
    if (String(d.password ?? '').length < 8) throw new HttpError(400, 'Пароль — не короче 8 символов.');
    if (!['admin', 'staff'].includes(d.role)) throw new HttpError(400, 'Неверная роль.');
    if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) throw new HttpError(409, 'Такой логин уже есть.');
    db.prepare('INSERT INTO users(username,name,pass_hash,role) VALUES(?,?,?,?)').run(username, name, hashPassword(String(d.password)), d.role);
    return send(res, 201, { ok: true });
  }
  if (m === 'DELETE' && (mm = p.match(/^\/api\/admin\/users\/(\d+)$/))) {
    adminOnly();
    if (+mm[1] === user.id) throw new HttpError(400, 'Нельзя удалить самого себя.');
    db.prepare('DELETE FROM users WHERE id=?').run(+mm[1]);
    return send(res, 200, { ok: true });
  }
  throw new HttpError(404, 'Не найдено');
}

/* ---------- static files ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
  if (pathname === '/admin') return send(res, 301, '', { Location: '/admin/' });
  let rel; try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad request'); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep) || rel.split('/').some(s => s.startsWith('.'))) return send(res, 404, 'Not found');
  try {
    if (!(await stat(file)).isFile()) throw 0;
    const ext = path.extname(file).toLowerCase();
    const cache = /\.(webp|jpe?g|png|svg|woff2|mp4)$/.test(ext) ? 'public, max-age=604800' : 'no-cache';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch { send(res, 404, 'Страница не найдена'); }
}

http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) await api(req, res, url); else await serveStatic(req, res, url.pathname);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error(e); send(res, 500, { error: 'Внутренняя ошибка сервера' });
  }
}).listen(PORT, HOST, () => {
  console.log(`\n  Сайт:    http://localhost:${PORT}\n  Админка: http://localhost:${PORT}/admin/\n`);
  if (firstRunCredentials) console.log(`  ПЕРВЫЙ ЗАПУСК — данные для входа в админку (сохраните!):\n    логин:  ${firstRunCredentials.username}\n    пароль: ${firstRunCredentials.password}\n  Сменить пароль: npm run admin -- admin НОВЫЙ_ПАРОЛЬ\n`);
});
