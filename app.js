// Интерфейс. Расчёты в core.js, каталог в catalog.js, все данные одним JSON в localStorage.
import { STEP, fmtW, fmtSec, exerciseHistory, fmtSet, suggest, thrFor, parseHR, attachHR } from './core.js';
import { GROUPS, CATALOG } from './catalog.js';

const KEY = 'treni';
const IMG_CACHE = 'treni-img'; // так же в sw.js
const KINDS = { total: 'общий вес', side: 'блины на сторону', added: 'доп. вес на поясе', db: 'гантели', stack: 'вес на стеке', bw: 'свой вес', '?': 'не уточнено' };
const UNIT = { total: 'кг', side: 'кг на сторону', added: 'кг доп.', db: 'кг', stack: 'кг', bw: '', '?': 'кг' };
const ICON_UP = '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_SWAP = '<svg viewBox="0 0 24 24"><path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5"/></svg>';
const CAT = Object.fromEntries(CATALOG.map(c => [c.name, c]));

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const num = v => (v == null || v === '' || !isFinite(+v) ? null : +v);
const isoDay = ts => { const d = new Date(ts); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const dayLabel = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const daysAgo = iso => Math.round((Date.parse(isoDay(Date.now())) - Date.parse(iso)) / 864e5);
const longDate = d => d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const plural = (n, one, few, many) => {
  const m = n % 100, k = n % 10;
  return m > 10 && m < 20 ? many : k === 1 ? one : k > 1 && k < 5 ? few : many;
};
const ago = iso => { const n = daysAgo(iso); return n <= 0 ? 'сегодня' : n === 1 ? 'вчера' : `${n} ${plural(n, 'день', 'дня', 'дней')} назад`; };
const nTrain = n => `${n} ${plural(n, 'тренировка', 'тренировки', 'тренировок')}`;

// Тип веса: выбор в Настройках важнее каталога, «не уточнено» из истории не перебивает каталог
const kindOf = ex => { const k = db.exercises[ex]?.kind; return k && k !== '?' ? k : CAT[ex]?.kind ?? k ?? '?'; };
const groupOf = ex => CAT[ex]?.group ?? db.exercises[ex]?.group;
const muscleOf = ex => CAT[ex]?.muscle ?? groupOf(ex);
const lastOf = ex => exerciseHistory(db.sessions, ex).at(-1);
const doneNames = () => [...new Set(db.sessions.flatMap(s => s.sets.map(x => x.ex)))];
const allExercises = () => [...new Set([...CATALOG.map(c => c.name), ...Object.keys(db.exercises), ...doneNames()])]
  .sort((a, b) => a.localeCompare(b, 'ru'));
// Подтягивания без отягощения и «свой вес» показываем одними повторами
const setText = (x, kind) => esc(kind === 'bw' || (kind === 'added' && !x.w) ? `${x.r ?? '?'}` : `${x.w == null ? '?' : fmtW(x.w)} × ${x.r ?? '?'}`);
const thumb = ex => (CAT[ex] ? `<img class="th" src="img/${CAT[ex].img}-0.jpg" alt="" loading="lazy">` : `<span class="th ph">${esc(ex[0])}</span>`);

const P = (id, name, items) => ({ id, name, items: items.map(([ex, sets, reps]) => ({ ex, sets, reps })) });
const fresh = () => ({
  v: 1,
  exercises: {},
  sessions: [],
  active: null,
  plan: null,
  settings: { thr1: 110, thr2: 115, weekGoal: 1, backupAt: 0 },
  programs: [
    P('A', 'День А', [['Румынская тяга', 3, 8], ['Подтягивания', 3, 8], ['Жим ногами (тележка)', 3, 12], ['Махи на плечи', 3, 12], ['Бицепс', 3, 8]]),
    P('B', 'День Б', [['Приседания', 3, 12], ['Жим наклонный Хаммер', 3, 8], ['Тяга Хаммер на каждую', 3, 12], ['Трицепс (блок)', 3, 8], ['Бицепс', 3, 8]]),
    P('C', 'День В', [['Выпады', 3, 8], ['Жим горизонт Хаммер', 3, 8], ['Тяга Хаммер на обе', 3, 12], ['Бабочка', 3, 10], ['Пресс (мёртвый жук)', 3, 10]]),
  ],
});

// ---------- данные: всё, что пришло из файла, с сервера или из памяти, приводим к ожидаемой форме ----------

const okSession = s => s && typeof s === 'object' && Array.isArray(s.sets) && s.sets.every(x => x && typeof x.ex === 'string');
// Только приводим к числу то, что есть, ничего не дописываем: бэкап после круга импорт-экспорт не меняется
const numKeys = (o, keys) => { const r = { ...o }; for (const k of keys) if (k in r) r[k] = num(r[k]); return r; };
const normSet = x => ({ ...numKeys(x, ['w', 'r', 't']), ex: String(x.ex), warm: !!x.warm });
const normRest = r => ({ ...numKeys(r, ['start', 'end', 'thr', 'peak', 'toThr', 'hrStart']), ex: String(r.ex) });
const normItem = i => ({ ex: String(i?.ex ?? ''), sets: num(i?.sets) || 3, reps: num(i?.reps) || 8 });
const arr = v => (Array.isArray(v) ? v : []);

function normalize(d) {
  const f = fresh();
  d = d && typeof d === 'object' ? d : {};
  const settings = { ...f.settings };
  for (const k of Object.keys(settings)) if (num(d.settings?.[k]) != null) settings[k] = num(d.settings[k]);
  const a = d.active;
  return {
    ...f,
    ...d,
    settings,
    exercises: d.exercises && typeof d.exercises === 'object' && !Array.isArray(d.exercises) ? d.exercises : {},
    sessions: arr(d.sessions).filter(okSession).map(s => ({
      ...s, id: String(s.id), date: typeof s.date === 'string' ? s.date : null, label: String(s.label ?? ''),
      sets: s.sets.map(normSet), rests: arr(s.rests).map(normRest),
    })),
    programs: Array.isArray(d.programs)
      ? d.programs.map(p => ({ id: String(p?.id), name: String(p?.name ?? ''), items: arr(p?.items).map(normItem) }))
      : f.programs,
    plan: d.plan && Array.isArray(d.plan.items) ? { date: String(d.plan.date), items: d.plan.items.map(normItem) } : null,
    active: a && Array.isArray(a.items) && Array.isArray(a.sets)
      ? { ...a, items: a.items.map(normItem), sets: a.sets.map(normSet), rests: arr(a.rests).map(normRest), cur: num(a.cur) || 0 }
      : null,
  };
}

function load() {
  try { return normalize(JSON.parse(localStorage.getItem(KEY))); } catch { return fresh(); }
}

function saveLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast(`Не сохранилось: ${e.message}`); }
}

function save() {
  db.savedAt = Date.now();
  saveLocal();
  schedulePush();
}

let db = load();
let view = { tab: 'today' };
let lock = null;
let lastPage = '';
let lastCur = null;
navigator.storage?.persist?.().catch(() => {});

// Тост с «Вернуть» вместо подтверждений: в зале быстрее отменить, чем каждый раз отвечать «Точно?»
function toast(msg, undo) {
  const t = Object.assign(document.createElement('div'), { className: 'toast glass' });
  t.append(Object.assign(document.createElement('span'), { textContent: msg }));
  if (undo) {
    const b = Object.assign(document.createElement('button'), { className: 'undo', textContent: 'Вернуть' });
    b.onclick = () => { t.remove(); undo(); save(); render(); };
    t.append(b);
  }
  document.body.append(t);
  setTimeout(() => t.remove(), undo ? 6000 : 4000);
}

function countUp() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const el of document.querySelectorAll('[data-count]')) {
    const to = +el.dataset.count, dec = +el.dataset.dec || 0, t0 = performance.now();
    const step = now => {
      const p = Math.min(1, (now - t0) / 900);
      el.textContent = fmtW(+(to * (1 - (1 - p) ** 3)).toFixed(dec));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

async function wake() {
  try { lock = await navigator.wakeLock?.request('screen'); } catch {}
}

// ---------- сервер: файл data.json в закрытом репозитории GitHub ----------
// Ключ, репозиторий и отметка «что уже на сервере» живут отдельно от данных: они про этот телефон, а не про тренировки.
// Новее тот, у кого больше savedAt. GitHub сам не даёт перезаписать файл, который менялся с нашего прошлого чтения
// (sha не совпал, 409): тогда телефон сначала забирает свежее. Каждое сохранение остаётся в истории репозитория.

const SYNC = 'treni-sync';
let meta = {};
try { meta = JSON.parse(localStorage.getItem(SYNC)) || {}; } catch {}
let syncState = '', pushTimer = 0, pushing = false, remoteOffer = null;
const saveMeta = () => { try { localStorage.setItem(SYNC, JSON.stringify(meta)); } catch {} };
const SYNC_TEXT = {
  ok: () => `Всё на сервере${meta.okAt ? `, ${new Date(meta.okAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}`,
  offline: () => 'Нет сети, отправлю, когда появится',
  key: () => 'Ключ не подошёл или истёк',
  norepo: () => 'Репозиторий не найден или ключ к нему не допущен',
  denied: () => 'У ключа нет права записи (Contents: Read and write)',
  size: () => 'Данных больше, чем принимает GitHub. Нужна правка',
  error: () => 'Сервер не ответил, повторю позже',
  '': () => 'Проверяю…',
};

function setSync(s) {
  syncState = s;
  if (s === 'ok') { meta.okAt = Date.now(); saveMeta(); }
  const el = $('#syncst');
  if (el) { el.textContent = SYNC_TEXT[s](); el.className = `sm ${s === 'ok' ? 'ok' : s ? 'warn' : 'muted'}`; }
}

// treni-api подменяется только в автотестах (tools/sync_check.py, локальная заглушка GitHub)
const ghRepo = () => `${localStorage.getItem('treni-api') || 'https://api.github.com'}/repos/${encodeURIComponent(meta.owner)}/${encodeURIComponent(meta.repo)}`;
const fail = code => Object.assign(Error(code), { code });

async function gh(method, path, body) {
  const r = await fetch(ghRepo() + path, {
    method, cache: 'no-store', body: body && JSON.stringify(body),
    headers: { Authorization: `Bearer ${meta.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (r.ok || r.status === 404) return r;
  throw fail({ 401: 'key', 403: 'denied', 409: 'stale', 422: 'stale', 413: 'size' }[r.status] || 'error');
}

const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
function b64enc(s) {
  const b = new TextEncoder().encode(s);
  let out = '';
  for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(out);
}

// Файл с сервера или null, если его ещё нет. Заодно запоминаем его sha: без него GitHub не даст перезаписать
async function readRemote() {
  const r = await gh('GET', '/contents/data.json');
  if (r.status === 404) {
    if ((await gh('GET', '')).status === 404) throw fail('norepo');
    meta.sha = null;
    return null;
  }
  const j = await r.json();
  if (!j.sha) throw fail('error');
  meta.sha = j.sha;
  // Больше 1 МБ GitHub отдаёт без содержимого, тогда качаем по ссылке
  const text = j.content ? b64dec(j.content) : await (await fetch(j.download_url, { cache: 'no-store' })).text();
  return normalize(JSON.parse(text));
}

const failed = e => setSync(!navigator.onLine ? 'offline' : e.code || 'error');

// На тренировке реже: каждое сохранение на GitHub это коммит. Уход с экрана и «Закончить» отправляют сразу
function schedulePush(ms = db.active ? 30000 : 8000) {
  if (!meta.token) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, ms);
}

async function push() {
  clearTimeout(pushTimer);
  if (!meta.token || (db.savedAt || 0) <= (meta.syncedAt || 0)) return;
  if (pushing) return schedulePush(1500);
  pushing = true;
  const at = db.savedAt;
  try {
    const body = { message: `Трени ${isoDay(at)}`, content: b64enc(JSON.stringify(db)), ...(meta.sha ? { sha: meta.sha } : {}) };
    // Ответ обязан вернуть новый sha: страница входа Wi-Fi тоже отвечает 200
    const j = await (await gh('PUT', '/contents/data.json', body)).json();
    if (!j.content?.sha) throw fail('error');
    meta.sha = j.content.sha;
    meta.syncedAt = at;
    setSync('ok');
  } catch (e) {
    if (e.code === 'stale') { pushing = false; return pull(); }
    failed(e);
  } finally { pushing = false; }
}

function takeRemote(remote) {
  db = remote;
  meta.syncedAt = db.savedAt || 0;
  saveLocal();
  setSync('ok');
  render();
}

async function pull() {
  if (!meta.token) return;
  try {
    const remote = await readRemote();
    saveMeta();
    if (!remote) {
      // На сервере пусто: отдаём ему всё, что есть на телефоне
      db.savedAt = Date.now();
      saveLocal();
      return push();
    }
    if (!meta.syncedAt && db.sessions.length) {
      // Первое подключение, а на телефоне свои тренировки: решает человек, двумя явными кнопками
      remoteOffer = remote;
      view.sheet = { t: 'conflict' };
      setSync('');
      return render();
    }
    if (!meta.syncedAt || (remote.savedAt || 0) > (db.savedAt || 0)) return takeRemote(remote);
    if ((db.savedAt || 0) > meta.syncedAt) return push();
    setSync('ok');
  } catch (e) { failed(e); }
}

// ---------- рекорды ----------

// Лучший рабочий подход: самый большой вес, при равном весе больше повторов. Подход без повторов не считается
function bestOf(ex, sessions) {
  let w = -1, r = 0;
  for (const s of sessions) {
    for (const x of s.sets) {
      if (x.ex !== ex || x.warm || x.w == null || !(x.r > 0)) continue;
      if (x.w > w) { w = x.w; r = x.r; } else if (x.w === w && x.r > r) r = x.r;
    }
  }
  return { w, r };
}

// Первый раз в жизни не рекорд: сравнивать не с чем
const recordOf = (x, best) => (best.w < 0 || x.w == null || !(x.r > 0) ? null : x.w > best.w ? 'вес' : x.w === best.w && x.r > best.r ? 'повторы' : null);
const recordText = what => (what === 'вес' ? 'рекорд по весу' : 'рекорд по повторам');

function sessionRecords(k) {
  const s = db.sessions[k], before = db.sessions.slice(0, k), out = [];
  for (const ex of new Set(s.sets.map(x => x.ex))) {
    const top = bestOf(ex, [s]), what = recordOf(top, bestOf(ex, before));
    if (what) out.push({ ex, top, what });
  }
  return out;
}

function celebrate(title, text) {
  const colors = ['#ff375f', '#0a84ff', '#30d158', '#ffd60a', '#bf5af2'];
  const bits = Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2, d = 120 + Math.random() * 120;
    return `<i style="--x:${Math.round(Math.cos(a) * d)}px;--y:${Math.round(Math.sin(a) * d - 80)}px;--r:${Math.round(Math.random() * 720 - 360)}deg;--c:${colors[i % 5]}"></i>`;
  });
  const box = Object.assign(document.createElement('div'), { className: 'confetti' });
  box.innerHTML = `${bits.join('')}<div class="prb glass"><small>${esc(title)}</small><b>${esc(text)}</b></div>`;
  document.body.append(box);
  setTimeout(() => box.remove(), 2800);
}

// ---------- рекомендация ----------

// Ноги, спина, грудь из базовых и две самые отдохнувшие мышцы из плеч, бицепса, трицепса.
// В каждом слоте упражнение из привычных (2+ раза, до 90 дней до последней тренировки), которое делал давнее всего:
// так упражнения чередуются, разовые пробы не всплывают, а после долгого перерыва не всплывает давно брошенное.
function buildPlan() {
  const st = {};
  db.sessions.forEach((s, i) => {
    for (const ex of new Set(s.sets.filter(x => !x.warm).map(x => x.ex))) {
      const o = (st[ex] ||= { n: 0 });
      o.n++;
      o.i = i;
      o.date = s.date;
    }
  });
  const lastDate = db.sessions.map(s => s.date).filter(Boolean).sort().at(-1);
  const recent = ex => st[ex].date && lastDate && (Date.parse(lastDate) - Date.parse(st[ex].date)) / 864e5 < 90;
  const pick = ok => {
    const done = Object.keys(st).filter(ok);
    const pool = [done.filter(ex => recent(ex) && st[ex].n > 1), done.filter(recent), done].find(p => p.length) || [];
    if (pool.length) return pool.sort((a, b) => st[a].i - st[b].i || st[b].n - st[a].n)[0];
    return CATALOG.find(c => ok(c.name))?.name;
  };
  const items = ['legs', 'back', 'chest'].map(g => pick(ex => groupOf(ex) === g && CAT[ex]?.mech !== 'isolation'));
  const of = m => Object.keys(st).filter(ex => muscleOf(ex) === m);
  const lastI = m => Math.max(-1, ...of(m).map(ex => st[ex].i));
  const count = m => of(m).reduce((a, ex) => a + st[ex].n, 0);
  const acc = ['shoulders', 'biceps', 'triceps'].sort((a, b) => lastI(a) - lastI(b) || count(b) - count(a)).slice(0, 2);
  items.push(...acc.map(m => pick(ex => muscleOf(ex) === m)));
  return { date: isoDay(Date.now()), items: items.filter(Boolean).map(guessItem) };
}

// План свой на каждый телефон и каждый день: на сервер не гоним и savedAt не трогаем,
// иначе пересборка плана выглядит как свежие данные и старая копия затирает сервер
function ensurePlan() {
  if (db.plan?.date === isoDay(Date.now())) return;
  db.plan = buildPlan();
  saveLocal();
}

const planName = items => {
  const g = [...new Set(items.map(it => GROUPS[groupOf(it.ex)]).filter(Boolean))].join(', ').toLowerCase();
  return g ? g[0].toUpperCase() + g.slice(1) : 'Тренировка';
};

// ---------- тренировка ----------

// Что подставить в следующий подход: разминку повторяем как в прошлый раз, рабочий вес из подсказки
function draftFor(i) {
  const A = db.active, it = A.items[i];
  if (!it) return null;
  const done = A.sets.filter(s => s.ex === it.ex), d = done.at(-1);
  const prevS = [...db.sessions].reverse().find(s => s.sets.some(x => x.ex === it.ex));
  const p = prevS?.sets.filter(x => x.ex === it.ex)[done.length];
  if (p?.warm && !(d && !d.warm)) return { w: p.w ?? 0, r: p.r ?? it.reps, warm: true };
  if (d && !d.warm) return { w: d.w, r: d.r, warm: false };
  return { w: suggest(lastOf(it.ex), it, kindOf(it.ex)).w ?? 0, r: it.reps, warm: false };
}

// Следующее упражнение, где ещё не все рабочие подходы: сначала ниже по списку, потом пропущенные выше
function nextIdx(A) {
  const left = i => A.sets.filter(s => s.ex === A.items[i].ex && !s.warm).length < A.items[i].sets;
  const keys = [...A.items.keys()];
  return [A.cur, ...keys.filter(i => i > A.cur), ...keys.filter(i => i < A.cur)].find(i => A.items[i] && left(i)) ?? A.cur;
}

function guessItem(ex) {
  const h = lastOf(ex);
  const reps = h ? Math.max(8, ...h.reps.filter(Boolean)) : CAT[ex]?.mech === 'isolation' ? 12 : 8;
  return { ex, sets: Math.max(3, h?.reps.length ?? 0), reps };
}

function startWith(name, program, items) {
  db.active = { program, name, items: items.map(i => ({ ...i })), cur: 0, sets: [], rests: [], rest: null, startedAt: Date.now() };
  db.active.draft = draftFor(0);
  wake();
}

const stepper = (f, v, unit) => `<div class="step">
  <button data-act="step" data-f="${f}" data-d="-1" aria-label="меньше">−</button>
  <label><input data-in="${f}" inputmode="decimal" value="${fmtW(v)}"><small>${unit}</small></label>
  <button data-act="step" data-f="${f}" data-d="1" aria-label="больше">+</button></div>`;

function workoutPage() {
  const A = db.active, n = A.items.length;
  const since = A.resumed || A.startedAt;
  const stale = Date.now() - since > 6 * 36e5 ? `<section class="card glass">
    <p>Тренировка с ${dayLabel(isoDay(A.startedAt))} не закончена.</p>
    <div class="row"><button class="btn primary grow" data-act="finish">Закончить</button><button class="btn grow" data-act="resume">Продолжить</button></div></section>` : '';
  const cards = A.items.map((it, i) => {
    const kind = kindOf(it.ex);
    const done = A.sets.map((s, k) => ({ ...s, k })).filter(s => s.ex === it.ex);
    const work = done.filter(s => !s.warm).length;
    if (i !== A.cur) {
      const chips = done.map(s => `<span class="chip${s.warm ? ' warm' : ''}${s.pr ? ' pr' : ''}">${s.pr ? '★ ' : ''}${setText(s, kind)}</span>`).join('');
      return `<section class="card glass mini${work >= it.sets ? ' done' : ''}" data-act="cur" data-i="${i}">
        <div class="row"><span class="exh">${thumb(it.ex)}<h3>${esc(it.ex)}</h3></span><span class="muted sm num">${work} из ${esc(it.sets)}</span></div>
        ${chips ? `<div class="chips">${chips}</div>` : ''}</section>`;
    }
    const D = A.draft || (A.draft = draftFor(i));
    const chips = done.map(s => `<button class="chip${s.warm ? ' warm' : ''}${s.pr ? ' pr' : ''}" data-act="delset" data-k="${s.k}">${s.pr ? '★ ' : ''}${setText(s, kind)}</button>`).join('');
    // Пунктиром то, что осталось сделать по прошлому разу: подходы «заполняются» по ходу
    const prevS = [...db.sessions].reverse().find(s => s.sets.some(x => x.ex === it.ex));
    const ghost = (prevS?.sets.filter(x => x.ex === it.ex) || []).slice(done.length)
      .map(s => `<span class="chip ghost">${setText(s, kind)}</span>`).join('');
    return `<section class="card glass cur">
      <div class="row"><button class="exh" data-act="info" data-ex="${esc(it.ex)}">${thumb(it.ex)}<b class="h2">${esc(it.ex)}</b></button>
        <span class="muted sm num">${work} из ${esc(it.sets)}</span></div>
      <p class="muted sm">План ${esc(it.sets)} × ${esc(it.reps)}, отдых до ♥ ${thrFor(i, n, db.settings)}</p>
      <p class="hint">${esc(suggest(lastOf(it.ex), it, kind).text)}</p>
      ${chips + ghost ? `<div class="chips">${chips}${ghost}</div>` : ''}
      <div class="steps">${kind === 'bw' ? '' : stepper('w', D.w, UNIT[kind])}${stepper('r', D.r, 'повторов')}</div>
      <div class="row">
        <button class="toggle${D.warm ? ' on' : ''}" data-act="warm">Разминка</button>
        <button class="btn primary grow done-btn" data-act="done">Сделал</button>
      </div>
      <button class="link swapl" data-act="swap" data-ctx="work" data-i="${i}">${ICON_SWAP} Заменить упражнение</button></section>`;
  }).join('');
  return `<header class="hd"><p class="sub num" id="elapsed"></p><h1 class="t2">${esc(A.name)}</h1></header>
    ${stale}${cards}
    <button class="btn wide" data-act="add" data-ctx="work">Добавить упражнение</button>
    <button class="btn ghost wide" data-act="finish">Закончить тренировку</button>
    ${A.rest ? restOverlay(A) : ''}`;
}

function restOverlay(A) {
  const R = A.rest, last = A.sets.at(-1);
  const ps = [...db.sessions].reverse().find(s => s.rests?.some(r => r.ex === R.ex && r.toThr != null));
  const was = ps && avg(ps.rests.filter(r => r.ex === R.ex && r.toThr != null).map(r => r.toThr));
  const ni = nextIdx(A), it = A.items[ni];
  const doneWork = A.sets.filter(s => s.ex === it.ex && !s.warm).length;
  const left = doneWork < it.sets;
  const nd = ni === A.cur ? A.draft : draftFor(ni);
  const next = left
    ? `Дальше: ${esc(it.ex)}, ${nd.warm ? 'разминка' : `подход ${doneWork + 1} из ${esc(it.sets)}`}, ${setText(nd, kindOf(it.ex))}`
    : 'Всё по плану сделано';
  // Переход на новое упражнение: показываем, как его делать, пока отдыхаешь
  const c = left && ni !== A.cur && CAT[it.ex];
  const media = c ? `<div class="anim next"><img src="img/${c.img}-0.jpg" alt=""><img src="img/${c.img}-1.jpg" alt=""></div>` : '';
  const buttons = left
    ? '<button class="btn primary xl" data-act="go">Иду</button><button class="link" data-act="finish">Закончить тренировку</button>'
    : '<button class="btn primary xl" data-act="finish">Закончить</button><button class="link" data-act="go">Ещё подход</button>';
  return `<div class="rest" role="dialog" aria-label="Отдых">
    <p class="muted">Записал ${last ? setText(last, kindOf(last.ex)) : ''}${last?.warm ? ', разминка' : ''}
      <button class="link inline" data-act="fix">Исправить</button></p>
    <div class="timer" id="timer" data-hint="${was ? Math.round(was) : ''}">0:00</div>
    <p class="thr-t"><span class="heart" aria-hidden="true">♥</span> иди, когда пульс ниже <b>${esc(R.thr)}</b></p>
    ${was ? `<p class="muted sm" id="ready-no">В прошлый раз пульс падал до порога в среднем за ${fmtSec(was)}</p>
      <p class="sm ok" id="ready" hidden>Обычно к этому времени пульс уже ниже ${esc(R.thr)}. Глянь на часы</p>` : ''}
    ${media}<p class="next">${next}</p>
    ${buttons}</div>`;
}

// ---------- сегодня ----------

const weekOf = iso => { const d = new Date(`${iso}T12:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDay(d); };
const prevWeek = wk => { const d = new Date(`${wk}T12:00`); d.setDate(d.getDate() - 7); return isoDay(d); };

function weekCard() {
  // Считаем дни с подходами: пустая запись и две записи за один день не накручивают неделю
  const goal = db.settings.weekGoal, days = {};
  for (const s of db.sessions) if (s.date && s.sets.length) (days[weekOf(s.date)] ||= new Set()).add(s.date);
  const cnt = w => days[w]?.size || 0;
  const wk = weekOf(isoDay(Date.now())), n = cnt(wk);
  // Неделя в процессе серию не рвёт: считаем от неё, только если цель уже взята
  let streak = n >= goal ? 1 : 0;
  for (let w = prevWeek(wk); cnt(w) >= goal; w = prevWeek(w)) streak++;
  const C = 2 * Math.PI * 26, part = Math.min(1, n / goal);
  return `<section class="card glass week">
    <svg class="ring${part >= 1 ? ' full' : ''}" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26"/>
      ${part > 0 ? `<circle class="fg" cx="32" cy="32" r="26" stroke-dasharray="${(part * C).toFixed(1)} ${C.toFixed(1)}" style="--c:${C.toFixed(1)}"/>` : ''}</svg>
    <span class="txt"><b>${n} из ${esc(goal)}</b><small class="muted">${plural(goal, 'тренировка', 'тренировки', 'тренировок')} на этой неделе</small></span>
    <span class="streak${streak ? '' : ' zero'}"><b>${streak}</b><small class="muted">${plural(streak, 'неделя', 'недели', 'недель')} подряд</small></span></section>`;
}

function planRow(it, i) {
  const h = lastOf(it.ex);
  const sub = h ? `${fmtSet(h)}, ${h.session.date ? ago(h.session.date) : h.session.label}` : 'ещё не делал';
  return `<div class="pl">${thumb(it.ex)}
    <button class="txt" data-act="info" data-ex="${esc(it.ex)}"><b>${esc(it.ex)}</b><small class="muted">${esc(sub)}</small></button>
    <button class="ic" data-act="swap" data-ctx="plan" data-i="${i}" aria-label="заменить">${ICON_SWAP}</button>
    <button class="ic" data-act="plandel" data-i="${i}" aria-label="убрать">${ICON_X}</button></div>`;
}

function todayPage() {
  ensurePlan();
  const empty = db.sessions.length ? '' : `<section class="card glass">
    <h2>Начни с истории</h2>
    <p class="muted sm">Подключи сервер в Настройках, история придёт сама. Или загрузи файл history.json.</p>
    <div class="row"><button class="btn primary grow" data-act="tab" data-tab="settings">Подключить</button><button class="btn grow" data-act="imp">Файл</button></div></section>`;
  const items = db.plan.items;
  const plan = `<section class="card glass">
    <div class="row"><h2>Рекомендую</h2><button class="link" data-act="replan">Сбросить</button></div>
    <p class="muted sm">${esc(planName(items))}</p>
    <div class="plist">${items.map(planRow).join('')}</div>
    <button class="link accent" data-act="add" data-ctx="plan">Добавить упражнение</button>
    <button class="btn primary wide" data-act="startplan"${items.length ? '' : ' disabled'}>Начать</button></section>`;
  const progs = db.programs.map(p => `<button class="li" data-act="start" data-id="${esc(p.id)}">
    <span><b>${esc(p.name)}</b><small class="muted">${esc(p.items.map(i => i.ex).join(', '))}</small></span><span class="accent sm">Начать</span></button>`).join('');
  return `<header class="hd"><p class="sub">${longDate(new Date())}</p><h1>Сегодня</h1></header>
    ${empty}${weekCard()}${plan}
    <h4 class="cap">Мои программы</h4><div class="group glass">${progs}</div>`;
}

// ---------- шторки: техника, замена, добавление, выбор данных ----------

function infoSheet(S) {
  const ex = S.ex, c = CAT[ex], h = exerciseHistory(db.sessions, ex);
  const media = c ? `<div class="anim"><img src="img/${c.img}-0.jpg" alt=""><img src="img/${c.img}-1.jpg" alt=""></div>` : '';
  const sub = [GROUPS[groupOf(ex)], ...(c?.muscles || [])].filter(Boolean).join(', ');
  return `${media}<h2>${esc(ex)}</h2><p class="sub">${esc(sub)}</p>
    ${c ? `<ul class="cues">${c.cues.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${h.length ? `<button class="btn wide" data-act="ex" data-ex="${esc(ex)}">История упражнения</button>` : ''}`;
}

const pickRow = ex => {
  const h = lastOf(ex);
  const sub = h ? `${h.session.label}: ${fmtSet(h)}` : (CAT[ex]?.muscles || []).join(', ');
  return `<button class="li" data-act="pick" data-ex="${esc(ex)}">${thumb(ex)}<span class="txt"><b>${esc(ex)}</b><small class="muted">${esc(sub)}</small></span></button>`;
};

// Сначала то, что уже делал (свежее выше), потом остальное из каталога
function sortPick(list) {
  const last = {};
  db.sessions.forEach((s, i) => s.sets.forEach(x => { last[x.ex] = i; }));
  return list.sort((a, b) => (last[b] ?? -1) - (last[a] ?? -1) || a.localeCompare(b, 'ru'));
}

const sheetList = S => (S.ctx === 'work' ? db.active.items : S.ctx === 'plan' ? db.plan.items : db.programs.find(x => x.id === view.prog).items);
// В плане и тренировке не предлагаем то, что там уже есть: учёт подходов идёт по названию
const notInList = S => { const has = new Set(S.ctx === 'prog' ? [] : sheetList(S).map(i => i.ex)); return ex => !has.has(ex); };

function swapSheet(S) {
  const ex = sheetList(S)[S.i].ex;
  const all = allExercises().filter(x => x !== ex && groupOf(x) === groupOf(ex)).filter(notInList(S));
  const same = sortPick(all.filter(x => muscleOf(x) === muscleOf(ex)));
  const other = sortPick(all.filter(x => muscleOf(x) !== muscleOf(ex)));
  return `<h2>Заменить</h2><p class="sub">${esc(ex)}</p>
    ${same.length ? `<h4 class="cap">Те же мышцы</h4><div class="group glass">${same.map(pickRow).join('')}</div>` : ''}
    ${other.length ? `<h4 class="cap">${esc(GROUPS[groupOf(ex)] || 'Ещё')}</h4><div class="group glass">${other.map(pickRow).join('')}</div>` : ''}
    <button class="btn wide" data-act="add" data-ctx="${S.ctx}" data-i="${S.i}" data-swap="1">Другое упражнение</button>`;
}

const addList = S => {
  const q = (S.q || '').trim();
  const list = sortPick(allExercises().filter(notInList(S))
    .filter(x => (!S.g || groupOf(x) === S.g) && (!q || x.toLowerCase().includes(q.toLowerCase()))));
  if (list.length) return list.map(pickRow).join('');
  return q ? `<button class="li accent" data-act="newq">Добавить своё: «${esc(q)}»</button>` : '<p class="muted pad">Ничего не нашлось</p>';
};

function addSheet(S) {
  const chips = [['', 'Все'], ...Object.entries(GROUPS)]
    .map(([k, v]) => `<button class="chip${(S.g || '') === k ? ' on' : ''}" data-act="grp" data-g="${k}">${v}</button>`).join('');
  return `<h2>${S.swap ? 'Заменить на' : 'Добавить упражнение'}</h2>
    <input class="search" data-q placeholder="Поиск" value="${esc(S.q || '')}" autocomplete="off">
    <div class="chips gch">${chips}</div>
    <div class="group glass" id="plist">${addList(S)}</div>`;
}

function conflictSheet() {
  const n = remoteOffer.sessions.length, m = db.sessions.length;
  return `<h2>Чьи данные оставить?</h2>
    <p class="muted sm">Телефон подключается к серверу впервые, а тренировки есть и там, и тут.</p>
    <button class="btn primary wide" data-act="useremote">С сервера: ${nTrain(n)}</button>
    <button class="btn wide" data-act="usephone">С телефона: ${nTrain(m)}</button>
    <p class="muted sm">Вторая кнопка заменит данные на сервере.</p>`;
}

function sheet() {
  const S = view.sheet;
  if (!S) return '';
  const body = { info: infoSheet, swap: swapSheet, add: addSheet, conflict: conflictSheet }[S.t](S);
  return `<div class="sheet-bg" data-act="close"></div>
    <div class="sheet glass" role="dialog"><div class="grab"></div><button class="close ic" data-act="close" aria-label="закрыть">${ICON_X}</button>${body}</div>`;
}

function closeSheet() {
  // Закрыл выбор данных, ничего не выбрав: телефон не подключаем
  if (view.sheet?.t === 'conflict') { meta = {}; saveMeta(); remoteOffer = null; }
  delete view.sheet;
}

// ---------- графики ----------

function chart({ series, thr = [], marks = [], axis = [] }) {
  const all = series.flatMap(s => s.pts);
  if (all.length < 2) return '<p class="muted sm">Пока мало точек для графика</p>';
  const W = 340, H = 150, L = 30;
  const xs = all.map(p => p[0]), ys = [...all.map(p => p[1]), ...thr];
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const lo = Math.min(...ys), hi = Math.max(...ys), pad = (hi - lo) * 0.12 || 1;
  const X = x => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - 6);
  const Y = y => 6 + (1 - (y - lo + pad) / (hi - lo + 2 * pad)) * (H - 12);
  const pt = p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`;
  const grid = [...new Set([hi, lo])].map(v => `<line class="grid" x1="${L}" x2="${W}" y1="${Y(v)}" y2="${Y(v)}"/><text x="0" y="${Y(v) + 3.5}">${fmtW(Math.round(v * 10) / 10)}</text>`);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${grid.join('')}
    ${marks.map(m => `<line class="mark" x1="${X(m)}" x2="${X(m)}" y1="6" y2="${H - 6}"/>`).join('')}
    ${thr.map(t => `<line class="thr" x1="${L}" x2="${W}" y1="${Y(t)}" y2="${Y(t)}"/>`).join('')}
    ${series.map(s => `<polyline class="${s.cls}" points="${s.pts.map(pt).join(' ')}"/>`).join('')}
    ${series.map(s => `<circle class="${s.cls}" cx="${X(s.pts.at(-1)[0])}" cy="${Y(s.pts.at(-1)[1])}" r="3.5"/>`).join('')}
    </svg>${axis.length ? `<div class="axis"><span>${esc(axis[0])}</span><span>${esc(axis[1])}</span></div>` : ''}`;
}

function spark(vals) {
  if (vals.length < 2) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals), W = 64, H = 22;
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * W).toFixed(1)},${(H - 2 - (hi > lo ? (v - lo) / (hi - lo) : 0.5) * (H - 4)).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts.join(' ')}"/></svg>`;
}

// Чем мерить прогресс: для «свой вес» повторами, для остальных рабочим весом
const valOf = kind => x => (kind === 'bw' ? Math.max(0, ...x.reps.filter(Boolean)) : x.top);

// ---------- прогресс ----------

function progressPage() {
  const seg = view.seg || 'ex';
  let rows;
  if (seg === 'ex') {
    const order = new Map(db.sessions.map((s, i) => [s, i]));
    rows = doneNames().map(ex => ({ ex, h: exerciseHistory(db.sessions, ex) })).filter(x => x.h.length)
      .sort((a, b) => order.get(b.h.at(-1).session) - order.get(a.h.at(-1).session))
      .map(({ ex, h }) => `<button class="li" data-act="ex" data-ex="${esc(ex)}">${thumb(ex)}
        <span class="txt"><b>${esc(ex)}</b><small class="muted">${esc(h.at(-1).session.label)}: ${esc(fmtSet(h.at(-1)))}</small></span>
        ${spark(h.map(valOf(kindOf(ex))))}</button>`);
  } else {
    rows = db.sessions.map((s, k) => [s, k]).reverse().map(([s, k]) => {
      const rec = sessionRecords(k).length;
      return `<button class="li" data-act="sess" data-id="${esc(s.id)}">
        <span class="txt"><b>${esc(s.label)}${s.name ? `, ${esc(s.name)}` : ''}</b><small class="muted">${esc([...new Set(s.sets.map(x => x.ex))].join(', '))}</small></span>
        <span class="muted nowrap">${rec ? `<span class="gold">★ ${rec}</span> ` : ''}${s.hr ? '<span class="pulse">♥</span> ' : ''}›</span></button>`;
    });
  }
  return `<header class="hd"><h1>Прогресс</h1></header>
    <div class="seg glass">
      <button class="${seg === 'ex' ? 'on' : ''}" data-act="seg" data-v="ex">Упражнения</button>
      <button class="${seg === 's' ? 'on' : ''}" data-act="seg" data-v="s">Тренировки</button></div>
    <div class="group glass">${rows.join('') || '<p class="muted pad">Тут появятся упражнения после первой тренировки</p>'}</div>`;
}

const back = () => '<button class="back" data-act="back">‹ Назад</button>';

function exercisePage() {
  const ex = view.ex, kind = kindOf(ex), h = exerciseHistory(db.sessions, ex), val = valOf(kind), c = CAT[ex];
  const media = c ? `<section class="card glass media"><div class="anim"><img src="img/${c.img}-0.jpg" alt=""><img src="img/${c.img}-1.jpg" alt=""></div>
    <ul class="cues">${c.cues.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>` : '';
  const head = `${back()}<header class="hd"><h1 class="t2">${esc(ex)}</h1><p class="sub">${esc([KINDS[kind], ...(c?.muscles || [])].join(', '))}</p></header>`;
  if (!h.length) return `${head}${media}<p class="muted pad">Ещё не делал</p>`;
  const best = h.reduce((a, x) => (val(x) > val(a) ? x : a));
  const e1 = Math.max(...h.map(x => x.e1));
  const series = [{ cls: 'l1', pts: h.map((x, i) => [i, val(x)]) }];
  if (kind !== 'bw' && e1) series.push({ cls: 'l2', pts: h.map((x, i) => [i, x.e1]).filter(p => p[1]) });
  const recov = db.sessions.map(s => ({ s, v: avg((s.rests || []).filter(r => r.ex === ex && r.toThr != null).map(r => r.toThr)) })).filter(x => x.v != null);
  const idx = new Map(db.sessions.map((s, i) => [s, i]));
  const list = [...h].reverse().map(x => {
    const k = idx.get(x.session);
    const star = recordOf(bestOf(ex, [x.session]), bestOf(ex, db.sessions.slice(0, k))) ? '<span class="gold">★</span> ' : '';
    const sets = x.session.sets.filter(s => s.ex === ex).map(s => `<span class="${s.warm ? 'muted' : ''}">${setText(s, kind)}</span>`).join(', ');
    return `<button class="li" data-act="sess" data-id="${esc(x.session.id)}"><span class="txt"><b>${star}${esc(x.session.label)}</b><small class="sets">${sets}</small></span><span class="muted">›</span></button>`;
  }).join('');
  return `${head}
    <div class="stats">
      <div class="stat glass"><small>Лучший</small><b>${kind === 'bw' ? `${val(best)} повт.` : fmtW(best.top)}</b><small>${esc(best.session.label)}</small></div>
      <div class="stat glass"><small>Последний</small><b>${esc(fmtSet(h.at(-1)))}</b><small>${esc(h.at(-1).session.label)}</small></div>
      ${kind !== 'bw' && e1 ? `<div class="stat glass"><small>Максимум на раз</small><b>${fmtW(Math.round(e1 * 2) / 2)}</b><small>примерно</small></div>` : ''}
    </div>
    <section class="card glass">
      <div class="row"><h3>${kind === 'bw' ? 'Повторы' : 'Рабочий вес'}</h3>
        ${series.length > 1 ? '<span class="legend"><span><i></i>вес</span><span><i class="l2"></i>максимум</span></span>' : ''}</div>
      ${chart({ series, axis: [h[0].session.label, h.at(-1).session.label] })}</section>
    ${recov.length ? `<section class="card glass"><h3>Восстановление пульса</h3>
      <p class="muted sm">Сколько в среднем пульс падал до порога. Меньше, значит восстанавливаешься быстрее. ${esc(recov.at(-1).s.label)}: ${fmtSec(recov.at(-1).v)}</p>
      ${chart({ series: [{ cls: 'hr', pts: recov.map((x, i) => [i, x.v]) }], axis: [recov[0].s.label, recov.at(-1).s.label] })}</section>` : ''}
    ${media}
    <div class="group glass">${list}</div>`;
}

function summaryCard(s, k) {
  const work = s.sets.filter(x => !x.warm);
  const tons = Math.round(work.reduce((a, x) => a + (x.w || 0) * (x.r || 0) * (kindOf(x.ex) === 'side' ? 2 : 1), 0) / 100) / 10;
  const mins = s.start && s.end ? Math.round((s.end - s.start) / 6e4) : null;
  const recs = sessionRecords(k);
  const rec = avg((s.rests || []).filter(r => r.toThr != null).map(r => r.toThr));
  const prevS = db.sessions.slice(0, k).reverse().find(x => x.rests?.some(r => r.toThr != null));
  const prev = prevS && avg(prevS.rests.filter(r => r.toThr != null).map(r => r.toThr));
  let pulse = '';
  if (rec != null) {
    const cmp = prev == null ? '' : rec < prev ? `, быстрее прошлого раза (${fmtSec(prev)})` : `, прошлый раз ${fmtSec(prev)}`;
    pulse = `<p class="sm">Пульс падал до порога в среднем за <b>${fmtSec(rec)}</b>${cmp}</p>`;
  }
  return `<section class="card glass">
    <h3>Итог</h3>
    <div class="stats">
      <div class="stat"><small>Рабочих подходов</small><b data-count="${work.length}">${work.length}</b></div>
      <div class="stat"><small>Поднято</small><b><span data-count="${tons}" data-dec="1">${fmtW(tons)}</span> т</b></div>
      ${mins ? `<div class="stat"><small>Время</small><b><span data-count="${mins}">${mins}</span> мин</b></div>` : ''}
    </div>
    ${recs.length ? `<ul class="recs">${recs.map(r => `<li><span class="gold">★</span><span>${esc(r.ex)}: <b>${setText(r.top, kindOf(r.ex))}</b></span><small class="muted">${recordText(r.what)}</small></li>`).join('')}</ul>` : ''}
    ${pulse}</section>`;
}

function sessionPage() {
  const k = db.sessions.findIndex(x => x.id === view.sid), s = db.sessions[k];
  if (!s) return back();
  const exs = [...new Set(s.sets.map(x => x.ex))];
  let pulse = '';
  if (s.hr) {
    const thr = [...new Set(s.rests.map(r => r.thr))];
    const end = s.hr.s.at(-1)[0];
    pulse = `<section class="card glass"><h3>Пульс</h3>
      ${chart({ series: [{ cls: 'hr', pts: s.hr.s }], thr, marks: s.sets.filter(x => x.t).map(x => (x.t - s.hr.t0) / 1000), axis: ['0 мин', `${Math.round(end / 60)} мин`] })}
      <p class="muted sm">Вертикальные линии: подходы. Пунктир: порог.</p></section>`;
  } else if (s.rests?.length) {
    pulse = `<section class="card glass"><p class="muted sm">Пульса пока нет. Запусти Быструю команду «Трени: пульс» и нажми кнопку.</p>
      <button class="btn primary wide" data-act="paste">Вставить пульс</button></section>`;
  }
  const blocks = exs.map(ex => {
    const kind = kindOf(ex);
    const chips = s.sets.filter(x => x.ex === ex).map(x => `<span class="chip${x.warm ? ' warm' : ''}${x.pr ? ' pr' : ''}">${x.pr ? '★ ' : ''}${setText(x, kind)}</span>`).join('');
    const rests = (s.rests || []).filter(r => r.ex === ex && r.end);
    let table = '';
    if (rests.length && s.hr) {
      table = `<table class="rt num">
      <tr><th>отдых</th><th>пик</th><th>до порога</th><th>на подход</th></tr>
      ${rests.map(r => `<tr><td>${fmtSec((r.end - r.start) / 1000)}</td><td>${esc(r.peak)}</td>
        <td>${r.toThr != null ? fmtSec(r.toThr) : r.early ? `<span class="warn">раньше ${esc(r.thr)}</span>` : ''}</td><td>${esc(r.hrStart)}</td></tr>`).join('')}
      </table>`;
    } else if (rests.length) {
      table = `<p class="muted sm">Отдых: ${rests.map(r => fmtSec((r.end - r.start) / 1000)).join(', ')}</p>`;
    }
    return `<section class="card glass"><button class="exh" data-act="info" data-ex="${esc(ex)}">${thumb(ex)}<b class="h3">${esc(ex)}</b></button><div class="chips">${chips}</div>${table}</section>`;
  }).join('');
  const sub = s.date ? new Date(`${s.date}T12:00`).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : s.label;
  const end = view.fin === s.id
    ? '<button class="btn primary wide" data-act="tab" data-tab="today">Готово</button><button class="link danger" data-act="delsess">Удалить тренировку</button>'
    : '<button class="btn ghost wide danger" data-act="delsess">Удалить тренировку</button>';
  return `${back()}<header class="hd"><p class="sub">${esc(sub)}</p><h1 class="t2">${esc(s.name || 'Тренировка')}</h1></header>
    ${summaryCard(s, k)}${pulse}${blocks}${end}`;
}

// ---------- настройки ----------

const kindOpts = sel => Object.entries(KINDS)
  .map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${v}, шаг ${fmtW(STEP[k])}</option>`).join('');

function settingsPage() {
  const S = db.settings;
  const nSets = db.sessions.reduce((a, s) => a + s.sets.length, 0);
  const kb = Math.round((localStorage.getItem(KEY) || '').length / 1024);
  const progs = db.programs.map(p => `<button class="li" data-act="prog" data-id="${esc(p.id)}">
    <span><b>${esc(p.name)}</b><small class="muted">${p.items.length} ${plural(p.items.length, 'упражнение', 'упражнения', 'упражнений')}</small></span><span class="muted">›</span></button>`).join('');
  return `<header class="hd"><h1>Настройки</h1></header>
    <h4 class="cap">Порог пульса для отдыха</h4>
    <div class="group glass">
      <label class="li"><span>В начале тренировки</span><span><input class="num-in" data-set="thr1" inputmode="numeric" value="${esc(S.thr1)}"> уд/мин</span></label>
      <label class="li"><span>Ближе к концу</span><span><input class="num-in" data-set="thr2" inputmode="numeric" value="${esc(S.thr2)}"> уд/мин</span></label>
    </div>
    <p class="foot">Начало: первая половина упражнений в списке.</p>
    <h4 class="cap">Цель</h4>
    <div class="group glass">
      <label class="li"><span>Тренировок в неделю</span><span><input class="num-in" data-set="weekGoal" inputmode="numeric" value="${esc(S.weekGoal)}"></span></label>
    </div>
    <h4 class="cap">Пульс с часов</h4>
    <div class="group glass pad">
      <p class="muted sm">После тренировки запусти Быструю команду «Трени: пульс». Она скопирует замеры, потом нажми кнопку.</p>
      <button class="btn primary wide" data-act="paste">Вставить пульс</button>
      <details><summary class="muted sm">Вставить текстом</summary>
        <textarea id="hrtext" rows="4" placeholder="2026-10-15T19:00:05+05:00;142"></textarea>
        <button class="btn wide" data-act="parsehr">Разобрать</button></details>
    </div>
    <h4 class="cap">Сохранение в GitHub</h4>
    <div class="group glass pad">${meta.token ? `
      <p class="muted sm">${esc(meta.owner)}/${esc(meta.repo)}</p>
      <p id="syncst" class="sm ${syncState === 'ok' ? 'ok' : syncState ? 'warn' : 'muted'}">${SYNC_TEXT[syncState]()}</p>
      <button class="btn wide" data-act="syncnow">Синхронизировать сейчас</button>
      <button class="link danger" data-act="unlink">Отключить этот телефон</button>` : `
      <p class="muted sm">Тренировки будут сами сохраняться в твой закрытый репозиторий. Ключ хранится только на этом телефоне.</p>
      <input id="gh-owner" class="search" placeholder="Логин GitHub" autocomplete="username" autocapitalize="off" spellcheck="false">
      <input id="gh-repo" class="search" placeholder="Репозиторий" value="treni-data" autocapitalize="off" spellcheck="false">
      <input id="gh-token" type="password" class="search" placeholder="Ключ github_pat_…" autocomplete="off">
      <button class="btn primary wide" data-act="link">Подключить</button>`}
    </div>
    <h4 class="cap">Программы</h4>
    <div class="group glass">${progs}<button class="li accent" data-act="newprog">Новая программа</button></div>
    <h4 class="cap">Упражнения</h4>
    <div class="group glass"><button class="li" data-act="exl"><span>Тип веса и свои упражнения</span><span class="muted">›</span></button></div>
    <h4 class="cap">Данные</h4>
    <div class="group glass">
      <button class="li" data-act="backup"><span>Сохранить бэкап в файл</span><span class="muted sm">${S.backupAt ? ago(isoDay(S.backupAt)) : 'ещё не было'}</span></button>
      <button class="li" data-act="imp"><span>Импорт истории или бэкапа</span><span class="muted">›</span></button>
    </div>
    <p class="foot">${nTrain(db.sessions.length)}, ${nSets} ${plural(nSets, 'подход', 'подхода', 'подходов')}, ${kb} КБ.
      ${meta.token ? 'Копия в GitHub.' : 'Данные хранятся только на этом телефоне.'} Фото упражнений: free-exercise-db.</p>`;
}

function exercisesPage() {
  const mine = [...new Set([...doneNames(), ...Object.keys(db.exercises)])].sort((a, b) => a.localeCompare(b, 'ru'));
  const rows = mine.map(ex => `<div class="li"><span>${esc(ex)}</span><select data-kind="${esc(ex)}">${kindOpts(kindOf(ex))}</select></div>`).join('');
  const groups = Object.entries(GROUPS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  return `${back()}<header class="hd"><h1 class="t2">Упражнения</h1><p class="sub">Тип веса задаёт шаг прибавки в подсказке</p></header>
    <div class="group glass">${rows}</div>
    <h4 class="cap">Своё упражнение</h4>
    <div class="group glass pad"><input id="newex" placeholder="Название"><select id="newgroup">${groups}</select><select id="newkind">${kindOpts('total')}</select>
      <button class="btn primary wide" data-act="newex">Добавить</button></div>
    <p class="foot">В каталоге ${CATALOG.length} упражнений с фото, их заводить не надо.</p>`;
}

function programPage() {
  const p = db.programs.find(x => x.id === view.prog);
  if (!p) return back();
  const opts = sel => allExercises().map(ex => `<option${ex === sel ? ' selected' : ''}>${esc(ex)}</option>`).join('');
  const rows = p.items.map((it, i) => `<div class="pi">
    <select data-pi="${i}" data-f="ex">${opts(it.ex)}</select>
    <span class="pi-n"><input data-pi="${i}" data-f="sets" inputmode="numeric" value="${esc(it.sets)}" aria-label="подходы">×<input data-pi="${i}" data-f="reps" inputmode="numeric" value="${esc(it.reps)}" aria-label="повторы"></span>
    <button class="ic" data-act="pmove" data-i="${i}" aria-label="выше">${ICON_UP}</button>
    <button class="ic" data-act="pdel" data-i="${i}" aria-label="убрать">${ICON_X}</button></div>`).join('');
  return `${back()}<header class="hd"><input class="title-in" data-prog="name" value="${esc(p.name)}" aria-label="название"></header>
    <div class="group glass">${rows}<button class="li accent" data-act="add" data-ctx="prog">Добавить упражнение</button></div>
    <p class="foot">Порядок важен: в первой половине списка порог ${esc(db.settings.thr1)}, во второй ${esc(db.settings.thr2)}.</p>
    <button class="btn ghost wide danger" data-act="delprog">Удалить программу</button>`;
}

// ---------- импорт, бэкап, пульс ----------

function importData(d) {
  // Проверяем форму до любых изменений: битый файл не должен ни стереть историю, ни сломать запуск
  if (!d || typeof d !== 'object' || !Array.isArray(d.sessions) || !d.sessions.every(okSession)) throw Error('это не файл Трени');
  if (d.programs !== undefined && !Array.isArray(d.programs)) throw Error('это не файл Трени');
  if (d.programs) {
    if (!confirm(`Заменить все данные на этом телефоне бэкапом (${nTrain(d.sessions.length)})?`)) return 'Отменено';
    db = normalize(d);
    return 'Бэкап восстановлен';
  }
  // history.json из treni.py: подменяем только старые тренировки (id с «h»), записанные здесь не трогаем
  if (!confirm(`Загрузить историю (${nTrain(d.sessions.length)})? Тренировки, записанные в приложении, останутся.`)) return 'Отменено';
  const h = normalize({ sessions: d.sessions, exercises: d.exercises });
  for (const [k, v] of Object.entries(h.exercises)) if (!db.exercises[k] || db.exercises[k].kind === '?') db.exercises[k] = v;
  db.sessions = [...h.sessions, ...db.sessions.filter(s => !s.id.startsWith('h'))];
  db.plan = null;
  return `История загружена: ${nTrain(d.sessions.length)}`;
}

function applyHR(text) {
  const samples = parseHR(text);
  if (!samples.length) return toast('В тексте нет замеров пульса');
  const got = db.sessions.map(s => [s, attachHR(s, samples)]).filter(([, n]) => n >= 0);
  if (!got.length) return toast(`Замеров ${samples.length}, но на время тренировок их нет`);
  save();
  view = { tab: 'progress', sid: got.at(-1)[0].id };
  render();
  toast(got.map(([s, n]) => `${s.label}: посчитано отдыхов ${n}`).join('; '));
}

async function backup() {
  const name = `treni-${isoDay(Date.now())}.json`;
  const file = new File([JSON.stringify(db)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      db.settings.backupAt = Date.now();
      save();
      return render();
    } catch (e) { if (e.name === 'AbortError') return; }
  }
  // Запасной путь: скачивание. На iPhone с экрана «Домой» ненадёжно, поэтому отметку «сохранено» не ставим
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: name });
  a.click();
  toast(meta.token ? 'Файл скачивается. Если не появится, копия есть в GitHub' : 'Файл скачивается');
}

// ---------- действия ----------

const A = () => db.active;
const curItem = () => A().items[A().cur];

const ACT = {
  tab: d => { closeSheet(); view = { tab: d.tab, seg: view.seg }; },
  back: () => { for (const k of ['sid', 'ex', 'prog', 'exl']) if (view[k]) return void delete view[k]; },
  seg: d => { view.seg = d.v; },
  ex: d => { view = { tab: 'progress', seg: view.seg, ex: d.ex }; },
  sess: d => { view.sid = d.id; },
  prog: d => { view.prog = d.id; },
  exl: () => { view.exl = true; },

  info: d => { view.sheet = { t: 'info', ex: d.ex }; },
  swap: d => { view.sheet = { t: 'swap', ctx: d.ctx, i: +d.i }; },
  add: d => { view.sheet = { t: 'add', ctx: d.ctx, i: +d.i, swap: !!d.swap }; },
  grp: d => { view.sheet.g = d.g; },
  close: () => closeSheet(),
  pick: d => {
    const S = view.sheet, list = sheetList(S), it = guessItem(d.ex);
    let replace = S.t === 'swap' || S.swap;
    if (S.ctx === 'work') {
      const a = A();
      // По заменяемому уже есть подходы: не прячем их, а ставим новое упражнение рядом
      if (replace && a.sets.some(s => s.ex === list[S.i].ex)) { list.splice(S.i + 1, 0, it); a.cur = S.i + 1; replace = false; }
      else if (replace) list[S.i] = it;
      else { list.push(it); a.cur = list.length - 1; }
      a.draft = draftFor(a.cur);
    } else if (replace) list[S.i] = it;
    else list.push(it);
    delete view.sheet;
  },
  newq: () => {
    const S = view.sheet, name = S.q.trim();
    if (!db.exercises[name] && !CAT[name]) db.exercises[name] = { kind: 'total', basis: KINDS.total, group: S.g || undefined };
    ACT.pick({ ex: name });
  },
  useremote: () => {
    delete view.sheet;
    takeRemote(remoteOffer);
    remoteOffer = null;
    return false;
  },
  usephone: () => {
    if (!confirm(`Затереть на сервере ${nTrain(remoteOffer.sessions.length)} данными телефона (${nTrain(db.sessions.length)})?`)) return false;
    delete view.sheet;
    remoteOffer = null;
    db.savedAt = Date.now();
    saveLocal();
    push();
    render();
    return false;
  },

  replan: () => {
    const old = db.plan;
    db.plan = buildPlan();
    toast('План сброшен', () => { db.plan = old; });
  },
  plandel: d => {
    const i = +d.i, items = db.plan.items, it = items.splice(i, 1)[0];
    toast(`${it.ex}: убрано из плана`, () => { if (db.plan?.items === items) items.splice(i, 0, it); });
  },
  startplan: () => startWith(planName(db.plan.items), null, db.plan.items),
  start: d => { const p = db.programs.find(x => x.id === d.id); startWith(p.name, p.id, p.items); view = { tab: 'today' }; },
  resume: () => { A().resumed = Date.now(); },
  cur: d => { A().cur = +d.i; A().draft = draftFor(+d.i); },
  step: d => {
    const D = A().draft, inc = d.f === 'w' ? STEP[kindOf(curItem().ex)] : 1;
    D[d.f] = Math.max(0, Math.round((+D[d.f] + d.d * inc) * 100) / 100);
  },
  warm: () => { A().draft.warm = !A().draft.warm; },
  done: () => {
    const a = A(), it = curItem(), D = a.draft, t = Date.now();
    const set = { ex: it.ex, w: kindOf(it.ex) === 'bw' ? 0 : D.w, r: D.r, warm: D.warm, t };
    // Рекорд только относительно прошлых тренировок: первая тренировка упражнения и подходы без повторов не считаются
    const what = !set.warm && bestOf(it.ex, db.sessions).w >= 0 && recordOf(set, bestOf(it.ex, [...db.sessions, { sets: a.sets }]));
    if (what) set.pr = what;
    a.sets.push(set);
    a.rest = { ex: it.ex, start: t, thr: thrFor(a.cur, a.items.length, db.settings) };
    a.draft = draftFor(a.cur);
    if (what) setTimeout(() => celebrate(recordText(what), `${it.ex}: ${setText(set, kindOf(it.ex))}`), 50);
  },
  fix: () => {
    // Записал не те цифры: подход обратно в поля, отдых отменяется
    const a = A(), s = a.sets.pop();
    a.rest = null;
    a.cur = Math.max(0, a.items.findIndex(i => i.ex === s.ex));
    a.draft = { w: s.w, r: s.r, warm: s.warm };
  },
  go: () => {
    const a = A();
    a.rests.push({ ...a.rest, end: Date.now() });
    a.rest = null;
    const ni = nextIdx(a);
    if (ni !== a.cur) { a.cur = ni; a.draft = draftFor(ni); }
  },
  delset: d => {
    const a = A(), k = +d.k, s = a.sets.splice(k, 1)[0];
    a.draft = draftFor(a.cur);
    // Тренировку успели закончить: «Вернуть» уже ничего не трогает
    toast(`Подход ${setText(s, kindOf(s.ex))} удалён`, () => { if (db.active === a) { a.sets.splice(k, 0, s); a.draft = draftFor(a.cur); } });
  },
  finish: () => {
    const a = A();
    if (!a.sets.length) {
      if (!confirm('Подходов нет. Отменить тренировку?')) return false;
      db.active = null;
      lock?.release();
      return;
    }
    if (!confirm('Закончить тренировку?')) return false;
    const date = isoDay(a.startedAt);
    // Копии массивов: отложенные «Вернуть» и прочие ссылки на тренировку не должны менять историю
    const s = { id: `s${a.startedAt}`, date, label: dayLabel(date), program: a.program, name: a.name,
      start: a.startedAt, end: Date.now(), sets: [...a.sets], rests: [...a.rests] };
    db.sessions.push(s);
    db.active = null;
    db.plan = null;
    lock?.release();
    view = { tab: 'progress', sid: s.id, fin: s.id };
    setTimeout(push, 0); // после save() в обработчике клика: итог тренировки сразу на сервер
    const recs = sessionRecords(db.sessions.length - 1);
    if (recs.length) setTimeout(() => celebrate('Тренировка закончена', `${plural(recs.length, 'Рекорд', 'Рекорда', 'Рекордов')}: ${recs.length}`), 300);
    else toast('Сохранено. Дома запусти команду «Трени: пульс»');
  },

  delsess: () => {
    if (!confirm('Удалить тренировку насовсем?')) return false;
    db.sessions = db.sessions.filter(s => s.id !== view.sid);
    delete view.sid;
  },
  newprog: () => {
    const id = `p${Date.now()}`;
    db.programs.push({ id, name: 'Новая программа', items: [] });
    view.prog = id;
  },
  pdel: d => { db.programs.find(x => x.id === view.prog).items.splice(+d.i, 1); },
  pmove: d => {
    const it = db.programs.find(x => x.id === view.prog).items, i = +d.i;
    if (i > 0) [it[i - 1], it[i]] = [it[i], it[i - 1]];
  },
  delprog: () => {
    if (!confirm('Удалить программу?')) return false;
    db.programs = db.programs.filter(x => x.id !== view.prog);
    delete view.prog;
  },
  newex: () => {
    const name = $('#newex').value.trim();
    if (!name) return false;
    const kind = $('#newkind').value;
    db.exercises[name] = { kind, basis: KINDS[kind], group: $('#newgroup').value };
  },

  link: async () => {
    const owner = $('#gh-owner').value.trim(), repo = $('#gh-repo').value.trim(), token = $('#gh-token').value.trim();
    // Не-латиница в заголовке роняет fetch ещё до сети, поэтому проверяем здесь
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return void toast('Логин и репозиторий латиницей, как на GitHub');
    if (!/^[\x21-\x7e]{20,}$/.test(token)) return void toast('Ключ скопирован не целиком');
    meta = { owner, repo, token };
    saveMeta();
    syncState = '';
    render();
    await pull();
    if (['key', 'norepo', 'denied'].includes(syncState)) { const s = syncState; meta = {}; saveMeta(); syncState = s; }
    if (view.sheet?.t !== 'conflict') toast(SYNC_TEXT[syncState]());
    render();
  },
  unlink: () => {
    if (!confirm('Отключить? Данные на телефоне останутся, на сервер они больше не пойдут.')) return false;
    meta = {};
    saveMeta();
  },
  syncnow: async () => { setSync(''); await pull(); },

  imp: () => { $('#file').click(); return false; },
  backup: () => { backup(); return false; },
  paste: async () => {
    try { applyHR(await navigator.clipboard.readText()); } catch {
      toast('Не вышло прочитать буфер. Нажми «Вставить» в подсказке над кнопкой или вставь текстом в Настройках');
    }
    return false;
  },
  parsehr: () => { applyHR($('#hrtext').value); return false; },
};

// Действие вернуло false: ничего не поменялось, перерисовывать не надо
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  const fn = el && ACT[el.dataset.act];
  if (!fn) return;
  const r = fn(el.dataset);
  if (r === false || r instanceof Promise) return;
  save();
  render();
});

document.addEventListener('input', e => {
  const t = e.target;
  if ('q' in t.dataset && view.sheet) {
    view.sheet.q = t.value;
    $('#plist').innerHTML = addList(view.sheet);
    return;
  }
  const f = t.dataset.in;
  if (!f || !db.active?.draft) return;
  const v = parseFloat(t.value.replace(',', '.'));
  if (!isNaN(v)) { db.active.draft[f] = v; save(); }
});

document.addEventListener('change', e => {
  const t = e.target, d = t.dataset;
  if (d.set) db.settings[d.set] = Math.max(1, +t.value) || db.settings[d.set];
  else if (d.kind) db.exercises[d.kind] = { ...db.exercises[d.kind], kind: t.value, basis: KINDS[t.value] };
  else if (d.prog) db.programs.find(x => x.id === view.prog).name = t.value.trim() || 'Без названия';
  else if (d.pi) {
    const it = db.programs.find(x => x.id === view.prog).items[+d.pi];
    it[d.f] = d.f === 'ex' ? t.value : Math.max(1, +t.value || 1);
  } else return;
  save();
});

$('#file').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const old = db;
  try {
    let d;
    try { d = JSON.parse(await f.text()); } catch { throw Error('это не файл Трени'); }
    const msg = importData(d);
    render(); // сначала проверяем, что с новыми данными всё рисуется, и только потом сохраняем
    save();
    toast(msg);
  } catch (err) {
    db = old;
    render();
    toast(`Не получилось: ${err.message}`);
  }
});

// Шторку можно смахнуть вниз, как в iOS
let swipeY = null;
document.addEventListener('touchstart', e => {
  const s = e.target.closest('.sheet');
  swipeY = s && s.scrollTop <= 0 ? e.touches[0].clientY : null;
}, { passive: true });
document.addEventListener('touchend', e => {
  if (swipeY != null && e.changedTouches[0].clientY - swipeY > 80) { closeSheet(); render(); }
  swipeY = null;
});

// ---------- отрисовка ----------

function render() {
  const pages = {
    today: () => (db.active ? workoutPage() : todayPage()),
    progress: () => (view.sid ? sessionPage() : view.ex ? exercisePage() : progressPage()),
    settings: () => (view.prog ? programPage() : view.exl ? exercisesPage() : settingsPage()),
  };
  const app = $('#app'), page = [view.tab, !!db.active, view.sid, view.ex, view.prog, view.exl, view.seg].join();
  app.innerHTML = pages[view.tab]();
  const changed = page !== lastPage;
  if (changed) { app.classList.remove('enter'); void app.offsetWidth; app.classList.add('enter'); lastPage = page; }
  const sh = $('#sheet'), html = sheet(), opened = !sh.innerHTML && html;
  sh.innerHTML = html;
  sh.classList.toggle('in', !!opened);
  document.body.classList.toggle('locked', !!html);
  document.body.classList.toggle('working', !!db.active);
  // Фото из кэша сразу видимы: иначе при каждом нажатии −/+ все миниатюры мигают
  for (const i of document.querySelectorAll('img:not(.loaded)')) if (i.complete && i.naturalWidth) i.classList.add('loaded');
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === view.tab));
  if (changed) countUp();
  // После «Иду» текущая карточка в центре экрана, а не уехавшая за меню
  const cur = db.active && !db.active.rest && view.tab === 'today' ? db.active.cur : null;
  if (cur != null && cur !== lastCur) $('.card.cur')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  lastCur = cur;
  tick();
}

// Таймеры считаются от меток времени, поэтому блокировка экрана их не сбивает
function tick() {
  const a = db.active;
  if (!a) return;
  const t = $('#timer');
  if (t && a.rest) {
    const sec = (Date.now() - a.rest.start) / 1000, hint = +t.dataset.hint;
    t.textContent = fmtSec(sec);
    if (hint) {
      t.classList.toggle('ready', sec >= hint);
      $('#ready').hidden = sec < hint;
      $('#ready-no').hidden = sec >= hint;
    }
  }
  const el = $('#elapsed');
  if (el) {
    const m = Math.floor((Date.now() - (a.resumed || a.startedAt)) / 6e4), n = a.sets.length;
    el.textContent = `Идёт ${m} мин, ${n} ${plural(n, 'подход', 'подхода', 'подходов')}`;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') return void push();
  pull(); // вернулся в приложение: вдруг на сервере свежее (второе устройство)
  if (db.active) { wake(); tick(); }
});
window.addEventListener('online', () => push());
// Вторая вкладка поменяла данные: подхватываем, а не затираем своей старой копией
window.addEventListener('storage', e => { if (e.key === KEY) { db = load(); render(); } });
// Фото проявляются плавно, а не выпрыгивают; битое (нет сети, нет в кэше) так и остаётся невидимым
document.addEventListener('load', e => e.target.tagName === 'IMG' && e.target.classList.add('loaded'), true);
// Нажал на поле с числом: оно выделено, сразу печатаешь новое. На iOS select() по фокусу перебивает курсор, поэтому с задержкой
document.addEventListener('focusin', e => {
  const t = e.target;
  if (t.matches('[data-in], .num-in, .pi-n input')) setTimeout(() => t.setSelectionRange(0, t.value.length), 50);
});

setInterval(tick, 500);
if (db.active) wake();
if (navigator.serviceWorker && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // Фото в кэш сразу с первого запуска, не дожидаясь service worker: в зал можно прийти без сети
  setTimeout(() => {
    caches.open(IMG_CACHE).then(c => Promise.all(CATALOG.flatMap(x => [0, 1].map(k => `img/${x.img}-${k}.jpg`))
      .map(u => c.match(u).then(h => h || c.add(u)).catch(() => {})))).catch(() => {});
  }, 3000);
}
try { render(); } catch (e) { reportError(e); }
pull();
