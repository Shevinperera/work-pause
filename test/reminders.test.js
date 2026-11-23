import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TAG_PUNCH_IN,
  TAG_BREAK,
  TAG_PUNCH_OUT,
  TIMINGS,
  createReminderTracker,
  evaluateReminder,
  formatTabTitle,
} from '../reminders.js';

function baseSnapshot(overrides = {}) {
  return {
    enabled: true,
    permission: 'granted',
    role: 'employee',
    signedOut: false,
    shiftLoaded: true,
    shiftDate: '2026-11-23',
    status: 'idle',
    openBreakStartMs: null,
    workMs: 0,
    hidden: true,
    ...overrides,
  };
}

test('pinned/background tab fires clock-in popup right after browser opens, then repeats every 20m', () => {
  const tr = createReminderTracker();
  const t0 = 1_000_000;

  // Initial load: waits idleHiddenDelayMs (2s)
  assert.equal(evaluateReminder(tr, baseSnapshot({ hidden: true }), t0).notify, null);
  assert.equal(evaluateReminder(tr, baseSnapshot({ hidden: true }), t0 + 1_999).notify, null);

  const first = evaluateReminder(tr, baseSnapshot({ hidden: true }), t0 + 2_000);
  assert.equal(first.notify?.tag, TAG_PUNCH_IN);
  assert.match(first.notify.title, /clock in/i);

  // Does not spam before 20m
  assert.equal(evaluateReminder(tr, baseSnapshot({ hidden: true }), t0 + 5 * 60_000).notify, null);

  // Repeats at 20m
  const second = evaluateReminder(tr, baseSnapshot({ hidden: true }), t0 + 2_000 + TIMINGS.idleRepeatMs);
  assert.equal(second.notify?.tag, TAG_PUNCH_IN);
});

test('visible startup tab gives 15s grace before notifying, and clocking in closes the popup', () => {
  const tr = createReminderTracker();
  const t0 = 5_000_000;

  assert.equal(evaluateReminder(tr, baseSnapshot({ hidden: false }), t0).notify, null);
  assert.equal(evaluateReminder(tr, baseSnapshot({ hidden: false }), t0 + 10_000).notify, null);

  const fired = evaluateReminder(tr, baseSnapshot({ hidden: false }), t0 + TIMINGS.idleVisibleDelayMs);
  assert.equal(fired.notify?.tag, TAG_PUNCH_IN);

  // Employee clicks Clock in -> closes punch-in notification immediately
  const afterPunch = evaluateReminder(tr, baseSnapshot({ status: 'working', hidden: false }), t0 + 16_000);
  assert.equal(afterPunch.notify, null);
  assert.deepEqual(afterPunch.closeTags, [TAG_PUNCH_IN]);
});

test('no clock-in popup if already clocked in, admin, disabled, or shift still loading', () => {
  const t0 = 1_000_000;
  for (const overrides of [
    { status: 'working' },
    { status: 'ended' },
    { role: 'admin' },
    { enabled: false },
    { permission: 'default' },
    { shiftLoaded: false },
  ]) {
    const tr = createReminderTracker();
    evaluateReminder(tr, baseSnapshot(overrides), t0);
    const res = evaluateReminder(tr, baseSnapshot(overrides), t0 + 60_000);
    assert.equal(res.notify, null);
  }
});

test('07:00 shift-day rollover resets idle reminder for the new workday', () => {
  const tr = createReminderTracker();
  const t0 = 1_000_000;

  evaluateReminder(tr, baseSnapshot({ shiftDate: '2026-11-23' }), t0);
  assert.equal(
    evaluateReminder(tr, baseSnapshot({ shiftDate: '2026-11-23' }), t0 + 2_000).notify?.tag,
    TAG_PUNCH_IN,
  );

  // Next shift day begins: fires again after 2s without waiting 20m
  evaluateReminder(tr, baseSnapshot({ shiftDate: '2026-11-24' }), t0 + 60_000);
  const nextDay = evaluateReminder(tr, baseSnapshot({ shiftDate: '2026-11-24' }), t0 + 62_000);
  assert.equal(nextDay.notify?.tag, TAG_PUNCH_IN);
});

test('long break (60m + 30m repeat) and 10h clock-out reminders fire and close cleanly', () => {
  const tr = createReminderTracker();
  const start = 10_000_000;

  // Break under 60m -> silent
  assert.equal(
    evaluateReminder(tr, baseSnapshot({ status: 'break', openBreakStartMs: start }), start + 59 * 60_000).notify,
    null,
  );
  // At 60m -> fires
  const b1 = evaluateReminder(tr, baseSnapshot({ status: 'break', openBreakStartMs: start }), start + 60 * 60_000);
  assert.equal(b1.notify?.tag, TAG_BREAK);
  // At 75m -> silent; at 90m -> repeats
  assert.equal(
    evaluateReminder(tr, baseSnapshot({ status: 'break', openBreakStartMs: start }), start + 75 * 60_000).notify,
    null,
  );
  assert.equal(
    evaluateReminder(tr, baseSnapshot({ status: 'break', openBreakStartMs: start }), start + 90 * 60_000).notify?.tag,
    TAG_BREAK,
  );

  // Ending break closes break notification; hitting 10h worked fires clock-out reminder
  const endBreak = evaluateReminder(
    tr,
    baseSnapshot({ status: 'working', workMs: TIMINGS.workFirstMs }),
    start + 11 * 3_600_000,
  );
  assert.deepEqual(endBreak.closeTags, [TAG_BREAK]);
  assert.equal(endBreak.notify?.tag, TAG_PUNCH_OUT);

  // Clocking out closes clock-out notification
  const ended = evaluateReminder(tr, baseSnapshot({ status: 'ended' }), start + 11 * 3_600_000 + 5_000);
  assert.deepEqual(ended.closeTags, [TAG_PUNCH_OUT]);
});

test('signed-out browser startup reminds once if user previously enabled reminders', () => {
  const tr = createReminderTracker();
  const t0 = 2_000_000;
  const snap = baseSnapshot({ signedOut: true, role: null, shiftLoaded: false, status: null, hidden: true });

  assert.equal(evaluateReminder(tr, snap, t0).notify, null);
  const fired = evaluateReminder(tr, snap, t0 + 2_000);
  assert.equal(fired.notify?.tag, TAG_PUNCH_IN);
  assert.match(fired.notify.title, /sign in/i);
  assert.equal(evaluateReminder(tr, snap, t0 + 30 * 60_000).notify, null);
});

test('formatTabTitle highlights idle state for pinned tabs', () => {
  assert.equal(formatTabTitle('idle'), '● Not clocked in · Work Hours');
  assert.equal(formatTabTitle('break'), 'On break · Work Hours');
  assert.equal(formatTabTitle('working'), 'Working · Work Hours');
  assert.equal(formatTabTitle('ended'), 'Work Hours · Post Production');
  assert.equal(formatTabTitle(null), 'Work Hours · Post Production');
});
