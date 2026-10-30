// Attendance report model: turns Firestore users + shifts into per-person,
// per-day rows for the last N days in a fixed timezone. Pure functions only
// (no I/O) so the logic can be unit-tested in Node and run in the Worker.

export const TIMEZONE = 'Asia/Colombo';
export const DAY_MS = 86400000;

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function zonedParts(ms) {
  const out = {};
  for (const p of partsFormatter.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

/** 'YYYY-MM-DD' of an epoch-ms instant, in TIMEZONE. */
export function dateKey(ms) {
  const p = zonedParts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 'HH:mm' (24h) of an epoch-ms instant, in TIMEZONE. */
export function timeHHmm(ms) {
  const p = zonedParts(ms);
  return `${p.hour}:${p.minute}`;
}

/** Calendar arithmetic on 'YYYY-MM-DD' keys (timezone independent). */
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Last `days` calendar days in TIMEZONE, ending today (inclusive). */
export function reportPeriod(nowMs, days = 30) {
  const end = dateKey(nowMs);
  const start = addDays(end, -(days - 1));
  const dates = [];
  for (let i = 0; i < days; i++) dates.push(addDays(start, i));
  return { start, end, dates };
}

/** Accepts epoch ms (number or numeric string), ISO strings or {seconds}. */
export function toMillis(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === 'string') {
    if (/^\d+$/.test(v)) return Number(v) || null;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v === 'object' && typeof v.seconds === 'number') return v.seconds * 1000;
  return null;
}

/**
 * Status values used for clock-out / break-end / durations:
 *  'ok'          value is known
 *  'missing'     never recorded (a past day)
 *  'in-progress' still open today
 *  'invalid'     end is before start
 */
function evaluateShift(shift, isToday) {
  const inTime = toMillis(shift.inTime);
  const outTime = toMillis(shift.outTime);
  const issues = [];

  let outStatus = 'ok';
  if (!outTime) outStatus = isToday ? 'in-progress' : 'missing';
  else if (outTime < inTime) outStatus = 'invalid';

  const breaks = (Array.isArray(shift.breaks) ? shift.breaks : [])
    .map((b) => ({ start: toMillis(b && b.start), end: toMillis(b && b.end) }))
    .filter((b) => b.start)
    .sort((a, b) => a.start - b.start)
    .map((b) => {
      let status = 'ok';
      let durationMs = null;
      if (!b.end) status = isToday && !outTime ? 'in-progress' : 'missing';
      else if (b.end < b.start) status = 'invalid';
      else durationMs = b.end - b.start;
      return { ...b, status, durationMs };
    });

  if (outStatus === 'missing') issues.push('missing clock-out');
  if (outStatus === 'invalid') issues.push('clock-out before clock-in');
  if (breaks.some((b) => b.status === 'missing')) issues.push('break not ended');
  if (breaks.some((b) => b.status === 'invalid')) issues.push('break ends before it starts');

  const breaksComplete = breaks.every((b) => b.status === 'ok');
  const breakTotalMs = breaksComplete ? breaks.reduce((s, b) => s + b.durationMs, 0) : null;
  let breakTotalStatus = 'ok';
  if (!breaksComplete) {
    breakTotalStatus = breaks.some((b) => b.status === 'invalid') ? 'invalid'
      : breaks.some((b) => b.status === 'missing') ? 'missing' : 'in-progress';
  }

  let workedMs = null;
  let workedStatus = 'ok';
  if (outStatus !== 'ok') workedStatus = outStatus;
  else if (!breaksComplete) workedStatus = breakTotalStatus;
  else {
    workedMs = outTime - inTime - breakTotalMs;
    if (workedMs < 0) {
      workedMs = null;
      workedStatus = 'invalid';
      issues.push('breaks longer than the shift');
    }
  }

  const complete = workedStatus === 'ok';
  const inProgress = !complete && (outStatus === 'in-progress' || workedStatus === 'in-progress');
  return {
    inTime, outTime, outStatus, breaks, breakTotalMs, breakTotalStatus,
    workedMs, workedStatus, complete, inProgress, issues,
  };
}

/**
 * Build one person's report.
 * @param user   { uid, name, email, createdAt? }
 * @param shifts raw shift docs for this uid ({ date, inTime, outTime, breaks })
 */
export function buildPersonReport(user, shifts, period) {
  const joinMs = toMillis(user.createdAt);
  const joinKey = joinMs ? dateKey(joinMs) : null;

  // Bucket by the TIMEZONE date of clock-in (falls back to the stored date key).
  const byDate = new Map();
  for (const s of shifts) {
    const inMs = toMillis(s.inTime);
    if (!inMs) continue; // a doc without a clock-in carries no attendance
    const key = dateKey(inMs);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(s);
  }

  const days = [];
  const summary = {
    daysWorked: 0, totalWorkedMs: 0, totalBreakMs: 0,
    incompleteDays: 0, inProgressDays: 0, joinedMidPeriod: false, joinKey,
  };

  for (const date of period.dates) {
    const isToday = date === period.end;
    const dayShifts = (byDate.get(date) || [])
      .slice()
      .sort((a, b) => toMillis(a.inTime) - toMillis(b.inTime));

    if (dayShifts.length === 0) {
      const notJoined = joinKey && date < joinKey;
      days.push({ date, kind: notJoined ? 'not-joined' : 'no-activity', shifts: [] });
      continue;
    }

    const evaluated = dayShifts.map((s) => evaluateShift(s, isToday));
    days.push({ date, kind: 'worked', shifts: evaluated });
    summary.daysWorked += 1;
    for (const e of evaluated) {
      if (e.complete) {
        summary.totalWorkedMs += e.workedMs;
        summary.totalBreakMs += e.breakTotalMs;
      }
    }
    if (evaluated.some((e) => e.inProgress)) summary.inProgressDays += 1;
    else if (evaluated.some((e) => !e.complete)) summary.incompleteDays += 1;
  }

  summary.joinedMidPeriod = !!(joinKey && joinKey > period.start && joinKey <= period.end);
  const hasAnyRecord = days.some((d) => d.kind === 'worked');

  const notes = [];
  if (!hasAnyRecord) notes.push('No records in this period');
  if (summary.joinedMidPeriod) notes.push(`Joined ${joinKey}`);
  if (summary.incompleteDays) {
    notes.push(`${summary.incompleteDays} incomplete day(s) excluded from totals`);
  }
  if (summary.inProgressDays) notes.push('Today still in progress (excluded from totals)');
  summary.notes = notes.join('; ');

  return { user, days, summary, hasAnyRecord };
}

/**
 * @param users  [{ uid, name, email, role, createdAt? }]
 * @param shifts [{ uid, date, inTime, outTime, breaks }]
 */
export function buildAttendanceReport(users, shifts, nowMs, days = 30) {
  const period = reportPeriod(nowMs, days);
  const byUid = new Map();
  for (const s of shifts) {
    if (!s || !s.uid) continue;
    if (!byUid.has(s.uid)) byUid.set(s.uid, []);
    byUid.get(s.uid).push(s);
  }

  const people = users
    .slice()
    .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''))
    .map((u) => buildPersonReport(u, byUid.get(u.uid) || [], period));

  return { period, people, timezone: TIMEZONE, generatedAt: nowMs };
}

