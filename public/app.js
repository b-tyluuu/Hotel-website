(() => {
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const U = (id, w = 900) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + n.toLocaleString('en-US');

/* ---------- data ---------- */
let ROOMS = []; // loaded from /api/rooms
/* Hero backgrounds: local files from /assets are used as-is, anything else is an Unsplash photo id.
   Drop more photos into /assets and list them here. */
const HERO = ['assets/steppe.webp', '1506905925346-21bda4d32df4', '1464822759023-fed622ff2c3b', '1566073771259-6a8506099945'];
const heroUrl = s => s.includes('/') ? s : U(s, 1900);
const GALLERY = [
  ['1571896349842-33c89424de2d', 'Бассейн'], ['1445019980597-93fa8acb246c', 'Фасад'], ['1517248135467-4c7edcad34c4', 'Ресторан'],
  ['1540555700478-4be289fbecef', 'Спа'], ['1551882547-ff40c63fe5fa', 'Лобби'], ['1507525428034-b723cf961d3e', 'Пляж'],
  ['1544161515-4ab6ce6db874', 'Массаж'], ['1559339352-11d035aa65de', 'Бар']
];
const REVIEWS = [
  ['Лучший отель, где мне доводилось останавливаться. Вид с балкона — как с открытки, а персонал знал нас по именам уже на второй день.', 'Анна К.', 'Москва', '1494790108377-be9c29b29330'],
  ['Идеально для семейного отпуска: детская зона, спа для родителей и потрясающие завтраки. Обязательно вернёмся.', 'Дмитрий и Ольга', 'Санкт-Петербург', '1500648767791-00dcc994a43e'],
  ['Бронирование заняло минуту, а встреча в аэропорту и трансфер были безупречны. Президентский люкс стоит каждой копейки.', 'Marc L.', 'Paris', '1507003211169-0a1dd7228f2d']
];

/* ---------- state ---------- */
const store = { get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
let bookings = store.get('tengri_bookings') || []; // [{code,email}] kept in this browser; details come from the server
const STATUS_RU = { new: 'Ожидает подтверждения', confirmed: 'Подтверждена', checked_in: 'Проживание', checked_out: 'Завершена', cancelled: 'Отменена' };
const api = async (url, body) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Ошибка сервера');
  return d;
};
const st = { adults: 2, kids: 0, filter: 'all', sort: 'rec', room: null };

const fmt = d => d.toISOString().slice(0, 10);
const today = new Date(); const tomorrow = new Date(Date.now() + 864e5);
const inEl = $('#checkIn'), outEl = $('#checkOut');
inEl.min = fmt(today); inEl.value = fmt(new Date(Date.now() + 864e5 * 7));
outEl.value = fmt(new Date(Date.now() + 864e5 * 10)); outEl.min = fmt(tomorrow);
const nights = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 864e5));
const dateRu = s => new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800); }

/* images with graceful fallback */
const img = (id, w, alt = '') => `<img src="${U(id, w)}" alt="${alt}" loading="lazy" onerror="this.style.opacity=0">`;

/* ---------- hero slideshow ---------- */
const slides = $('#slides');
HERO.forEach((id, i) => { const d = document.createElement('div'); d.className = 'slide' + (i ? '' : ' on'); d.style.backgroundImage = `url(${heroUrl(id)})`; slides.appendChild(d); });
/* warm effects (glow, mist, water, dust) belong to the steppe photo only */
const fxEls = $$('.fx'); const setFx = on => fxEls.forEach(e => e.style.opacity = on ? '' : 0);
fxEls.forEach(e => e.style.transition = 'opacity 1.6s');
let si = 0; setInterval(() => { const s = $$('.slide'); s[si].classList.remove('on'); si = (si + 1) % s.length; s[si].classList.add('on'); setFx(si === 0); }, 9000);

/* floating golden dust drifting through the light */
(() => {
  const cv = $('#dust'), c = cv.getContext('2d'); let W, H, ps = [];
  const size = () => { W = cv.width = cv.offsetWidth; H = cv.height = cv.offsetHeight; };
  size(); addEventListener('resize', size);
  const mk = () => ({ x: Math.random() * W, y: H * (.35 + Math.random() * .6), r: Math.random() * 2 + .6, vx: -(Math.random() * .5 + .15), vy: -(Math.random() * .15), a: Math.random() * .6 + .2, p: Math.random() * 6.28 });
  ps = Array.from({ length: 90 }, mk);
  (function tick() {
    c.clearRect(0, 0, W, H);
    ps.forEach(p => {
      p.x += p.vx; p.y += p.vy + Math.sin(p.p += .01) * .15;
      if (p.x < -10 || p.y < H * .25) Object.assign(p, mk(), { x: W + 10 });
      c.beginPath(); c.fillStyle = `rgba(255,220,160,${p.a * (.6 + .4 * Math.sin(p.p * 2))})`; c.arc(p.x, p.y, p.r, 0, 6.28); c.fill();
    });
    requestAnimationFrame(tick);
  })();
})();

/* ---------- rooms ---------- */
const TYPE = { standard: 'Стандарт', deluxe: 'Делюкс', suite: 'Люкс' };
let loadSeq = 0, loadTimer;
async function loadRooms() {
  clearTimeout(loadTimer);
  const seq = ++loadSeq, q = nights(inEl.value, outEl.value) > 0 ? `?checkIn=${inEl.value}&checkOut=${outEl.value}` : '';
  try { const d = await api('/api/rooms' + q); if (seq !== loadSeq) return; ROOMS = d.rooms; draw(); }
  catch (e) { $('#roomsGrid').innerHTML = '<p class="empty" style="grid-column:1/-1">Не удалось загрузить номера. Обновите страницу.</p>'; }
}
const loadSoon = () => { clearTimeout(loadTimer); loadTimer = setTimeout(loadRooms, 250); };
function draw() {
  let list = ROOMS.filter(r => st.filter === 'all' || r.type === st.filter).filter(r => r.guests >= st.adults + st.kids);
  if (st.sort === 'asc') list.sort((a, b) => a.price - b.price);
  if (st.sort === 'desc') list.sort((a, b) => b.price - a.price);
  const n = nights(inEl.value, outEl.value);
  $('#roomsSub').textContent = n > 0 ? `${dateRu(inEl.value)} — ${dateRu(outEl.value)} · ${n} ноч. · ${st.adults + st.kids} гост.` : 'Выберите корректные даты.';
  const g = $('#roomsGrid');
  g.innerHTML = list.length ? list.map((r, i) => `
    <article class="room reveal ${r.available === 0 ? 'unavail' : ''}" style="transition-delay:${i * 70}ms" data-id="${r.id}">
      <div class="pic">${img(r.imgs[0], 800, esc(r.name))}<span class="tag">${esc(TYPE[r.type] || r.type)}</span><span class="rate"><i>★</i> ${esc(r.rating)}</span></div>
      <div class="body">
        <h3>${esc(r.name)}</h3>
        <div class="specs"><span>📐 ${esc(r.size)} м²</span><span>👥 до ${esc(r.guests)}</span><span>🛏 ${esc(r.bed)}</span><span>🌅 ${esc(r.view)}</span></div>
        <div class="foot"><div class="price"><b>${money(r.price)}</b><small>за ночь${n > 0 ? ` · итого ${money(r.price * n)}` : ''}</small></div><span class="mini-btn">${r.available === 0 ? 'Нет мест на даты' : 'Подробнее'}</span></div>
      </div>
    </article>`).join('') : '<p class="empty" style="grid-column:1/-1">Нет номеров для такого числа гостей. Попробуйте изменить параметры.</p>';
  $$('.room', g).forEach(el => { el.addEventListener('click', () => openRoom(+el.dataset.id)); io.observe(el); });
}
$('#chips').addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; $$('.chip').forEach(x => x.classList.remove('active')); c.classList.add('active'); st.filter = c.dataset.f; draw(); });
$('#sortSel').addEventListener('change', e => { st.sort = e.target.value; draw(); });

/* steppers & search */
$$('.stepper button').forEach(b => b.addEventListener('click', () => {
  const t = b.dataset.t, v = st[t] + +b.dataset.step;
  const max = t === 'adults' ? 6 : 4, min = t === 'adults' ? 1 : 0;
  st[t] = Math.min(max, Math.max(min, v)); $('#' + t).textContent = st[t]; draw();
}));
inEl.addEventListener('change', () => {
  const min = new Date(new Date(inEl.value).getTime() + 864e5); outEl.min = fmt(min);
  if (new Date(outEl.value) <= new Date(inEl.value)) outEl.value = fmt(min); loadRooms();
});
outEl.addEventListener('change', loadRooms);
$('#searchForm').addEventListener('submit', e => { e.preventDefault(); if (nights(inEl.value, outEl.value) < 1) return toast('Выезд должен быть позже заезда'); loadRooms(); $('#rooms').scrollIntoView({ behavior: 'smooth' }); });

/* ---------- room modal + booking ---------- */
const modal = $('#roomModal');
function openRoom(id) {
  const r = ROOMS.find(x => x.id === id); st.room = r;
  setMainImg(r.imgs[0]);
  $('#mThumbs').innerHTML = r.imgs.map((x, i) => `<img src="${U(x, 300)}" class="${i ? '' : 'on'}" data-i="${x}" alt="">`).join('');
  $$('#mThumbs img').forEach(t => t.onclick = () => { $$('#mThumbs img').forEach(a => a.classList.remove('on')); t.classList.add('on'); setMainImg(t.dataset.i); });
  $('#mRight').innerHTML = `
    <p class="eyebrow dark" style="margin:0">${esc(TYPE[r.type] || r.type)} · ★ ${esc(r.rating)}</p>
    <h3>${esc(r.name)}</h3><p>${esc(r.desc)}</p>
    <div class="feat">${r.feats.map(f => `<span>${esc(f)}</span>`).join('')}</div>
    <div class="m-dates"><label>Заезд<input type="date" id="mIn" value="${inEl.value}" min="${fmt(today)}"></label><label>Выезд<input type="date" id="mOut" value="${outEl.value}" min="${outEl.min}"></label></div>
    <div class="guest-form"><input id="gName" placeholder="Имя и фамилия" autocomplete="name"><input id="gEmail" type="email" placeholder="Email" autocomplete="email"><input id="gPhone" type="tel" placeholder="Телефон" autocomplete="tel"></div>
    <div class="summary" id="sum"></div>
    <div class="err" id="err"></div>
    <button class="primary-btn" id="bookBtn">Подтвердить бронирование</button>`;
  $('#mIn').onchange = () => { const m = new Date(new Date($('#mIn').value).getTime() + 864e5); $('#mOut').min = fmt(m); if (new Date($('#mOut').value) <= new Date($('#mIn').value)) $('#mOut').value = fmt(m); sum(); };
  $('#mOut').onchange = sum; sum();
  $('#bookBtn').onclick = book;
  modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
}
function setMainImg(id) { $('#mImg').style.backgroundImage = `url(${U(id, 1000)})`; }
async function sum() {
  const r = st.room, n = nights($('#mIn').value, $('#mOut').value), sub = r.price * n, tax = Math.round(sub * .1);
  $('#sum').innerHTML = `<div><span>${money(r.price)} × ${n} ноч.</span><span>${money(sub)}</span></div><div><span>Налоги и сборы (10%)</span><span>${money(tax)}</span></div><div class="total"><span>Итого</span><b>${money(sub + tax)}</b></div>`;
  if (n < 1) return;
  const i = $('#mIn').value, o = $('#mOut').value;
  try { // live availability for the chosen dates
    const d = await api(`/api/rooms?checkIn=${i}&checkOut=${o}`); if ($('#mIn')?.value !== i || $('#mOut')?.value !== o) return;
    const me = d.rooms.find(x => x.id === r.id); $('#err').textContent = me && me.available === 0 ? 'На эти даты номер занят. Выберите другие даты.' : '';
  } catch {}
}
async function book() {
  const name = $('#gName').value.trim(), email = $('#gEmail').value.trim(), phone = $('#gPhone').value.trim();
  const n = nights($('#mIn').value, $('#mOut').value), err = $('#err'), btn = $('#bookBtn');
  if (n < 1) return err.textContent = 'Проверьте даты проживания.';
  if (name.length < 2) return err.textContent = 'Введите имя и фамилию.';
  if (!/^\S+@\S+\.\S+$/.test(email)) return err.textContent = 'Введите корректный email.';
  if (phone.replace(/\D/g, '').length < 7) return err.textContent = 'Введите корректный телефон.';
  const r = st.room; err.textContent = ''; btn.disabled = true; btn.textContent = 'Отправляем…';
  let b;
  try { ({ booking: b } = await api('/api/bookings', { roomId: r.id, checkIn: $('#mIn').value, checkOut: $('#mOut').value, adults: st.adults, kids: st.kids, name, email, phone })); }
  catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Подтвердить бронирование'; return; }
  bookings.unshift({ code: b.code, email }); store.set('tengri_bookings', bookings); updateCount(); loadRooms();
  $('#mRight').innerHTML = `<div class="success">
    <svg class="check" viewBox="0 0 100 100"><circle cx="50" cy="50" r="41"/><path d="M30 52l14 14 27-30"/></svg>
    <h3>Бронь принята!</h3><p>Спасибо, ${esc(name.split(' ')[0])}. Мы свяжемся с вами для подтверждения. Сохраните код брони.</p>
    <div class="code">${esc(b.code)}</div>
    <p>${esc(b.room)}<br>${dateRu(b.checkIn)} — ${dateRu(b.checkOut)} · ${money(b.total)}</p>
    <button class="primary-btn" data-close style="width:auto">Отлично</button></div>`;
  $('#mRight [data-close]').onclick = closeModal; confetti();
}
function closeModal() { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }
modal.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeDrawer(); } });

/* ---------- drawer ---------- */
const drawer = $('#drawer'), dBg = $('#drawerBg');
function updateCount() { $('#bookCount').textContent = bookings.length; }
async function renderDrawer() {
  const body = $('#drawerBody');
  if (!bookings.length) { body.innerHTML = '<p class="empty">Пока нет бронирований.<br>Выберите номер и забронируйте его.</p>'; return; }
  body.innerHTML = '<p class="empty">Загружаем…</p>';
  let list = [];
  try { list = (await api('/api/bookings/lookup', { items: bookings })).bookings; } catch (e) { body.innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
  const room = id => ROOMS.find(r => r.id === id);
  body.innerHTML = list.length ? list.map(b => `
    <div class="bk">${room(b.roomId) ? img(room(b.roomId).imgs[0], 300) : ''}<div><b>${esc(b.room)}</b>${dateRu(b.checkIn)} — ${dateRu(b.checkOut)}<br>${b.nights} ноч. · ${money(b.total)}<br><small>Код: ${esc(b.code)} · ${esc(STATUS_RU[b.status] || b.status)}</small><br>${['new', 'confirmed'].includes(b.status) ? `<button data-code="${esc(b.code)}">Отменить</button>` : ''}</div></div>`).join('')
    : '<p class="empty">Бронирования не найдены.</p>';
  $$('#drawerBody button').forEach(btn => btn.onclick = async () => {
    const it = bookings.find(x => x.code === btn.dataset.code); if (!it || !confirm('Отменить бронирование?')) return;
    try { await api('/api/bookings/cancel', it); toast('Бронирование отменено'); loadRooms(); renderDrawer(); } catch (e) { toast(e.message); }
  });
}
function openDrawer() { renderDrawer(); drawer.classList.add('open'); dBg.classList.add('open'); }
function closeDrawer() { drawer.classList.remove('open'); dBg.classList.remove('open'); }
$('#myBookingsBtn').onclick = openDrawer; $('#drawerClose').onclick = closeDrawer; dBg.onclick = closeDrawer;

/* ---------- gallery & reviews ---------- */
const hs = [1, 1.3, 0.85, 1.15, 1, 1.35, 0.9, 1.1];
$('#galleryGrid').innerHTML = GALLERY.map(([id, t], i) => `<div class="g-item reveal" style="transition-delay:${(i % 3) * 100}ms">${img(id, 800, t)}<span>${t}</span></div>`).join('');
$('#reviewTrack').innerHTML = REVIEWS.map(([q, n, c, a]) => `<div class="review"><div class="stars">★★★★★</div><blockquote>«${q}»</blockquote><div class="who">${img(a, 120, n)}<div><b>${n}</b><small>${c}</small></div></div></div>`).join('');
$('#reviewDots').innerHTML = REVIEWS.map((_, i) => `<button class="${i ? '' : 'on'}" data-i="${i}" aria-label="Отзыв ${i + 1}"></button>`).join('');
let ri = 0; const goReview = i => { ri = i; $('#reviewTrack').style.transform = `translateX(-${i * 100}%)`; $$('#reviewDots button').forEach((d, j) => d.classList.toggle('on', j === i)); };
$$('#reviewDots button').forEach(d => d.onclick = () => goReview(+d.dataset.i));
setInterval(() => goReview((ri + 1) % REVIEWS.length), 7000);

/* ---------- reveal, counters, nav ---------- */
const io = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return; e.target.classList.add('in'); io.unobserve(e.target);
  const c = $('[data-count]', e.target); if (c) count(c);
}), { threshold: .15 });
function count(el) {
  const to = +el.dataset.count, dec = +(el.dataset.dec || 0), t0 = performance.now();
  const step = t => { const p = Math.min(1, (t - t0) / 1600), v = to * (1 - Math.pow(1 - p, 3)); el.textContent = v.toFixed(dec); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
$$('.reveal').forEach(el => io.observe(el));

const nav = $('#nav');
addEventListener('scroll', () => { nav.classList.toggle('scrolled', scrollY > 60); const h = $('.hero-content'); if (scrollY < innerHeight) h.style.transform = `translateY(${scrollY * .25}px)`; h.style.opacity = 1 - scrollY / (innerHeight * .9); }, { passive: true });
$('#burger').onclick = () => $('#navLinks').classList.toggle('open');
$$('#navLinks a').forEach(a => a.onclick = () => $('#navLinks').classList.remove('open'));

/* confetti */
function confetti() {
  const cv = document.createElement('canvas'); Object.assign(cv.style, { position: 'fixed', inset: 0, zIndex: 300, pointerEvents: 'none' });
  cv.width = innerWidth; cv.height = innerHeight; document.body.appendChild(cv);
  const c = cv.getContext('2d'), cols = ['#b8935a', '#d9b97f', '#fff', '#12110f', '#e8d3a8'];
  const ps = Array.from({ length: 140 }, () => ({ x: innerWidth / 2, y: innerHeight / 2, vx: (Math.random() - .5) * 18, vy: Math.random() * -16 - 4, s: Math.random() * 8 + 4, r: Math.random() * 6, c: cols[Math.random() * cols.length | 0] }));
  let f = 0; (function tick() {
    c.clearRect(0, 0, cv.width, cv.height);
    ps.forEach(p => { p.vy += .35; p.x += p.vx; p.y += p.vy; p.r += .2; c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.fillStyle = p.c; c.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); c.restore(); });
    if (++f < 150) requestAnimationFrame(tick); else cv.remove();
  })();
}


/* living page background: slow zoom, crossfade between photos */
(() => {
  const sl = $$('.pb-slide'); if (!sl.length) return;
  sl.forEach(e => { e.style.backgroundImage = `url(${heroUrl(e.dataset.img)})`; });
  let k = 0; setInterval(() => { sl[k].classList.remove('on'); k = (k + 1) % sl.length; sl[k].classList.add('on'); }, 14000);
})();

/* init */
loadRooms(); updateCount();
addEventListener('load', () => setTimeout(() => $('#loader').classList.add('hide'), 700));
})();
