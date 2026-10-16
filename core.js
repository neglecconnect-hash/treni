// Чистая логика без DOM: подключается и приложением, и tools/check.mjs.

// Шаг прибавки по типу веса: total/side штанга и Хаммер, db гантели, added пояс, stack плитки, bw свой вес.
// time (планка): w нет, r секунды, шаг 5 с. cardio (дорожка и т.п.): w километры, шаг 0,1; r минуты
export const STEP = { total: 2.5, side: 2.5, added: 2.5, db: 1, stack: 1, bw: 1, time: 5, cardio: 0.1, '?': 2.5 };

export const fmtW = w => (w == null ? '?' : String(Math.round(w * 100) / 100).replace('.', ','));
export const fmtSec = sec => {
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

// Оценка разового максимума по Эпли, только до 12 повторов
export const e1rm = (w, r) => (w > 0 && r > 0 && r <= 12 ? w * (1 + r / 30) : 0);

// Рабочие подходы одного упражнения в одной тренировке
export function workStats(sets) {
  const work = sets.filter(s => !s.warm && s.w != null);
  if (!work.length) return null;
  const top = Math.max(...work.map(s => s.w)), tops = work.filter(s => s.w === top);
  return {
    top,
    reps: tops.map(s => s.r),
    // «Как было?» спрашиваем после последнего рабочего подхода упражнения: его ответ и берём. Хоть один «тяжело», значит тяжело
    feel: work.some(s => s.feel === 'hard') ? 'hard' : work.at(-1).feel || null,
    e1: Math.max(...work.map(s => e1rm(s.w, s.r))),
    tonnage: work.reduce((a, s) => a + s.w * (s.r || 0), 0),
  };
}

// История упражнения по тренировкам в хронологическом порядке
export function exerciseHistory(sessions, ex) {
  const out = [];
  for (const session of sessions) {
    const st = workStats(session.sets.filter(s => s.ex === ex));
    if (st) out.push({ session, ...st });
  }
  return out;
}

export const fmtSet = (x, kind) => (kind === 'time' ? x.reps.map(r => (r == null ? '?' : fmtSec(r))).join('/')
  : kind === 'cardio' ? `${x.reps[0] ?? '?'} мин${x.top ? `, ${fmtW(x.top)} км` : ''}`
  : `${x.top ? fmtW(x.top) : 'свой вес'} × ${x.reps.map(r => r ?? '?').join('/')}`);

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

// Пульс после упражнения падал до порога заметно (на 30%) дольше, чем в прошлые разы: восстановление хуже обычного
function slowRest(tail, ex) {
  const rec = e => mean((e.session?.rests || []).filter(r => r.ex === ex && r.toThr != null).map(r => r.toThr));
  const now = rec(tail.at(-1)), before = mean(tail.slice(0, -1).map(rec).filter(v => v != null));
  return now != null && before > 0 && now > 1.3 * before; // 0: раньше пульс до порога не поднимался, сравнивать не с чем
}

// Вес словами для подсказки: «27,5 кг», «42,5 кг на сторону», «2,5 кг на поясе»
const KG = { side: 'кг на сторону', added: 'кг на поясе' };
const kg = (w, kind) => `${fmtW(w)} ${KG[kind] || 'кг'}`;
const sum = e => e.reps.reduce((a, r) => a + (r || 0), 0);

// Двойная прогрессия: все подходы с самым тяжёлым весом на целевые повторы, значит прибавляем шаг.
// Сколько их было, не важно: «лесенка» 40/50/40 даёт один подход на 50, и это норма.
// Подстройка под человека, по важности: застой (3 раза подряд тот же вес, повторы не добраны и не растут: минус 10%),
// цель не взята, «Было тяжело», пульс восстанавливался дольше обычного (тот же вес), «Было легко» (два шага вместо одного).
// last.prev: до трёх последних тренировок с упражнением, вместе с last (подкладывает приложение).
// ask: вес новой плитки знает только тренажёр, приложение просит его вписать
export function suggest(last, item, kind) {
  if (!last) return { w: null, text: kind === 'time' ? 'Первый раз: держи, сколько получится' : kind === 'cardio' ? 'Первый раз: в своём темпе'
    : 'Первый раз: возьми вес, с которым все повторы получаются, но последние 2-3 тяжело' };
  const was = `Прошлый раз ${fmtSet(last, kind)}.`;
  if (kind === 'cardio') return { w: last.top, text: was };
  const reached = e => e.reps.length > 0 && e.reps.every(r => r != null && r >= item.reps);
  const step = STEP[kind] ?? 2.5, heavy = kind !== 'bw' && kind !== 'time', tail = last.prev || [last];
  const unit = kind === 'time' ? 'сек' : 'раз', same = heavy ? 'вес' : 'результат';
  if (heavy && last.top > step && tail.length >= 3 && tail.slice(-3).every(e => e.top === last.top && !reached(e)) && sum(last) <= sum(tail.at(-3))) {
    const w = Math.min(last.top - step, Math.round((last.top * 0.9) / step) * step);
    return { w, text: `${was} 3 раза подряд не вышло ${item.reps} раз. Сбавь до ${kg(w, kind)} и снова дойди до ${item.reps}` };
  }
  if (!reached(last)) return { w: last.top, text: `${was} Цель: ${item.sets} × ${item.reps} ${unit}${heavy ? ', вес тот же' : ''}` };
  if (last.feel === 'hard') return { w: last.top, text: `${was} Было тяжело: оставь тот же ${same}` };
  if (slowRest(tail, item.ex)) return { w: last.top, text: `${was} Пульс восстанавливался дольше обычного: оставь тот же ${same}` };
  const k = last.feel === 'easy' ? 2 : 1, easy = k > 1 ? 'Было легко: ' : '';
  if (kind === 'time') return { w: 0, text: `${was} ${easy}Попробуй +${5 * k} секунд` };
  if (kind === 'bw') return { w: last.top, text: `${was} ${easy}Попробуй +${k} ${k > 1 ? 'повтора' : 'повтор'}` };
  if (kind === 'stack') return { w: last.top, ask: true, text: `${was} ${easy}Переставь штырь на ${k} ${k > 1 ? 'плитки' : 'плитку'} тяжелее и впиши вес` };
  const w = last.top + step * k;
  return { w, text: `${was} ${easy}Попробуй ${kg(w, kind)}` };
}

// Порог пульса: первая половина упражнений тренировки thr1, вторая thr2
export const thrFor = (i, n, st) => (i < Math.ceil(n / 2) ? st.thr1 : st.thr2);

// Дата из команды: ISO 8601, как в гайде, или «15.10.2026, 19:00:05», если там выбрали короткий формат.
// Русский формат первым: Chrome читает «05.10.2026» как 10 мая
function parseDate(s) {
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\D+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return m ? new Date(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime() : Date.parse(s);
}

// Текст из Быстрой команды: строки «дата;уд/мин» (с повтором) или два столбика: все даты, потом все значения
// (без повтора, на тысячах замеров в разы быстрее). Оба вида = i-я дата в паре с i-м значением.
// Нули из Здоровья тоже считаем, иначе столбики съедут, и отбрасываем уже после склейки.
// Дата только со временем: без него замер бесполезен, а Date.parse съедает и мусор вроде «78»
export function parseHR(text) {
  const ts = [], vals = [];
  for (const tok of String(text || '').split(/[\r\n;\t]+/)) {
    const v = tok.match(/^\s*(\d{1,3})(?:[.,]\d+)?(?:\s.*)?$/);
    if (v) vals.push(+v[1]);
    else if (/\d:\d\d/.test(tok)) {
      const t = parseDate(tok.trim());
      if (!isNaN(t)) ts.push(t);
    }
  }
  if (ts.length !== vals.length) return [];
  return ts.map((t, i) => ({ t, bpm: vals[i] })).filter(p => p.bpm >= 10).sort((a, b) => a.t - b.t);
}

// Отдых {start, end, thr} в мс. Пик = максимум за 60 с после подхода (пульс догоняет с задержкой),
// до порога = первый замер ниже порога после пика, старт = последний замер до «Иду»
// (замер после «Иду» берём, только если до него ничего нет: там пульс уже растёт от подхода).
export function analyzeRest(samples, { start, end, thr }) {
  const win = samples.filter(p => p.t >= start && p.t <= end + 3000);
  if (!win.length) return null;
  const head = win.filter(p => p.t <= start + 60000);
  const peak = (head.length ? head : win).reduce((a, p) => (p.bpm > a.bpm ? p : a));
  const near = win.filter(p => p.t >= end - 15000 && p.t <= end).at(-1) ?? win.find(p => p.t > end);
  const hrStart = near ? near.bpm : null;
  // Пульс и не поднимался выше порога: ждать было нечего
  if (peak.bpm < thr) return { peak: peak.bpm, toThr: 0, hrStart, early: false };
  const below = win.find(p => p.t >= peak.t && p.t <= end && p.bpm < thr);
  // «Ушёл раньше порога» только если после пика есть замеры, иначе данных просто нет
  const after = win.some(p => p.t > peak.t && p.t <= end);
  return { peak: peak.bpm, toThr: below ? Math.round((below.t - start) / 1000) : null, hrStart, early: !below && after };
}

// Привязать замеры к тренировке. -1 = замеров на её время нет, иначе сколько отдыхов посчитано.
export function attachHR(session, samples) {
  const ts = session.sets.map(s => s.t).filter(Boolean);
  if (!ts.length) return -1;
  const from = Math.min(...ts) - 10 * 60000;
  const to = Math.max(...ts, ...session.rests.map(r => r.end || 0)) + 10 * 60000;
  const mine = samples.filter(p => p.t >= from && p.t <= to);
  if (!mine.length) return -1;
  let n = 0;
  for (const r of session.rests) {
    const a = r.end && analyzeRest(mine, r);
    if (a) {
      Object.assign(r, a);
      n++;
    }
  }
  const t0 = mine[0].t;
  session.hr = { t0, s: mine.map(p => [Math.round((p.t - t0) / 1000), p.bpm]) };
  return n;
}
