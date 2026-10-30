// Shared fixtures: every edge case from the spec, with known expected values.
export const PROJECT_ID = 'test-project';
// "Now" = 2026-10-30 12:55 Asia/Colombo  -> period 2026-10-01 .. 2026-10-30
export const NOW = Date.parse('2026-10-30T12:55:00+05:30');

/** Epoch ms for a wall-clock time in Asia/Colombo (+05:30, no DST). */
export const at = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+05:30`);

export const users = [
  { uid: 'alice', name: 'Alice Perera', email: 'alice@example.com', role: 'employee', createdAt: at('2026-01-05', '09:00') },
  { uid: 'bob', name: 'Bob Silva', email: 'bob@example.com', role: 'employee' }, // no records, no createdAt
  { uid: 'carol', name: 'Carol Fernando', email: 'carol@example.com', role: 'employee', createdAt: at('2026-10-20', '08:00') },
];

export const shifts = [
  // Alice: two breaks in a day -> 60 min break, 7:30 worked
  { uid: 'alice', date: '2026-10-28', inTime: at('2026-10-28', '09:00'), outTime: at('2026-10-28', '17:30'),
    breaks: [{ start: at('2026-10-28', '12:00'), end: at('2026-10-28', '12:45') }, { start: at('2026-10-28', '15:00'), end: at('2026-10-28', '15:15') }] },
  // Alice: no breaks -> 8:30 worked
  { uid: 'alice', date: '2026-10-29', inTime: at('2026-10-29', '08:30'), outTime: at('2026-10-29', '17:00'), breaks: [] },
  // Alice: missing clock-out (past day)
  { uid: 'alice', date: '2026-10-27', inTime: at('2026-10-27', '09:00'), outTime: null,
    breaks: [{ start: at('2026-10-27', '12:00'), end: at('2026-10-27', '12:30') }] },
  // Alice: break started, never ended (but clocked out)
  { uid: 'alice', date: '2026-10-26', inTime: at('2026-10-26', '09:00'), outTime: at('2026-10-26', '18:00'),
    breaks: [{ start: at('2026-10-26', '13:00'), end: null }] },
  // Alice: today, currently on break
  { uid: 'alice', date: '2026-10-30', inTime: at('2026-10-30', '09:00'), outTime: null,
    breaks: [{ start: at('2026-10-30', '12:30'), end: null }] },
  // Alice: outside the period (must be ignored)
  { uid: 'alice', date: '2026-09-30', inTime: at('2026-09-30', '09:00'), outTime: at('2026-09-30', '17:00'), breaks: [] },
  // Alice: stored with a US browser date key; Colombo date of clock-in is 2026-10-25 01:30
  { uid: 'alice', date: '2026-10-24', inTime: Date.parse('2026-10-24T20:00:00Z'), outTime: Date.parse('2026-10-24T22:00:00Z'), breaks: [] },

  // Carol: joined 2026-10-20 mid-period. 10:30-18:00 with 30 min break -> 7:00
  { uid: 'carol', date: '2026-10-20', inTime: at('2026-10-20', '10:30'), outTime: at('2026-10-20', '18:00'),
    breaks: [{ start: at('2026-10-20', '13:00'), end: at('2026-10-20', '13:30') }] },
  // Carol: overnight shift 22:00 -> 02:00 next day -> 4:00, bucketed on 2026-10-22
  { uid: 'carol', date: '2026-10-22', inTime: at('2026-10-22', '22:00'), outTime: at('2026-10-23', '02:00'), breaks: [] },
];

