// Turns the attendance report model into workbook sheets.
import { buildXlsx, excelDate, excelDuration, uniqueSheetName } from './xlsx.js';
import { timeHHmm } from './report.js';

const STATUS_LABEL = {
  missing: 'Missing',
  'in-progress': 'In progress',
  invalid: 'Invalid',
};

const PERSON_COLUMNS = [
  { header: 'Date', width: 12 },
  { header: 'Clock In', width: 10 },
  { header: 'Clock Out', width: 12 },
  { header: 'Break Start', width: 12 },
  { header: 'Break End', width: 12 },
  { header: 'Break Duration', width: 15 },
  { header: 'Total Worked Hours', width: 19 },
];

const SUMMARY_COLUMNS = [
  { header: 'Name', width: 26 },
  { header: 'Email', width: 32 },
  { header: 'Sheet', width: 24 },
  { header: 'Days Worked', width: 13 },
  { header: 'Total Hours', width: 13 },
  { header: 'Total Break Time', width: 17 },
  { header: 'Incomplete Days', width: 16 },
  { header: 'Notes', width: 60 },
];

const dur = (ms, bold = false) => ({ v: excelDuration(ms), s: bold ? 'boldDuration' : 'duration' });
const flag = (status) => ({ v: STATUS_LABEL[status] || status, s: status === 'in-progress' ? 'muted' : 'warn' });
const muted = (text) => ({ v: text, s: 'muted' });

function shiftRows(date, shift) {
  const rows = [];
  const dateCell = { v: excelDate(date), s: 'date' };
  const outCell = shift.outStatus === 'ok' || shift.outStatus === 'invalid'
    ? (shift.outTime ? timeHHmm(shift.outTime) : '')
    : flag(shift.outStatus);
  const workedCell = shift.workedStatus === 'ok' ? dur(shift.workedMs) : flag(shift.workedStatus);

  const breakCells = (b) => [
    timeHHmm(b.start),
    b.status === 'ok' || b.status === 'invalid' ? timeHHmm(b.end) : flag(b.status),
    b.status === 'ok' ? dur(b.durationMs) : flag(b.status),
  ];

  const first = shift.breaks[0];
  rows.push([
    dateCell,
    timeHHmm(shift.inTime),
    outCell,
    ...(first ? breakCells(first) : ['', '', dur(0)]),
    workedCell,
  ]);
  for (const b of shift.breaks.slice(1)) {
    rows.push([dateCell, '', '', ...breakCells(b), '']);
  }
  if (shift.breaks.length > 1) {
    rows.push([
      { v: excelDate(date), s: 'boldDate' },
      '', '', '',
      { v: 'Day total', s: 'bold' },
      shift.breakTotalStatus === 'ok' ? dur(shift.breakTotalMs, true) : flag(shift.breakTotalStatus),
      '',
    ]);
  }
  return rows;
}

function personRows(person) {
  const rows = [];
  for (const day of person.days) {
    if (day.kind === 'no-activity') {
      rows.push([{ v: excelDate(day.date), s: 'date' }, muted('No activity')]);
    } else if (day.kind === 'not-joined') {
      rows.push([{ v: excelDate(day.date), s: 'date' }, muted('Not joined yet')]);
    } else {
      for (const shift of day.shifts) rows.push(...shiftRows(day.date, shift));
    }
  }
  rows.push([]);
  rows.push([
    { v: 'Total (complete days)', s: 'bold' }, '', '', '', '',
    dur(person.summary.totalBreakMs, true),
    dur(person.summary.totalWorkedMs, true),
  ]);
  if (person.summary.notes) rows.push([muted(person.summary.notes)]);
  return rows;
}

export function attendanceFilename(period) {
  return `attendance_${period.start}_to_${period.end}.xlsx`;
}

/** @returns { filename, bytes: Uint8Array } */
export function buildAttendanceWorkbook(report) {
  const used = new Set(['summary']);
  const personSheets = report.people.map((p) => ({
    person: p,
    name: uniqueSheetName(p.user.name || p.user.email || p.user.uid, used),
  }));

  const summaryRows = personSheets.map(({ person, name }) => [
    person.user.name || '(no name)',
    person.user.email || '',
    name,
    person.summary.daysWorked,
    dur(person.summary.totalWorkedMs),
    dur(person.summary.totalBreakMs),
    person.summary.incompleteDays,
    person.summary.notes ? { v: person.summary.notes, s: person.hasAnyRecord ? 'default' : 'muted' } : '',
  ]);
  if (summaryRows.length === 0) summaryRows.push([muted('No employees found')]);
  summaryRows.push([]);
  summaryRows.push([muted(
    `Period ${report.period.start} to ${report.period.end} (${report.period.dates.length} days). `
    + `Times in ${report.timezone}, HH:mm. Totals include complete days only.`,
  )]);

  const sheets = [
    { name: 'Summary', columns: SUMMARY_COLUMNS, rows: summaryRows },
    ...personSheets.map(({ person, name }) => ({
      name,
      columns: PERSON_COLUMNS,
      rows: personRows(person),
    })),
  ];

  return { filename: attendanceFilename(report.period), bytes: buildXlsx(sheets) };
}

