import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAttendanceReport, reportPeriod, dateKey, timeHHmm } from '../server/report.js';
import { users, shifts, NOW, at } from './fixtures.js';

const H = 3600000;
const M = 60000;

const report = buildAttendanceReport(users, shifts, NOW);
const person = (uid) => report.people.find((p) => p.user.uid === uid);
const day = (uid, date) => person(uid).days.find((d) => d.date === date);

test('runs independent of the machine timezone', () => {
  // Reported so the test log shows which TZ this run used.
  console.log(`process TZ=${process.env.TZ || '(system)'} offset=${new Date().getTimezoneOffset()}`);
  assert.equal(dateKey(Date.parse('2026-10-24T20:00:00Z')), '2026-10-25');
  assert.equal(timeHHmm(Date.parse('2026-10-24T20:00:00Z')), '01:30');
  assert.equal(timeHHmm(at('2026-10-28', '09:05')), '09:05');
});

test('period is the last 30 Colombo days including today', () => {
  const p = reportPeriod(NOW);
  assert.equal(p.start, '2026-10-01');
  assert.equal(p.end, '2026-10-30');
  assert.equal(p.dates.length, 30);
  // 23:00 UTC on Oct 30 is already Oct 31 in Colombo
  assert.equal(reportPeriod(Date.parse('2026-10-30T23:00:00Z')).end, '2026-10-31');
});

test('several breaks in a day: each listed, day total and worked hours correct', () => {
  const s = day('alice', '2026-10-28').shifts[0];
  assert.equal(s.breaks.length, 2);
  assert.deepEqual(s.breaks.map((b) => b.durationMs), [45 * M, 15 * M]);
  assert.equal(s.breakTotalMs, 60 * M);
  assert.equal(s.workedMs, 7.5 * H);
  assert.equal(s.complete, true);
});

test('missing clock-out on a past day is flagged and not counted', () => {
  const s = day('alice', '2026-10-27').shifts[0];
  assert.equal(s.outStatus, 'missing');
  assert.equal(s.workedStatus, 'missing');
  assert.equal(s.workedMs, null);
  assert.equal(s.breaks[0].durationMs, 30 * M);
});

test('break never ended is flagged; worked hours unknown', () => {
  const s = day('alice', '2026-10-26').shifts[0];
  assert.equal(s.breaks[0].status, 'missing');
  assert.equal(s.breakTotalStatus, 'missing');
  assert.equal(s.workedStatus, 'missing');
});

test('today in progress is marked in-progress, not missing', () => {
  const s = day('alice', '2026-10-30').shifts[0];
  assert.equal(s.outStatus, 'in-progress');
  assert.equal(s.breaks[0].status, 'in-progress');
  assert.equal(s.inProgress, true);
});

test('shift is bucketed by Colombo date, not the stored browser date', () => {
  assert.equal(day('alice', '2026-10-24').kind, 'no-activity');
  const s = day('alice', '2026-10-25').shifts[0];
  assert.equal(timeHHmm(s.inTime), '01:30');
  assert.equal(s.workedMs, 2 * H);
});

test('days with no activity and out-of-period shifts', () => {
  assert.equal(day('alice', '2026-10-01').kind, 'no-activity');
  assert.equal(person('alice').days.length, 30);
  assert.ok(!person('alice').days.some((d) => d.date === '2026-09-30'));
});

test('Alice summary totals only include complete days', () => {
  const s = person('alice').summary;
  assert.equal(s.daysWorked, 6); // 25, 26, 27, 28, 29, 30
  assert.equal(s.totalWorkedMs, (7.5 + 8.5 + 2) * H);
  assert.equal(s.totalBreakMs, 60 * M);
  assert.equal(s.incompleteDays, 2);
  assert.equal(s.inProgressDays, 1);
  assert.match(s.notes, /2 incomplete day/);
});

test('person with no records', () => {
  const p = person('bob');
  assert.equal(p.hasAnyRecord, false);
  assert.equal(p.summary.daysWorked, 0);
  assert.equal(p.summary.totalWorkedMs, 0);
  assert.ok(p.days.every((d) => d.kind === 'no-activity'));
  assert.match(p.summary.notes, /No records/);
});

test('person who joined mid-period', () => {
  const p = person('carol');
  assert.equal(day('carol', '2026-10-19').kind, 'not-joined');
  assert.equal(day('carol', '2026-10-01').kind, 'not-joined');
  assert.equal(day('carol', '2026-10-21').kind, 'no-activity');
  assert.equal(p.summary.joinedMidPeriod, true);
  assert.equal(p.summary.daysWorked, 2);
  assert.equal(p.summary.totalWorkedMs, 11 * H); // 7h + overnight 4h
  assert.equal(p.summary.totalBreakMs, 30 * M);
  assert.match(p.summary.notes, /Joined 2026-10-20/);
});

test('overnight shift stays on its clock-in day', () => {
  const s = day('carol', '2026-10-22').shifts[0];
  assert.equal(s.workedMs, 4 * H);
  assert.equal(day('carol', '2026-10-23').kind, 'no-activity');
});

test('corrupt data does not crash and is flagged', () => {
  const r = buildAttendanceReport(
    [{ uid: 'x', name: 'X' }],
    [
      { uid: 'x', date: '2026-10-10', inTime: at('2026-10-10', '10:00'), outTime: at('2026-10-10', '09:00'), breaks: null },
      { uid: 'x', date: '2026-10-11', inTime: at('2026-10-11', '10:00'), outTime: at('2026-10-11', '11:00'),
        breaks: [{ start: at('2026-10-11', '10:10'), end: at('2026-10-11', '10:05') }, null, { start: null }] },
      { uid: 'x', date: '2026-10-12', inTime: null, outTime: null, breaks: [] },
      { uid: 'x', date: '2026-10-13', inTime: String(at('2026-10-13', '09:00')), outTime: { seconds: at('2026-10-13', '10:00') / 1000 } },
    ],
    NOW,
  );
  const d = (k) => r.people[0].days.find((x) => x.date === k);
  assert.equal(d('2026-10-10').shifts[0].workedStatus, 'invalid');
  assert.equal(d('2026-10-11').shifts[0].breaks.length, 1);
  assert.equal(d('2026-10-11').shifts[0].workedStatus, 'invalid');
  assert.equal(d('2026-10-12').kind, 'no-activity');
  assert.equal(d('2026-10-13').shifts[0].workedMs, H);
  assert.equal(r.people[0].summary.totalWorkedMs, H);
});

