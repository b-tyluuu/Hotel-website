import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'hotel.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS rooms(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, type TEXT NOT NULL, price INTEGER NOT NULL,
  size INTEGER, guests INTEGER NOT NULL, bed TEXT, view TEXT, rating REAL DEFAULT 4.8,
  desc TEXT, feats TEXT DEFAULT '[]', imgs TEXT DEFAULT '[]',
  units INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bookings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  check_in TEXT NOT NULL, check_out TEXT NOT NULL, nights INTEGER NOT NULL,
  adults INTEGER NOT NULL, kids INTEGER NOT NULL DEFAULT 0,
  guest_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL,
  total INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new',
  source TEXT NOT NULL DEFAULT 'web', notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_b_room_dates ON bookings(room_id, check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_b_status ON bookings(status);
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  pass_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff'
);
`);

/* ---------- passwords (scrypt, per-user salt) ---------- */
export function hashPassword(pw) {
  const salt = randomBytes(16);
  return salt.toString('hex') + ':' + scryptSync(pw, salt, 64).toString('hex');
}
export function verifyPassword(pw, stored) {
  const [s, h] = String(stored).split(':');
  if (!s || !h) return false;
  const a = scryptSync(pw, Buffer.from(s, 'hex'), 64), b = Buffer.from(h, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------- seed data (only on first run) ---------- */
const ROOMS = [
  ['Классический номер', 'standard', 180, 28, 2, '1 king-size', 'Вид на сад', 4.7, 'Уютный номер в тёплых тонах с мраморной ванной, мини-баром и рабочей зоной.', ['Wi-Fi', 'Кондиционер', 'Мини-бар', 'Сейф', 'Смарт-ТВ'], ['1631049307264-da0ec9d70304', '1566665797739-1674de7a421a', '1578683010236-d716f9a3f461'], 12],
  ['Стандарт с двумя кроватями', 'standard', 195, 30, 3, '2 twin', 'Вид на город', 4.6, 'Просторный номер для друзей или семьи с двумя полноразмерными кроватями.', ['Wi-Fi', 'Кондиционер', 'Кофемашина', 'Сейф', 'Смарт-ТВ'], ['1618773928121-c32242e63f39', '1590490360182-c33d57733427', '1584132967334-10e028bd69f7'], 10],
  ['Делюкс с видом на море', 'deluxe', 290, 38, 3, '1 king-size', 'Вид на море', 4.8, 'Светлый номер с балконом, откуда открывается панорама Средиземного моря.', ['Балкон', 'Wi-Fi', 'Ванна', 'Кофемашина', 'Халаты'], ['1582719478250-c89cae4dc85b', '1611892440504-42a792e24d32', '1596394516093-501ba68a0ba6'], 8],
  ['Делюкс с террасой', 'deluxe', 340, 44, 3, '1 king-size', 'Терраса у бассейна', 4.8, 'Выход на собственную террасу с шезлонгами и прямым доступом к бассейну.', ['Терраса', 'Wi-Fi', 'Джакузи', 'Мини-бар', 'Smart Home'], ['1564501049412-61c2a3083791', '1571896349842-33c89424de2d', '1445019980597-93fa8acb246c'], 6],
  ['Семейный люкс', 'suite', 460, 62, 5, '1 king + 2 single', 'Вид на море', 4.9, 'Две спальни, гостиная и детская зона. Идеально для отдыха всей семьёй.', ['2 спальни', 'Гостиная', 'Кухня', 'Балкон', 'Детский набор'], ['1591088398332-8a7791972843', '1560448204-e02f11c3d0e2', '1522708323590-d24dbb6b0267'], 4],
  ['Президентский люкс', 'suite', 980, 120, 4, '2 king-size', 'Панорама 270°', 5.0, 'Вершина отеля: личный дворецкий, крытый бассейн и панорамные окна от пола до потолка.', ['Дворецкий', 'Личный бассейн', 'Сауна', 'Трансфер', 'Кабинет'], ['1542314831-068cd1dbfeeb', '1631049552057-403cdb8f0658', '1512918728675-ed5a9ecdebfd'], 1]
];
if (db.prepare('SELECT COUNT(*) c FROM rooms').get().c === 0) {
  const ins = db.prepare('INSERT INTO rooms(name,type,price,size,guests,bed,view,rating,desc,feats,imgs,units,sort) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  ROOMS.forEach((r, i) => ins.run(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], JSON.stringify(r[9]), JSON.stringify(r[10]), r[11], i));
}

/* First admin: password from ADMIN_PASSWORD or random, printed once on first start. */
export let firstRunCredentials = null;
if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
  const pw = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO users(username,name,pass_hash,role) VALUES(?,?,?,?)').run('admin', 'Администратор', hashPassword(pw), 'admin');
  firstRunCredentials = { username: 'admin', password: process.env.ADMIN_PASSWORD ? '(из ADMIN_PASSWORD)' : pw };
}

export const parseRoom = r => ({ ...r, feats: JSON.parse(r.feats || '[]'), imgs: JSON.parse(r.imgs || '[]'), active: !!r.active });
