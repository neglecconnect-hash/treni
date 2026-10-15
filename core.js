// Чистая логика без DOM: подключается и приложением, и tools/check.mjs.

// Шаг прибавки по типу веса: total/side штанга и Хаммер, db гантели, added пояс, stack плитки, bw свой вес
export const STEP = { total: 2.5, side: 2.5, added: 2.5, db: 1, stack: 1, bw: 1, '?': 2.5 };

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
  const top = Math.max(...work.map(s => s.w));
  return {
    top,
    reps: work.filter(s => s.w === top).map(s => s.r),
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

export const fmtSet = x => `${x.top ? fmtW(x.top) : 'свой вес'} × ${x.reps.map(r => r ?? '?').join('/')}`;

// Двойная прогрессия: все подходы с самым тяжёлым весом на целевые повторы, значит прибавляем шаг.
// Сколько их было, не важно: «лесенка» 40/50/40 даёт один подход на 50, и это норма.
export function suggest(last, item, kind) {
  if (!last) return { w: null, text: 'Первый раз: подбери рабочий вес' };
  const was = `Прошлый раз ${fmtSet(last)}.`;
  const done = last.reps.length > 0 && last.reps.every(r => r != null && r >= item.reps);
  if (!done) return { w: last.top, text: `${was} Добей ${item.sets} × ${item.reps}` };
  if (kind === 'bw') return { w: last.top, text: `${was} Попробуй +1 повтор` };
  if (kind === 'stack') return { w: last.top, text: `${was} Пора на следующую плитку` };
  const w = last.top + (STEP[kind] ?? 2.5);
  return { w, text: `${was} Попробуй ${fmtW(w)}` };
}

// Порог пульса: первая половина упражнений тренировки thr1, вторая thr2
export const thrFor = (i, n, st) => (i < Math.ceil(n / 2) ? st.thr1 : st.thr2);

// Текст из Быстрой команды: строки «дата ISO;уд/мин»
export function parseHR(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*(.+?)\s*[;\t]\s*(\d{2,3})(?:[.,]\d+)?/);
    if (!m) continue;
    const t = Date.parse(m[1].trim());
    if (!isNaN(t)) out.push({ t, bpm: +m[2] });
  }
  return out.sort((a, b) => a.t - b.t);
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
