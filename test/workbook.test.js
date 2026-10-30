import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import XLSX from 'xlsx'; // independent reader (dev dependency only)
import { buildAttendanceReport } from '../server/report.js';
import { buildAttendanceWorkbook } from '../server/workbook.js';
import { users, shifts, NOW } from './fixtures.js';

const report = buildAttendanceReport(users, shifts, NOW);
const { filename, bytes } = buildAttendanceWorkbook(report);
mkdirSync(new URL('./output/', import.meta.url), { recursive: true });
writeFileSync(new URL(`./output/${filename}`, import.meta.url), bytes);

const wb = XLSX.read(bytes, { type: 'buffer', cellStyles: true, cellNF: true });
const raw = XLSX.read(bytes, { type: 'buffer', bookFiles: true });
const file = (name) => {
  const f = raw.files[name];
  return Buffer.from(f.content || f._data || f.asNodeBuffer()).toString('utf8');
};
const rows = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });

test('filename follows attendance_YYYY-MM-DD_to_YYYY-MM-DD.xlsx', () => {
  assert.equal(filename, 'attendance_2026-10-01_to_2026-10-30.xlsx');
});

test('one summary sheet plus one sheet per person', () => {
  assert.deepEqual(wb.SheetNames, ['Summary', 'Alice Perera', 'Bob Silva', 'Carol Fernando']);
});

test('header rows are bold and columns have widths', () => {
  const styles = file('xl/styles.xml');
  const xfs = [...styles.matchAll(/<xf [^>]*xfId="0"[^>]*\/>/g)].map((m) => m[0]);
  assert.match(xfs[1], /fontId="1"/);
  assert.match(styles, /<font><b\/>/); // font 1 is bold
  for (let i = 1; i <= 4; i++) {
    const xml = file(`xl/worksheets/sheet${i}.xml`);
    const headerRow = /<row r="1">(.*?)<\/row>/.exec(xml)[1];
    const cells = [...headerRow.matchAll(/<c [^>]*>/g)];
    assert.ok(cells.length >= 7);
    assert.ok(cells.every((c) => / s="1"/.test(c[0])), `sheet${i} header not bold`);
    assert.match(xml, /<col min="1" max="1" width="\d+" customWidth="1"\/>/);
  }
  assert.equal(wb.Sheets['Alice Perera']['!cols'].length, 7);
});

test('per-person columns are exactly as specified', () => {
  assert.deepEqual(rows('Alice Perera')[0], [
    'Date', 'Clock In', 'Clock Out', 'Break Start', 'Break End', 'Break Duration', 'Total Worked Hours',
  ]);
});

test('summary values match the report', () => {
  const r = rows('Summary');
  assert.deepEqual(r[0], ['Name', 'Email', 'Sheet', 'Days Worked', 'Total Hours', 'Total Break Time', 'Incomplete Days', 'Notes']);
  const alice = r.find((x) => x[0] === 'Alice Perera');
  assert.deepEqual(alice.slice(0, 7), ['Alice Perera', 'alice@example.com', 'Alice Perera', '6', '18:00', '1:00', '2']);
  const bob = r.find((x) => x[0] === 'Bob Silva');
  assert.deepEqual(bob.slice(3, 7), ['0', '0:00', '0:00', '0']);
  assert.match(bob[7], /No records/);
  const carol = r.find((x) => x[0] === 'Carol Fernando');
  assert.deepEqual(carol.slice(3, 7), ['2', '11:00', '0:30', '0']);
  assert.match(carol[7], /Joined 2026-10-20/);
});

test('Alice sheet: multi-break day, missing values, timezone', () => {
  const r = rows('Alice Perera');
  const forDate = (d) => r.filter((x) => x[0] === d);

  const oct28 = forDate('2026-10-28');
  assert.deepEqual(oct28[0], ['2026-10-28', '09:00', '17:30', '12:00', '12:45', '0:45', '7:30']);
  assert.deepEqual(oct28[1], ['2026-10-28', '', '', '15:00', '15:15', '0:15', '']);
  assert.deepEqual(oct28[2], ['2026-10-28', '', '', '', 'Day total', '1:00', '']);

  assert.deepEqual(forDate('2026-10-29')[0], ['2026-10-29', '08:30', '17:00', '', '', '0:00', '8:30']);
  assert.deepEqual(forDate('2026-10-27')[0], ['2026-10-27', '09:00', 'Missing', '12:00', '12:30', '0:30', 'Missing']);
  assert.deepEqual(forDate('2026-10-26')[0], ['2026-10-26', '09:00', '18:00', '13:00', 'Missing', 'Missing', 'Missing']);
  assert.deepEqual(forDate('2026-10-30')[0], ['2026-10-30', '09:00', 'In progress', '12:30', 'In progress', 'In progress', 'In progress']);
  // stored as 2026-10-24 (US browser) but 01:30 on the 25th in Colombo
  assert.deepEqual(forDate('2026-10-25')[0], ['2026-10-25', '01:30', '03:30', '', '', '0:00', '2:00']);
  assert.equal(forDate('2026-10-24')[0][1], 'No activity');
  assert.equal(forDate('2026-10-01')[0][1], 'No activity');

  const total = r.find((x) => x[0] === 'Total (complete days)');
  assert.deepEqual(total.slice(5, 7), ['1:00', '18:00']);
});

test('Bob and Carol sheets: no records / not joined', () => {
  const bob = rows('Bob Silva');
  assert.equal(bob.filter((x) => x[1] === 'No activity').length, 30);
  const carol = rows('Carol Fernando');
  assert.equal(carol.filter((x) => x[1] === 'Not joined yet').length, 19); // Oct 1..19
  assert.deepEqual(carol.find((x) => x[0] === '2026-10-20'), ['2026-10-20', '10:30', '18:00', '13:00', '13:30', '0:30', '7:00']);
  assert.deepEqual(carol.find((x) => x[0] === '2026-10-22'), ['2026-10-22', '22:00', '02:00', '', '', '0:00', '4:00']);
});

test('durations are real numbers Excel can sum', () => {
  const sheet = wb.Sheets['Summary'];
  assert.equal(sheet.E2.t, 'n');
  assert.equal(Math.round(sheet.E2.v * 1440), 18 * 60);
  assert.equal(sheet.E2.z, '[h]:mm');
});

test('empty employee list still produces a valid workbook', () => {
  const r = buildAttendanceReport([], [], NOW);
  const out = buildAttendanceWorkbook(r);
  const w = XLSX.read(out.bytes, { type: 'buffer' });
  assert.deepEqual(w.SheetNames, ['Summary']);
});

test('sheet names are sanitised and de-duplicated', () => {
  const r = buildAttendanceReport(
    [
      { uid: 'a', name: 'Sam / QA: [night]?', email: 'a@x' },
      { uid: 'b', name: 'Sam / QA: [night]?', email: 'b@x' },
      { uid: 'c', name: 'A very long employee name that exceeds limits', email: 'c@x' },
      { uid: 'd', name: '', email: 'd@x' },
    ],
    [],
    NOW,
  );
  const w = XLSX.read(buildAttendanceWorkbook(r).bytes, { type: 'buffer' });
  assert.equal(new Set(w.SheetNames.map((n) => n.toLowerCase())).size, w.SheetNames.length);
  assert.ok(w.SheetNames.every((n) => n.length <= 31 && !/[[\]:*?/\\]/.test(n)));
  assert.ok(w.SheetNames.includes('d@x'));
});
