// Pure reminder scheduling & tab-title logic for Work Hours.
// Kept free of DOM/Firebase globals so it can be unit-tested in Node.

export const REMINDER_PREF_KEY = 'workHoursReminders';
export const REMINDER_DISMISSED_KEY = 'workHoursReminderDismissed';

export const TAG_PUNCH_IN = 'work-hours-punch-in';
export const TAG_BREAK = 'work-hours-break';
export const TAG_PUNCH_OUT = 'work-hours-punch-out';

export const TIMINGS = {
  idleHiddenDelayMs: 2_000,      // pinned / background tab on browser startup
  idleVisibleDelayMs: 15_000,    // visible startup tab if user hasn't clicked Clock in yet
  idleRepeatMs: 20 * 60_000,     // repeat every 20m while still not clocked in
  breakFirstMs: 60 * 60_000,     // first alert after 60m on break
  breakRepeatMs: 30 * 60_000,    // repeat every 30m while break remains open
  workFirstMs: 10 * 3_600_000,   // alert at 10h worked (forgot to clock out)
  workRepeatMs: 2 * 3_600_000,   // repeat every 2h after 10h
};

const DEFAULT_TITLE = 'Work Hours · Post Production';

export function formatTabTitle(status) {
  if (status === 'idle') return '● Not clocked in · Work Hours';
  if (status === 'break') return 'On break · Work Hours';
  if (status === 'working') return 'Working · Work Hours';
  return DEFAULT_TITLE;
}

export function createReminderTracker() {
  return {
    shiftDate: null,
    idleReadyAt: null,
    lastIdleAt: 0,
    signedOutReadyAt: null,
    signedOutNotified: false,
    openBreakStart: null,
    lastBreakAt: 0,
    lastWorkAt: 0,
    prevStatus: null,
  };
}

/**
 * Advance the tracker and decide whether to show or close notifications.
 *
 * @param tracker   mutable state from createReminderTracker()
 * @param snapshot  {
 *   enabled: boolean,
 *   permission: 'granted' | 'default' | 'denied' | 'unsupported',
 *   role: 'employee' | 'admin' | null,
 *   signedOut: boolean,
 *   shiftLoaded: boolean,
 *   shiftDate: string | null,
 *   status: 'idle' | 'working' | 'break' | 'ended' | null,
 *   openBreakStartMs: number | null,
 *   workMs: number,
 *   hidden: boolean,
 * }
 * @param nowMs     current epoch ms
 * @returns {{ notify: { tag: string, title: string, body: string } | null, closeTags: string[] }}
 */
export function evaluateReminder(tracker, snapshot, nowMs) {
  const closeTags = [];

  if (snapshot.shiftDate && tracker.shiftDate !== snapshot.shiftDate) {
    tracker.shiftDate = snapshot.shiftDate;
    tracker.idleReadyAt = null;
    tracker.lastIdleAt = 0;
    tracker.openBreakStart = null;
    tracker.lastBreakAt = 0;
    tracker.lastWorkAt = 0;
  }

  // Close stale notifications on status transitions
  if (tracker.prevStatus && tracker.prevStatus !== snapshot.status) {
    if (tracker.prevStatus === 'idle' && snapshot.status !== 'idle') closeTags.push(TAG_PUNCH_IN);
    if (tracker.prevStatus === 'break' && snapshot.status !== 'break') closeTags.push(TAG_BREAK);
    if (snapshot.status === 'ended') closeTags.push(TAG_PUNCH_OUT);
  }
  tracker.prevStatus = snapshot.status;

  if (!snapshot.enabled || snapshot.permission !== 'granted') {
    return { notify: null, closeTags };
  }

  // Signed-out browser launch when employee previously enabled reminders
  if (snapshot.signedOut) {
    if (tracker.signedOutReadyAt === null) tracker.signedOutReadyAt = nowMs;
    const waitMs = snapshot.hidden ? TIMINGS.idleHiddenDelayMs : TIMINGS.idleVisibleDelayMs;
    if (!tracker.signedOutNotified && nowMs - tracker.signedOutReadyAt >= waitMs) {
      tracker.signedOutNotified = true;
      return {
        notify: {
          tag: TAG_PUNCH_IN,
          title: 'Sign in to clock in',
          body: 'Work Hours is open — click here to sign in and start your shift.',
        },
        closeTags,
      };
    }
    return { notify: null, closeTags };
  }

  tracker.signedOutReadyAt = null;
  tracker.signedOutNotified = false;

  if (snapshot.role !== 'employee' || !snapshot.shiftLoaded || !snapshot.status) {
    return { notify: null, closeTags };
  }

  // 1. Not clocked in yet (fires right after opening browser, then every 20m)
  if (snapshot.status === 'idle') {
    if (tracker.idleReadyAt === null) tracker.idleReadyAt = nowMs;
    const initialDelay = snapshot.hidden ? TIMINGS.idleHiddenDelayMs : TIMINGS.idleVisibleDelayMs;
    if (tracker.lastIdleAt === 0) {
      if (nowMs - tracker.idleReadyAt >= initialDelay) {
        tracker.lastIdleAt = nowMs;
        return {
          notify: {
            tag: TAG_PUNCH_IN,
            title: 'Remember to clock in',
            body: "You haven't clocked in to Work Hours yet — click here to start your shift.",
          },
          closeTags,
        };
      }
    } else if (nowMs - tracker.lastIdleAt >= TIMINGS.idleRepeatMs) {
      tracker.lastIdleAt = nowMs;
      return {
        notify: {
          tag: TAG_PUNCH_IN,
          title: 'Still not clocked in',
          body: "Don't forget to clock in on Work Hours if you've started working.",
        },
        closeTags,
      };
    }
    return { notify: null, closeTags };
  }

  tracker.idleReadyAt = null;

  // 2. Long break reminder (60m, then every 30m)
  if (snapshot.status === 'break' && snapshot.openBreakStartMs) {
    if (tracker.openBreakStart !== snapshot.openBreakStartMs) {
      tracker.openBreakStart = snapshot.openBreakStartMs;
      tracker.lastBreakAt = 0;
    }
    const breakElapsed = nowMs - snapshot.openBreakStartMs;
    if (breakElapsed >= TIMINGS.breakFirstMs) {
      if (tracker.lastBreakAt === 0 || nowMs - tracker.lastBreakAt >= TIMINGS.breakRepeatMs) {
        tracker.lastBreakAt = nowMs;
        const mins = Math.floor(breakElapsed / 60_000);
        return {
          notify: {
            tag: TAG_BREAK,
            title: 'Still on break?',
            body: `Your break has been running for ${mins} minutes. Click here to end your break.`,
          },
          closeTags,
        };
      }
    }
    return { notify: null, closeTags };
  }

  tracker.openBreakStart = null;
  tracker.lastBreakAt = 0;

  // 3. Long shift / forgot to clock out (10h, then every 2h)
  if (snapshot.status === 'working' && snapshot.workMs >= TIMINGS.workFirstMs) {
    if (tracker.lastWorkAt === 0 || nowMs - tracker.lastWorkAt >= TIMINGS.workRepeatMs) {
      tracker.lastWorkAt = nowMs;
      const hrs = Math.floor(snapshot.workMs / 3_600_000);
      return {
        notify: {
          tag: TAG_PUNCH_OUT,
          title: 'Remember to clock out',
          body: `Your shift has been active for ${hrs} hours. Don't forget to clock out when leaving.`,
        },
        closeTags,
      };
    }
  }

  return { notify: null, closeTags };
}
