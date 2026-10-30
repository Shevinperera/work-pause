// Test-only worker: runs the report/xlsx code inside workerd (the real
// Cloudflare runtime, which runs in UTC) and returns computed values.
import { buildAttendanceReport, dateKey, timeHHmm } from '../server/report.js';
import { buildAttendanceWorkbook } from '../server/workbook.js';
import { users, shifts, NOW } from './fixtures.js';

export default {
  async fetch() {
    const report = buildAttendanceReport(users, shifts, NOW);
    const { filename, bytes } = buildAttendanceWorkbook(report);
    const alice = report.people.find((p) => p.user.uid === 'alice').summary;
    return Response.json({
      runtimeOffsetMinutes: new Date().getTimezoneOffset(),
      dateKey: dateKey(Date.parse('2026-10-24T20:00:00Z')),
      time: timeHHmm(Date.parse('2026-10-24T20:00:00Z')),
      filename,
      bytes: bytes.length,
      alice: { daysWorked: alice.daysWorked, workedH: alice.totalWorkedMs / 3600000, breakM: alice.totalBreakMs / 60000 },
    });
  },
};

