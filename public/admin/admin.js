(() => {
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Number(n || 0).toLocaleString('en-US');
const dateRu = s => new Date(s + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const ST = { new: 'Новая', confirmed: 'Подтверждена', checked_in: 'Заселён', checked_out: 'Выехал', cancelled: 'Отменена' };
const badge = s => `<span class="badge s-${esc(s)}">${esc(ST[s] || s)}</span>`;
let me = null, view = 'dash', timer = null;

async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && me) { me = null; showLogin(); throw new Error('Сессия истекла. Войдите снова.'); }
  if (!r.ok) throw new Error(d.error || 'Ошибка');
  return d;
}
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800); }
function dialog(html) { $('#dlg').innerHTML = html; $('#dlgBg').hidden = false; }
const closeDlg = () => { $('#dlgBg').hidden = true; $('#dlg').innerHTML = ''; };
$('#dlgBg').addEventListener('mousedown', e => { if (e.target.id === 'dlgBg') closeDlg(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDlg(); });

/* ---------- auth ---------- */
function showLogin() { clearInterval(timer); $('#app').hidden = true; $('#login').hidden = false; $('#lPass').value = ''; }
async function enter(user) {
  me = user; $('#login').hidden = true; $('#app').hidden = false;
  $('#meName').textContent = user.name; $('#meRole').textContent = user.role === 'admin' ? 'Администратор' : 'Сотрудник';
  $$('[data-admin]').forEach(b => b.hidden = user.role !== 'admin');
  go('dash'); clearInterval(timer); timer = setInterval(() => { if (!$('#dlgBg').hidden) return; if (view === 'dash' || view === 'bookings') go(view, true); refreshPill(); }, 30000);
}
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('#lErr').textContent = '';
  try { const d = await api('/api/admin/login', 'POST', { username: $('#lUser').value, password: $('#lPass').value }); enter(d.user); }
  catch (er) { $('#lErr').textContent = er.message; }
});
$('#logoutBtn').onclick = async () => { await api('/api/admin/logout', 'POST').catch(() => {}); me = null; showLogin(); };
$('#pwBtn').onclick = () => {
  dialog(`<h2>Смена пароля</h2><label>Текущий пароль<input id="pOld" type="password" autocomplete="current-password"></label><label>Новый пароль (от 8 символов)<input id="pNew" type="password" autocomplete="new-password"></label><div class="err" id="pErr"></div><div class="acts"><button class="btn" id="x">Отмена</button><button class="btn primary" id="ok">Сохранить</button></div>`);
  $('#x').onclick = closeDlg;
  $('#ok').onclick = async () => { try { await api('/api/admin/password', 'POST', { old: $('#pOld').value, new: $('#pNew').value }); closeDlg(); toast('Пароль изменён'); } catch (e) { $('#pErr').textContent = e.message; } };
};
$('#menu').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.v); });
async function refreshPill() { try { const s = await api('/api/admin/stats'); const p = $('#newPill'); p.hidden = !s.newCount; p.textContent = s.newCount; } catch {} }

/* ---------- views ---------- */
const TITLES = { dash: 'Панель', bookings: 'Бронирования', calendar: 'Календарь занятости', rooms: 'Номера и цены', users: 'Сотрудники' };
async function go(v, silent) {
  view = v; $$('#menu button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('#title').textContent = TITLES[v]; if (!silent) { $('#topActions').innerHTML = ''; $('#view').innerHTML = '<p class="empty">Загрузка…</p>'; }
  try { await ({ dash, bookings, calendar, rooms, users }[v])(); } catch (e) { $('#view').innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  refreshPill();
}
const topBtn = (label, fn) => { $('#topActions').innerHTML = `<button class="btn primary" id="topBtn">${label}</button>`; $('#topBtn').onclick = fn; };

async function dash() {
  const s = await api('/api/admin/stats'), max = Math.max(1, ...s.series.map(x => x.count));
  const rows = list => list.length ? list.map(b => `<tr class="click" data-id="${b.id}"><td><span class="code">${esc(b.code)}</span></td><td>${esc(b.guest_name)}<small>${esc(b.room_name)}</small></td><td>${dateRu(b.check_in)}</td><td>${badge(b.status)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">Пока пусто</td></tr>';
  $('#view').innerHTML = `
    <div class="cards">
      <div class="card stat hl"><small>Новые брони (ждут подтверждения)</small><b>${s.newCount}</b></div>
      <div class="card stat"><small>Заезды сегодня</small><b>${s.arrivals}</b></div>
      <div class="card stat"><small>Выезды сегодня</small><b>${s.departures}</b></div>
      <div class="card stat"><small>Сейчас проживают</small><b>${s.inHouse}</b></div>
      <div class="card stat"><small>Загрузка сегодня (${s.occupied} из ${s.totalUnits})</small><b>${s.occupancy}%</b></div>
      <div class="card stat"><small>Выручка за месяц (по заездам)</small><b>${money(s.revenueMonth)}</b></div>
    </div>
    <div class="card" style="margin-bottom:16px"><h3>Новые брони за 14 дней</h3><div class="bars">${s.series.map(x => `<div style="height:${x.count / max * 100}%" data-t="${dateRu(x.date)}: ${x.count}"></div>`).join('')}</div></div>
    <div class="grid2">
      <div class="card"><h3>Ближайшие заезды</h3><div class="tbl-wrap" style="box-shadow:none"><table><tbody>${rows(s.upcoming)}</tbody></table></div></div>
      <div class="card"><h3>Последние брони</h3><div class="tbl-wrap" style="box-shadow:none"><table><tbody>${rows(s.recent)}</tbody></table></div></div>
    </div>`;
  $$('#view tr.click').forEach(tr => tr.onclick = () => openBooking(+tr.dataset.id));
  topBtn('+ Новая бронь', newBooking);
}

let bFilter = { status: '', q: '' };
async function bookings() {
  topBtn('+ Новая бронь', newBooking);
  if (!$('#bTable')) {
    $('#view').innerHTML = `<div class="tools"><input id="bQ" placeholder="Поиск: имя, код, email, телефон" value="${esc(bFilter.q)}"><select id="bS"><option value="">Все статусы</option>${Object.entries(ST).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div class="tbl-wrap"><table><thead><tr><th>Код</th><th>Гость</th><th>Номер</th><th>Заезд — выезд</th><th>Сумма</th><th>Статус</th></tr></thead><tbody id="bTable"></tbody></table></div>`;
    $('#bS').value = bFilter.status; let t;
    $('#bQ').oninput = e => { bFilter.q = e.target.value; clearTimeout(t); t = setTimeout(bookings, 300); };
    $('#bS').onchange = e => { bFilter.status = e.target.value; bookings(); };
  }
  const p = new URLSearchParams({ status: bFilter.status, q: bFilter.q });
  const { bookings: list } = await api('/api/admin/bookings?' + p);
  $('#bTable').innerHTML = list.length ? list.map(b => `<tr class="click" data-id="${b.id}"><td><span class="code">${esc(b.code)}</span></td><td>${esc(b.guest_name)}<small>${esc(b.phone)}</small></td><td>${esc(b.room_name)}</td><td>${dateRu(b.check_in)} — ${dateRu(b.check_out)}<small>${b.nights} ноч. · ${b.adults + b.kids} гост.</small></td><td>${money(b.total)}</td><td>${badge(b.status)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">Бронирований не найдено</td></tr>';
  $$('#bTable tr.click').forEach(tr => tr.onclick = () => openBooking(+tr.dataset.id, list));
}

async function openBooking(id, list) {
  if (!list) list = (await api('/api/admin/bookings')).bookings;
  const b = list.find(x => x.id === id); if (!b) return toast('Бронь не найдена');
  dialog(`<h2>Бронь <span class="code">${esc(b.code)}</span></h2>
    <div class="kv"><span>Гость</span><b>${esc(b.guest_name)}</b><span>Телефон</span><a href="tel:${esc(b.phone)}">${esc(b.phone)}</a><span>Email</span><a href="mailto:${esc(b.email)}">${esc(b.email)}</a><span>Номер</span>${esc(b.room_name)}<span>Даты</span>${dateRu(b.check_in)} — ${dateRu(b.check_out)} (${b.nights} ноч.)<span>Гости</span>${b.adults} взр., ${b.kids} дет.<span>Сумма</span><b>${money(b.total)}</b><span>Источник</span>${b.source === 'staff' ? 'Сотрудник' : 'Сайт'} · ${esc(b.created_at)} UTC</div>
    <label>Статус<select id="dS">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${k === b.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>Заметки для персонала<textarea id="dN" rows="3" maxlength="500">${esc(b.notes)}</textarea></label>
    <div class="err" id="dE"></div>
    <div class="acts"><button class="btn" id="x">Закрыть</button><button class="btn primary" id="ok">Сохранить</button></div>`);
  $('#x').onclick = closeDlg;
  $('#ok').onclick = async () => { try { await api('/api/admin/bookings/' + b.id, 'PATCH', { status: $('#dS').value, notes: $('#dN').value }); closeDlg(); toast('Сохранено'); go(view, true); } catch (e) { $('#dE').textContent = e.message; } };
}

async function newBooking() {
  const { rooms } = await api('/api/admin/rooms'), t = new Date().toISOString().slice(0, 10), t2 = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  dialog(`<h2>Новая бронь</h2><p class="muted">Для гостей, позвонивших или пришедших на ресепшен. Бронь сразу подтверждена.</p>
    <label>Номер<select id="nR">${rooms.filter(r => r.active).map(r => `<option value="${r.id}">${esc(r.name)} — ${money(r.price)}/ночь</option>`).join('')}</select></label>
    <div class="row2"><label>Заезд<input id="nI" type="date" value="${t}"></label><label>Выезд<input id="nO" type="date" value="${t2}"></label></div>
    <div class="row2"><label>Взрослые<input id="nA" type="number" min="1" max="10" value="2"></label><label>Дети<input id="nK" type="number" min="0" max="10" value="0"></label></div>
    <label>Имя и фамилия<input id="nN"></label><div class="row2"><label>Телефон<input id="nP" type="tel"></label><label>Email<input id="nE" type="email"></label></div>
    <div class="err" id="nErr"></div><div class="acts"><button class="btn" id="x">Отмена</button><button class="btn primary" id="ok">Создать</button></div>`);
  $('#x').onclick = closeDlg;
  $('#ok').onclick = async () => {
    try {
      const { booking } = await api('/api/admin/bookings', 'POST', { roomId: +$('#nR').value, checkIn: $('#nI').value, checkOut: $('#nO').value, adults: +$('#nA').value, kids: +$('#nK').value, name: $('#nN').value, phone: $('#nP').value, email: $('#nE').value });
      closeDlg(); toast('Бронь создана: ' + booking.code); go(view, true);
    } catch (e) { $('#nErr').textContent = e.message; }
  };
}

let calMonth = new Date().toISOString().slice(0, 7);
async function calendar() {
  const d = await api('/api/admin/calendar?month=' + calMonth);
  const shift = n => { const [y, m] = calMonth.split('-').map(Number); calMonth = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); calendar(); };
  const title = new Date(calMonth + '-01T00:00:00Z').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const todayIdx = calMonth === new Date().toISOString().slice(0, 7) ? new Date().getUTCDate() - 1 : -1;
  $('#topActions').innerHTML = `<div class="cal-nav"><button class="btn sm" id="pv">←</button><b>${esc(title)}</b><button class="btn sm" id="nx">→</button></div>`;
  $('#pv').onclick = () => shift(-1); $('#nx').onclick = () => shift(1);
  const cls = (busy, units) => busy === 0 ? '' : busy >= units ? 'full' : busy / units >= .5 ? 'f2' : 'f1';
  $('#view').innerHTML = `<div class="tbl-wrap" style="padding:14px"><table class="cal"><thead><tr><th></th>${Array.from({ length: d.days }, (_, i) => `<th ${i === todayIdx ? 'style="color:var(--gold);font-weight:700"' : ''}>${i + 1}</th>`).join('')}</tr></thead><tbody>${d.rooms.map(r => `<tr><td class="nm">${esc(r.name)} <small style="display:inline;color:var(--muted)">(${r.units})</small></td>${r.busy.map(b => `<td class="c ${cls(b, r.units)}" title="Занято ${b} из ${r.units}">${b || ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
  <div class="legend"><span><i style="background:#f1ede4"></i>свободно</span><span><i style="background:#dcf2e6"></i>занято менее половины</span><span><i style="background:#f6df9e"></i>больше половины</span><span><i style="background:#e9988c"></i>всё занято</span><span>Цифра — сколько номеров этого типа занято в день</span></div>`;
}

async function rooms() {
  const { rooms: list } = await api('/api/admin/rooms'), isAdmin = me.role === 'admin';
  $('#view').innerHTML = `${isAdmin ? '' : '<p class="muted" style="margin-bottom:12px">Изменять номера и цены может только администратор.</p>'}<div class="tbl-wrap"><table><thead><tr><th>Номер</th><th>Тип</th><th>Цена за ночь, $</th><th>Количество номеров</th><th>На сайте</th><th></th></tr></thead><tbody>${list.map(r => `<tr data-id="${r.id}"><td>${esc(r.name)}<small>до ${r.guests} гост. · ${r.size} м²</small></td><td>${esc(r.type)}</td><td><input class="inl" type="number" min="1" value="${r.price}" data-f="price" ${isAdmin ? '' : 'disabled'}></td><td><input class="inl" type="number" min="0" value="${r.units}" data-f="units" ${isAdmin ? '' : 'disabled'}></td><td><input class="switch" type="checkbox" data-f="active" ${r.active ? 'checked' : ''} ${isAdmin ? '' : 'disabled'}></td><td>${isAdmin ? '<button class="btn sm primary">Сохранить</button>' : ''}</td></tr>`).join('')}</tbody></table></div>`;
  $$('#view tbody tr').forEach(tr => { const b = $('button', tr); if (b) b.onclick = async () => {
    const body = {}; $$('[data-f]', tr).forEach(i => body[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value);
    try { await api('/api/admin/rooms/' + tr.dataset.id, 'PATCH', body); toast('Сохранено'); } catch (e) { toast(e.message); }
  }; });
}

async function users() {
  const { users: list } = await api('/api/admin/users');
  topBtn('+ Добавить сотрудника', () => {
    dialog(`<h2>Новый сотрудник</h2><label>Имя<input id="uN"></label><label>Логин (латиница)<input id="uL" autocomplete="off"></label><label>Пароль (от 8 символов)<input id="uP" type="password" autocomplete="new-password"></label><label>Роль<select id="uR"><option value="staff">Сотрудник (брони, календарь)</option><option value="admin">Администратор (всё, включая цены и сотрудников)</option></select></label><div class="err" id="uE"></div><div class="acts"><button class="btn" id="x">Отмена</button><button class="btn primary" id="ok">Создать</button></div>`);
    $('#x').onclick = closeDlg;
    $('#ok').onclick = async () => { try { await api('/api/admin/users', 'POST', { name: $('#uN').value, username: $('#uL').value, password: $('#uP').value, role: $('#uR').value }); closeDlg(); toast('Сотрудник добавлен'); users(); } catch (e) { $('#uE').textContent = e.message; } };
  });
  $('#view').innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>Имя</th><th>Логин</th><th>Роль</th><th></th></tr></thead><tbody>${list.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${u.role === 'admin' ? 'Администратор' : 'Сотрудник'}</td><td>${u.username === me.username ? '<small>это вы</small>' : `<button class="btn sm danger" data-id="${u.id}">Удалить</button>`}</td></tr>`).join('')}</tbody></table></div>`;
  $$('#view button[data-id]').forEach(b => b.onclick = async () => { if (!confirm('Удалить сотрудника?')) return; try { await api('/api/admin/users/' + b.dataset.id, 'DELETE'); toast('Удалён'); users(); } catch (e) { toast(e.message); } });
}

/* ---------- start ---------- */
api('/api/admin/me').then(d => enter(d.user)).catch(() => showLogin());
})();
