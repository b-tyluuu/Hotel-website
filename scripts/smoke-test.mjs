// Usage: BASE=http://localhost:3100 ADMIN_PASSWORD=... node scripts/smoke-test.mjs
const BASE = process.env.BASE || 'http://localhost:3100', PW = process.env.ADMIN_PASSWORD;
let fails = 0, cookie = '';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const call = async (p, method = 'GET', body, auth = true) => {
  const r = await fetch(BASE + p, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth && cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc && sc.startsWith('sid=') && !sc.startsWith('sid=;')) cookie = sc.split(';')[0];
  return { s: r.status, d: await r.json().catch(() => ({})) };
};
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

let r = await call('/api/rooms'); ok(r.s === 200 && r.d.rooms.length === 6, 'rooms list (6 rooms)');
const presidential = r.d.rooms.find(x => x.units === 1);
const guest = { roomId: presidential.id, checkIn: day(10), checkOut: day(13), adults: 2, kids: 0, name: 'Тест Гость', email: 'test@example.com', phone: '+996555123456' };
r = await call('/api/bookings', 'POST', guest); ok(r.s === 201 && /^TNG-/.test(r.d.booking?.code), 'create booking -> ' + r.d.booking?.code);
const code = r.d.booking?.code; ok(r.d.booking?.total === Math.round(presidential.price * 3 * 1.1) || r.d.booking?.total === presidential.price * 3 + Math.round(presidential.price * 3 * .1), 'server-side price (3 nights + 10% tax)');
r = await call('/api/bookings', 'POST', { ...guest, checkIn: day(11), checkOut: day(12) }); ok(r.s === 409, 'double-booking blocked (409)');
r = await call('/api/bookings', 'POST', { ...guest, checkIn: day(13), checkOut: day(15) }); ok(r.s === 201, 'back-to-back dates allowed');
r = await call('/api/rooms?checkIn=' + day(10) + '&checkOut=' + day(11)); ok(r.d.rooms.find(x => x.id === presidential.id).available === 0, 'availability shows 0 for taken dates');
r = await call('/api/bookings', 'POST', { ...guest, name: 'x' }); ok(r.s === 400, 'validation rejects short name');
r = await call('/api/bookings', 'POST', { ...guest, checkIn: day(-30), checkOut: day(-28) }); ok(r.s === 400, 'past dates rejected');
r = await call('/api/bookings', 'POST', { ...guest, roomId: presidential.id, adults: 9 }); ok(r.s === 400, 'too many guests rejected');
r = await fetch(BASE + '/api/bookings', { method: 'POST', body: '{}' }); ok(r.status === 415, 'non-JSON POST rejected (CSRF guard)');
r = await call('/api/bookings/lookup', 'POST', { items: [{ code, email: 'test@example.com' }, { code, email: 'wrong@example.com' }] }); ok(r.d.bookings?.length === 1, 'lookup needs matching email');
r = await call('/api/admin/bookings', 'GET', null, false); ok(r.s === 401, 'admin API requires login');
r = await call('/api/admin/login', 'POST', { username: 'admin', password: 'wrong' }, false); ok(r.s === 401, 'wrong password rejected');
r = await call('/api/admin/login', 'POST', { username: 'admin', password: PW }); ok(r.s === 200 && r.d.user.role === 'admin', 'admin login');
r = await call('/api/admin/bookings'); ok(r.s === 200 && r.d.bookings.some(b => b.code === code), 'admin sees web booking');
const id = r.d.bookings.find(b => b.code === code).id;
r = await call('/api/admin/bookings/' + id, 'PATCH', { status: 'confirmed', notes: 'VIP' }); ok(r.s === 200, 'admin confirms booking');
r = await call('/api/admin/stats'); ok(r.s === 200 && typeof r.d.occupancy === 'number', 'stats endpoint');
r = await call('/api/admin/calendar'); ok(r.s === 200 && r.d.rooms.length === 6, 'calendar endpoint');
r = await call('/api/admin/bookings', 'POST', { ...guest, checkIn: day(20), checkOut: day(22) }); ok(r.s === 201, 'staff creates booking');
r = await call('/api/admin/rooms/' + presidential.id, 'PATCH', { price: 1000 }); ok(r.s === 200, 'admin edits price');
r = await call('/api/admin/users', 'POST', { username: 'frontdesk', name: 'Ресепшен', password: 'staffpass123', role: 'staff' }); ok(r.s === 201, 'admin creates staff user');
cookie = ''; r = await call('/api/admin/login', 'POST', { username: 'frontdesk', password: 'staffpass123' }); ok(r.s === 200, 'staff login');
r = await call('/api/admin/rooms/' + presidential.id, 'PATCH', { price: 1 }); ok(r.s === 403, 'staff cannot edit prices (403)');
r = await call('/api/admin/users'); ok(r.s === 403, 'staff cannot list users (403)');
r = await call('/api/admin/bookings'); ok(r.s === 200, 'staff can view bookings');
r = await call('/api/bookings/cancel', 'POST', { code, email: 'test@example.com' }, false); ok(r.s === 409 || r.s === 200, 'cancel endpoint responds (' + r.s + ')');
for (const f of ['/', '/styles.css', '/app.js', '/admin/', '/admin/admin.js', '/assets/steppe.webp']) { const x = await fetch(BASE + f); ok(x.status === 200, 'static ' + f); }
for (const f of ['/../server/db.js', '/%2e%2e/server/db.js', '/.env']) { const x = await fetch(BASE + f); ok(x.status === 404 || x.status === 400, 'blocked ' + f + ' (' + x.status + ')'); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
