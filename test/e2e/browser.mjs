// Browser end-to-end test against `wrangler dev` + the real Firebase project.
// Credentials come from env vars only:
//   E2E_ADMIN_EMAIL / E2E_ADMIN_PASS      admin account
//   E2E_EMP_EMAIL   / E2E_EMP_PASS        employee used for clock/break flow + seeded edge cases
//   E2E_EMP2_EMAIL  / E2E_EMP2_PASS       employee that must have NO records
// Without credentials only the login-page checks run.
// Seeded data is written ONLY under the two test employee UIDs and removed at the end.
import puppeteer from 'puppeteer-core';
import XLSX from 'xlsx';
import { mkdirSync, readdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verseForDate, colomboDateKey } from '../../verse.js';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const API_KEY = 'AIzaSyAhlILJWDXk7SNUXW30Yz_aOskYNXD2gYk';
const PROJECT = 'work-pause-2933d';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const OUT = fileURLToPath(new URL('../output/e2e/', import.meta.url));
const SHOTS = join(OUT, 'screens');
const DL = join(OUT, 'downloads');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// Optional git-ignored credentials file: test/e2e/credentials.json
// { "E2E_ADMIN_EMAIL": "...", "E2E_ADMIN_PASS": "...", "E2E_EMP_EMAIL": "...", ... }
const credFile = fileURLToPath(new URL('./credentials.json', import.meta.url));
const env = { ...(existsSync(credFile) ? JSON.parse(readFileSync(credFile, 'utf8')) : {}), ...process.env };
const haveCreds = env.E2E_LOGIN_ONLY !== '1' && env.E2E_ADMIN_EMAIL && env.E2E_EMP_EMAIL && env.E2E_EMP2_EMAIL;
const SKIP_CLEANUP = env.E2E_SKIP_CLEANUP === '1';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
mkdirSync(DL, { recursive: true });

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, note });
    console.log(`PASS ${name}${note ? ` — ${note}` : ''} (${Date.now() - t}ms)`);
  } catch (e) {
    results.push({ name, ok: false, note: e.message });
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Firebase REST helpers (independent of app code) ----------
async function signIn(email, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`signIn ${email}: ${j.error?.message}`);
  return { uid: j.localId, token: j.idToken };
}
const enc = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
};
const dec = (v) => {
  if (!v) return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
  return null;
};
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]));
async function fsGet(token, path) {
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${path}: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return Object.fromEntries(Object.entries(j.fields || {}).map(([k, v]) => [k, dec(v)]));
}
async function fsSet(token, path, data, mask) {
  const qs = mask ? '?' + mask.map((m) => `updateMask.fieldPaths=${m}`).join('&') : '';
  const r = await fetch(`${FS}/${path}${qs}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fields(data) }),
  });
  if (!r.ok) throw new Error(`PATCH ${path}: ${r.status} ${await r.text()}`);
}
async function fsDelete(token, path) {
  const r = await fetch(`${FS}/${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`DELETE ${path}: ${r.status} ${await r.text()}`);
}
async function fsQuery(token, collectionId, field, op, value) {
  const r = await fetch(`${FS}:runQuery`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], where: { fieldFilter: { field: { fieldPath: field }, op, value: { stringValue: value } } } } }),
  });
  if (!r.ok) throw new Error(`query ${collectionId}: ${r.status} ${await r.text()}`);
  return (await r.json()).filter((x) => x.document).map((x) => ({
    id: x.document.name.split('/').pop(),
    ...Object.fromEntries(Object.entries(x.document.fields || {}).map(([k, v]) => [k, dec(v)])),
  }));
}

// ---------- Independent Colombo-time helpers (fixed +05:30, no Intl) ----------
const OFFSET = (5 * 60 + 30) * 60000;
const cDate = (ms) => new Date(ms + OFFSET).toISOString().slice(0, 10);
const cTime = (ms) => new Date(ms + OFFSET).toISOString().slice(11, 16);
const cAt = (date, hhmm) => Date.parse(`${date}T${hhmm}:00Z`) - OFFSET;
const addDays = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const hmm = (ms) => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

// ---------- Browser helpers ----------
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'],
});
const consoleErrors = [];
async function newPage({ mobile = false, theme = 'light' } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 860 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('workHoursTheme', t), theme);
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`); });
  page.on('dialog', async (d) => {
    if (d.type() === 'prompt') await d.accept(page.__promptAnswer || 'E2E User');
    else await d.accept();
  });
  const cdp = await page.createCDPSession();
  // Downloads must be configured for this (non-default) browser context.
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, browserContextId: ctx.id, eventsEnabled: true });
  page.__ctx = ctx;
  return page;
}
const visible = (page, sel) => page.$eval(sel, (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)).catch(() => false);
const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim());
async function waitText(page, sel, re, timeout = 15000) {
  await page.waitForFunction((s, src) => {
    const el = document.querySelector(s);
    return el && new RegExp(src).test(el.textContent);
  }, { timeout }, sel, re.source);
}
async function login(page, email, pass) {
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#loginView:not(.hidden), #adminView:not(.hidden), #employeeView:not(.hidden)', { timeout: 20000 });
  if (!(await visible(page, '#loginView'))) {
    await page.click('#adminView:not(.hidden) .logout-btn, #employeeView:not(.hidden) .logout-btn');
    await page.waitForSelector('#loginView:not(.hidden)');
  }
  await page.type('#emailInput', email);
  await page.type('#passwordInput', pass);
  await page.click('#loginBtn');
  await page.waitForSelector('#adminView:not(.hidden), #employeeView:not(.hidden)', { timeout: 20000 });
}
async function waitForDownload(predicate, timeout = 30000) {
  const t = Date.now();
  while (Date.now() - t < timeout) {
    const f = readdirSync(DL).find((n) => predicate(n) && !n.endsWith('.crdownload'));
    if (f) return join(DL, f);
    await sleep(250);
  }
  throw new Error('download did not arrive');
}

// =====================================================================
// 1. Login page (no credentials needed)
// =====================================================================
{
  const page = await newPage();
  await step('login page renders after boot state', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginView:not(.hidden)', { timeout: 20000 });
    expect(!(await visible(page, '#bootView')), 'boot loader still visible');
    expect(await page.$eval('#passwordInput', (e) => e.value) === '', 'password is pre-filled');
    await sleep(1800); // intro animation
    await page.screenshot({ path: join(SHOTS, '01-login-desktop-light.png') });
  });
  await step('login: empty submit shows inline validation', async () => {
    await page.click('#loginBtn');
    await waitText(page, '#loginErrorText', /Enter your email and password/);
    expect(await page.$eval('#emailInput', (e) => e.getAttribute('aria-invalid')) === 'true', 'email not marked invalid');
  });
  await step('login: wrong password shows error (no alert)', async () => {
    await page.type('#emailInput', 'nobody-e2e@example.invalid');
    await page.type('#passwordInput', 'definitely-wrong');
    await page.click('#loginBtn');
    await waitText(page, '#loginErrorText', /Incorrect email or password|Sign-in failed|valid email/);
    await page.screenshot({ path: join(SHOTS, '02-login-error.png') });
    return await text(page, '#loginErrorText');
  });
  await step('focus ring visible on keyboard focus', async () => {
    await page.focus('#emailInput');
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle + '|' + getComputedStyle(document.activeElement).boxShadow);
    expect(/solid|rgba/.test(outline), `no focus style: ${outline}`);
  });
  await step('theme toggle switches and persists', async () => {
    await page.click('#themeToggleBtn');
    const t = await page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem('workHoursTheme')]);
    expect(t[0] === 'dark' && t[1] === 'dark', `got ${t}`);
    await page.screenshot({ path: join(SHOTS, '03-login-dark.png') });
  });
  const m = await newPage({ mobile: true });
  await step('login page on mobile (390px) has no horizontal overflow', async () => {
    await m.goto(BASE, { waitUntil: 'networkidle2' });
    await m.waitForSelector('#loginView:not(.hidden)', { timeout: 20000 });
    await sleep(1800); // let the intro animation finish before the screenshot
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await m.screenshot({ path: join(SHOTS, '04-login-mobile.png'), fullPage: true });
    expect(overflow <= 0, `overflow ${overflow}px`);
  });
  await step('login page at tablet width (820px) and live date in illustration', async () => {
    const t = await newPage();
    await t.setViewport({ width: 820, height: 1000 });
    await t.goto(BASE, { waitUntil: 'networkidle2' });
    await t.waitForSelector('#loginView:not(.hidden)', { timeout: 20000 });
    await sleep(1800);
    const overflow = await t.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const artDate = await t.$eval('.login-verse .current-date', (e) => e.textContent.trim());
    await t.screenshot({ path: join(SHOTS, '05-login-tablet.png'), fullPage: true });
    await t.__ctx.close();
    expect(overflow <= 0, `overflow ${overflow}px`);
    expect(/\d{4}/.test(artDate), `illustration date not filled: "${artDate}"`);
    return artDate;
  });
  await step("verse panel shows today's verse (Asia/Colombo)", async () => {
    const p = await newPage();
    await p.goto(BASE, { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginView:not(.hidden)', { timeout: 20000 });
    const expected = verseForDate(colomboDateKey());
    const shown = await p.evaluate(() => ({
      text: document.querySelector('[data-verse-text]').textContent.trim(),
      ref: document.querySelector('[data-verse-ref]').textContent.trim(),
      size: document.querySelector('[data-daily-verse]').dataset.size,
      font: getComputedStyle(document.querySelector('[data-verse-text]')).fontFamily,
    }));
    await p.__ctx.close();
    expect(shown.text === expected.text && shown.ref === expected.ref, `shown ${shown.ref}, expected ${expected.ref}`);
    expect(/Source Serif 4/.test(shown.font), `font ${shown.font}`);
    return `${shown.ref} (${shown.size})`;
  });
  await step('verse changes by itself when the page is open across midnight', async () => {
    // Fake the page clock to 10 s before the next Colombo midnight.
    const realNow = Date.now();
    const tomorrow = addDays(colomboDateKey(realNow), 1);
    const offset = (Date.parse(`${tomorrow}T00:00:00+05:30`) - 10000) - realNow;
    const p = await newPage();
    await p.evaluateOnNewDocument((off) => {
      const RealDate = Date;
      class FakeDate extends RealDate {
        constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); }
        static now() { return RealDate.now() + off; }
      }
      window.Date = FakeDate;
    }, offset);
    await p.goto(BASE, { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginView:not(.hidden)', { timeout: 20000 });
    const before = await p.$eval('[data-verse-ref]', (e) => e.textContent.trim());
    const today = verseForDate(addDays(tomorrow, -1)).ref;
    const next = verseForDate(tomorrow).ref;
    expect(before === today, `before midnight showed ${before}, expected ${today}`);
    await p.waitForFunction((r) => document.querySelector('[data-verse-ref]').textContent.trim() === r, { timeout: 75000 }, next);
    await sleep(1500); // let the entrance animation finish
    const vis = await p.evaluate(() => ['.verse-mark', '.verse-text', '.verse-ref'].map((s) => getComputedStyle(document.querySelector(s)).opacity));
    await p.screenshot({ path: join(SHOTS, '06-login-after-midnight.png') });
    await p.__ctx.close();
    expect(vis.every((o) => o === '1'), `new verse not fully visible after rollover, opacity ${vis}`);
    return `${before} -> ${next}`;
  });
  await page.__ctx.close();
  await m.__ctx.close();
}

if (!haveCreds) {
  console.log('\nNo E2E credentials provided; stopping after login-page checks.');
  await finish();
}

// =====================================================================
// 2. Accounts & first-login profiles
// =====================================================================
const admin = await signIn(env.E2E_ADMIN_EMAIL, env.E2E_ADMIN_PASS);
const emp = await signIn(env.E2E_EMP_EMAIL, env.E2E_EMP_PASS);
const emp2 = await signIn(env.E2E_EMP2_EMAIL, env.E2E_EMP2_PASS);
const today = cDate(Date.now());
const seeded = []; // shift doc paths we create
let empProfileBefore = null;
let emp2ProfileCreated = false;

await step('pre-check: admin profile has role=admin', async () => {
  const p = await fsGet(admin.token, `users/${admin.uid}`);
  expect(p && p.role === 'admin', `role=${p && p.role}`);
});
await step('pre-check: test employees have no shifts in the last 30 days (safe to seed)', async () => {
  for (const u of [emp, emp2]) {
    const s = await fsQuery(u.token, 'shifts', 'uid', 'EQUAL', u.uid);
    const recent = s.filter((x) => x.date >= addDays(today, -31));
    expect(recent.length === 0, `${u.uid} already has ${recent.length} recent shift(s); refusing to overwrite`);
  }
});

// Employee 2 signs in once through the UI (creates the profile, answers name prompt)
await step('employee #2 first sign-in creates profile via name prompt', async () => {
  const before = await fsGet(emp2.token, `users/${emp2.uid}`);
  const page = await newPage();
  page.__promptAnswer = 'E2E NoRecords';
  await login(page, env.E2E_EMP2_EMAIL, env.E2E_EMP2_PASS);
  expect(await visible(page, '#employeeView'), 'employee view not shown');
  await waitText(page, '#historyBody', /No entries this month/);
  await page.screenshot({ path: join(SHOTS, '10-employee2-empty-history.png') });
  await page.__ctx.close();
  const after = await fsGet(emp2.token, `users/${emp2.uid}`);
  expect(after && after.role === 'employee', 'profile missing');
  emp2ProfileCreated = !before;
  return before ? 'profile already existed' : `created, createdAt=${after.createdAt}`;
});

// =====================================================================
// 3. Employee: clock in / breaks / clock out / undo through the UI
// =====================================================================
const page = await newPage();
page.__promptAnswer = 'E2E Employee';
await step('employee login shows employee view, not admin', async () => {
  await login(page, env.E2E_EMP_EMAIL, env.E2E_EMP_PASS);
  expect(await visible(page, '#employeeView'), 'employee view hidden');
  expect(!(await visible(page, '#adminView')), 'admin view visible');
  expect(!(await visible(page, '#adminExportBtn')), 'admin export button visible to employee');
  await page.waitForFunction(() => !document.querySelector('#punchInBtn').disabled, { timeout: 15000 });
  await page.screenshot({ path: join(SHOTS, '11-employee-idle.png') });
});
empProfileBefore = await fsGet(emp.token, `users/${emp.uid}`);
seeded.push(`shifts/${emp.uid}_${today}`);

const clickAndWait = async (sel, statusRe) => {
  await page.click(sel);
  await waitText(page, '#statusText', statusRe);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), { timeout: 15000 });
  await sleep(400);
};
await step('clock in -> Working', async () => {
  await clickAndWait('#punchInBtn', /^Working$/);
  expect(await page.$eval('#punchInBtn', (b) => b.disabled), 'clock in still enabled');
  expect(/^\d\d:\d\d$/.test(await text(page, '#todayIn')), 'clocked-in time not HH:mm');
});
await step('start break -> On break', async () => {
  await sleep(1500);
  await clickAndWait('#breakBtn', /^On break$/);
  expect(await text(page, '#breakBtn') === 'End break', 'label not End break');
  await page.screenshot({ path: join(SHOTS, '12-employee-on-break.png') });
});
await step('end break -> Working', async () => { await sleep(1500); await clickAndWait('#breakBtn', /^Working$/); });
await step('second break start/end', async () => {
  await sleep(1000); await clickAndWait('#breakBtn', /^On break$/);
  await sleep(1000); await clickAndWait('#breakBtn', /^Working$/);
});
await step('clock out -> Shift ended, undo visible', async () => {
  await clickAndWait('#punchOutBtn', /^Shift ended$/);
  expect(await visible(page, '#resetPunchOutBtn'), 'undo not visible');
});
await step('undo clock out (confirm) -> Working again', async () => {
  await clickAndWait('#resetPunchOutBtn', /^Working$/);
  const d = await fsGet(emp.token, `shifts/${emp.uid}_${today}`);
  expect(d.outTime === null, 'outTime not cleared in Firestore');
});
await step('clock out while on break closes the break', async () => {
  await clickAndWait('#breakBtn', /^On break$/);
  await sleep(1000);
  await clickAndWait('#punchOutBtn', /^Shift ended$/);
});
let todayDoc;
await step('Firestore doc matches the actions', async () => {
  todayDoc = await fsGet(emp.token, `shifts/${emp.uid}_${today}`);
  expect(todayDoc.uid === emp.uid && todayDoc.date === today, `uid/date wrong: ${todayDoc.date}`);
  expect(todayDoc.inTime && todayDoc.outTime > todayDoc.inTime, 'in/out wrong');
  expect(todayDoc.breaks.length === 3, `breaks=${todayDoc.breaks.length}`);
  expect(todayDoc.breaks.every((b) => b.end && b.end >= b.start), 'open/invalid break');
  return `3 breaks, in ${cTime(todayDoc.inTime)} out ${cTime(todayDoc.outTime)}`;
});
await step('history table shows today with HH:mm times', async () => {
  await waitText(page, '#historyTodayRow', /Today/);
  const cells = await page.$$eval('#historyTodayRow td', (tds) => tds.map((t) => t.textContent.trim()));
  expect(cells[1] === cTime(todayDoc.inTime), `clock in ${cells[1]} != ${cTime(todayDoc.inTime)}`);
  expect(cells[2] === cTime(todayDoc.outTime), `clock out ${cells[2]} != ${cTime(todayDoc.outTime)}`);
  await page.screenshot({ path: join(SHOTS, '13-employee-ended.png'), fullPage: true });
});
await step('month navigation prev/next', async () => {
  const label0 = await text(page, '#monthLabel');
  await page.click('#prevMonth');
  const label1 = await text(page, '#monthLabel');
  expect(label1 !== label0, 'label unchanged');
  await page.click('#nextMonth');
  expect(await text(page, '#monthLabel') === label0, 'did not return');
  return `${label0} -> ${label1} -> ${label0}`;
});
await step('employee monthly export (client-side) downloads', async () => {
  await page.click('#exportBtn');
  const f = await waitForDownload((n) => n.startsWith('WorkHours_'));
  const wb = XLSX.read(readFileSync(f));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const row = rows.find((r) => r[0] === today);
  expect(row && row[1] === cTime(todayDoc.inTime), `row ${JSON.stringify(row)}`);
  return f.split(/[\\/]/).pop();
});

// =====================================================================
// 4. Seed edge cases (only under test employee UID) and mid-period join
// =====================================================================
const D = (n) => addDays(today, -n);
const seedShifts = [
  // multi-break complete day: 09:00-17:30, breaks 12:00-12:45, 15:00-15:20 -> break 1:05, worked 7:25
  { date: D(3), inTime: cAt(D(3), '09:00'), outTime: cAt(D(3), '17:30'), breaks: [{ start: cAt(D(3), '12:00'), end: cAt(D(3), '12:45') }, { start: cAt(D(3), '15:00'), end: cAt(D(3), '15:20') }] },
  // missing clock-out
  { date: D(4), inTime: cAt(D(4), '08:45'), outTime: null, breaks: [{ start: cAt(D(4), '13:00'), end: cAt(D(4), '13:30') }] },
  // break never ended
  { date: D(5), inTime: cAt(D(5), '09:15'), outTime: cAt(D(5), '18:00'), breaks: [{ start: cAt(D(5), '12:30'), end: null }] },
  // complete, no breaks: 10:00-16:10 -> 6:10
  { date: D(6), inTime: cAt(D(6), '10:00'), outTime: cAt(D(6), '16:10'), breaks: [] },
  // early-morning clock-in (00:20 Colombo = previous day in UTC) -> 00:20-04:20 -> 4:00
  { date: D(7), inTime: cAt(D(7), '00:20'), outTime: cAt(D(7), '04:20'), breaks: [] },
];
const joinDate = D(10);
await step('seed edge-case shifts for test employee', async () => {
  for (const s of seedShifts) {
    const path = `shifts/${emp.uid}_${s.date}`;
    await fsSet(emp.token, path, { uid: emp.uid, ...s });
    seeded.push(path);
  }
  return `${seedShifts.length} docs (${D(7)}..${D(3)})`;
});
let joinSet = false;
await step('mark test employee as joined mid-period (createdAt)', async () => {
  await fsSet(emp.token, `users/${emp.uid}`, { createdAt: cAt(joinDate, '09:00') }, ['createdAt']);
  joinSet = true;
  return `joined ${joinDate}`;
});

const historyRow = async (date) => {
  const [y, m, d] = date.split('-').map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const rows = await page.$$eval('#historyBody tr.data-row', (trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent.trim().replace(/\s+/g, ' '))));
  return rows.find((r) => r[0].startsWith(label));
};
await step('employee history: edge-case rows show Missing, not runaway totals', async () => {
  if (D(7).slice(0, 7) !== today.slice(0, 7)) return 'skipped (seeded days fall in the previous month)';
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#historyBody tr.data-row', { timeout: 20000 });
  const openBreak = await historyRow(D(5));
  expect(openBreak && openBreak[3] === 'Missing' && openBreak[4] === 'Missing', `break-never-ended row ${JSON.stringify(openBreak)}`);
  const noOut = await historyRow(D(4));
  expect(noOut && noOut[2] === 'Missing' && noOut[3] === '0h 30m' && noOut[4] === 'Missing', `missing-clock-out row ${JSON.stringify(noOut)}`);
  const multi = await historyRow(D(3));
  expect(multi && multi[3] === '1h 5m' && multi[4] === '7h 25m', `multi-break row ${JSON.stringify(multi)}`);
  return 'open break, missing clock-out, multi-break all correct';
});
await step('employee monthly export: edge-case rows show Missing', async () => {
  if (D(7).slice(0, 7) !== today.slice(0, 7)) return 'skipped (previous month)';
  for (const f of readdirSync(DL).filter((n) => n.startsWith('WorkHours_'))) rmSync(join(DL, f));
  await page.click('#exportBtn');
  const f = await waitForDownload((n) => n.startsWith('WorkHours_'));
  const wb = XLSX.read(readFileSync(f));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const r5 = rows.find((r) => r[0] === D(5));
  const r4 = rows.find((r) => r[0] === D(4));
  expect(r5 && r5[3] === 'Missing' && r5[4] === 'Missing', `open-break row ${JSON.stringify(r5)}`);
  expect(r4 && r4[2] === 'Missing' && r4[3] === '0h 30m' && r4[4] === 'Missing', `no-clock-out row ${JSON.stringify(r4)}`);
});

// =====================================================================
// 5. Non-admin access to the export
// =====================================================================
await step('employee token -> /api/export is 403', async () => {
  const r = await fetch(`${BASE}/api/export`, { headers: { Authorization: `Bearer ${emp.token}` } });
  expect(r.status === 403, `got ${r.status}`);
  return JSON.stringify(await r.json());
});
await step('employee calling export from inside the app session -> 403', async () => {
  const status = await page.evaluate(async () => {
    const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    const t = await getAuth().currentUser.getIdToken();
    return (await fetch('/api/export', { headers: { Authorization: `Bearer ${t}` } })).status;
  });
  expect(status === 403, `got ${status}`);
});
await step('tampered admin token (payload swapped) -> 401', async () => {
  const [h, , s] = admin.token.split('.');
  const p = emp.token.split('.')[1];
  const r = await fetch(`${BASE}/api/export`, { headers: { Authorization: `Bearer ${h}.${p}.${s}` } });
  expect(r.status === 401, `got ${r.status}`);
});
await page.__ctx.close();

// =====================================================================
// 6. Admin dashboard, filters, export through the UI
// =====================================================================
const ap = await newPage();
await step('admin login shows live dashboard', async () => {
  await login(ap, env.E2E_ADMIN_EMAIL, env.E2E_ADMIN_PASS);
  expect(await visible(ap, '#adminView'), 'admin view hidden');
  await ap.waitForSelector('#adminTableBody tr.data-row', { timeout: 20000 });
  await ap.screenshot({ path: join(SHOTS, '20-admin-desktop-light.png'), fullPage: true });
  return `${await text(ap, '#totalEmpCount')} employees, ${await text(ap, '#adminResultCount')}`;
});
await step('admin table: test employee row shows Shift ended + HH:mm', async () => {
  await ap.$eval('#adminSearch', (e) => { e.value = ''; });
  await ap.type('#adminSearch', env.E2E_EMP_EMAIL);
  const rows = await ap.$$eval('#adminTableBody tr.data-row', (trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent.trim().replace(/\s+/g, ' '))));
  expect(rows.length === 1, `rows=${rows.length}`);
  expect(/Shift ended/.test(rows[0][1]), `status ${rows[0][1]}`);
  expect(rows[0][2] === cTime(todayDoc.inTime) && rows[0][3] === cTime(todayDoc.outTime), `times ${rows[0][2]} ${rows[0][3]}`);
});
await step('filter: status "Working" excludes the ended test employee', async () => {
  await ap.select('#adminStatusFilter', 'working');
  await waitText(ap, '#adminTableBody', /No matching employees/);
  await ap.screenshot({ path: join(SHOTS, '21-admin-filter-empty.png') });
});
await step('filter: "Clear filters" resets search and status', async () => {
  await ap.click('#clearFiltersBtn');
  expect(await ap.$eval('#adminSearch', (e) => e.value) === '', 'search not cleared');
  expect(await ap.$eval('#adminStatusFilter', (e) => e.value) === 'all', 'status not reset');
  await ap.waitForSelector('#adminTableBody tr.data-row');
});
await step('filter: status "Not started" shows employee #2, counts consistent', async () => {
  await ap.select('#adminStatusFilter', 'idle');
  const names = await ap.$$eval('#adminTableBody tr.data-row .cell-sub', (e) => e.map((x) => x.textContent.trim().toLowerCase()));
  expect(names.includes(env.E2E_EMP2_EMAIL.toLowerCase()), 'employee #2 missing');
  expect(String(names.length) === await text(ap, '#idleEmpCount'), `rows ${names.length} != metric ${await text(ap, '#idleEmpCount')}`);
  await ap.select('#adminStatusFilter', 'all');
});
await step('filter: search is case-insensitive on name', async () => {
  const p2 = await fsGet(emp2.token, `users/${emp2.uid}`);
  const name = p2.name || '';
  const flipped = [...name].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
  await ap.type('#adminSearch', flipped);
  const emails = await ap.$$eval('#adminTableBody tr.data-row .cell-sub', (e) => e.map((x) => x.textContent.trim().toLowerCase()));
  await ap.$eval('#adminSearch', (e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
  expect(emails.includes(env.E2E_EMP2_EMAIL.toLowerCase()), `searched "${flipped}", got ${emails.length} rows without employee #2`);
  return `searched "${flipped}" -> ${emails.length} row(s)`;
});

let xlsxPath;
await step('Download Excel button downloads attendance_<start>_to_<end>.xlsx', async () => {
  await ap.click('#adminExportBtn');
  // The app reports the outcome on screen; check that first so an app error is visible.
  await ap.waitForFunction(() => !document.querySelector('#exportStatus').classList.contains('hidden'), { timeout: 60000 });
  const status = await text(ap, '#exportStatusText');
  expect(/Downloaded/.test(status), `app says: ${status}`);
  xlsxPath = await waitForDownload((n) => n.startsWith('attendance_'), 30000);
  const name = xlsxPath.split(/[\\/]/).pop();
  expect(name === `attendance_${D(29)}_to_${today}.xlsx`, `name ${name}`);
  await ap.screenshot({ path: join(SHOTS, '22-admin-export-done.png') });
  return name;
});
await step('admin dark mode + mobile layout render', async () => {
  const m = await newPage({ mobile: true, theme: 'dark' });
  await login(m, env.E2E_ADMIN_EMAIL, env.E2E_ADMIN_PASS);
  await m.waitForSelector('#adminTableBody tr.data-row', { timeout: 20000 });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await m.screenshot({ path: join(SHOTS, '23-admin-mobile-dark.png'), fullPage: true });
  await m.__ctx.close();
  expect(overflow <= 0, `overflow ${overflow}px`);
});
await step('employee mobile layout render', async () => {
  const m = await newPage({ mobile: true });
  await login(m, env.E2E_EMP_EMAIL, env.E2E_EMP_PASS);
  await m.waitForSelector('#historyTodayRow', { timeout: 20000 });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await m.screenshot({ path: join(SHOTS, '14-employee-mobile.png'), fullPage: true });
  await m.__ctx.close();
  expect(overflow <= 0, `overflow ${overflow}px`);
});
await ap.__ctx.close();

// =====================================================================
// 7. Verify the downloaded workbook against Firestore (independent calc)
// =====================================================================
if (xlsxPath) {
  const wb = XLSX.read(readFileSync(xlsxPath), { cellStyles: true });
  const raw = XLSX.read(readFileSync(xlsxPath), { bookFiles: true });
  const rowsOf = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' });
  const summary = rowsOf('Summary');
  const employees = await fsQuery(admin.token, 'users', 'role', 'EQUAL', 'employee');
  const start = D(29);
  const allShifts = (await fsQuery(admin.token, 'shifts', 'date', 'GREATER_THAN_OR_EQUAL', addDays(start, -1)))
    .filter((s) => s.inTime && cDate(s.inTime) >= start && cDate(s.inTime) <= today);

  await step('workbook: Summary + one sheet per employee, bold headers, widths', async () => {
    expect(wb.SheetNames[0] === 'Summary', 'first sheet not Summary');
    expect(wb.SheetNames.length === employees.length + 1, `${wb.SheetNames.length - 1} sheets vs ${employees.length} employees`);
    const styles = Buffer.from(raw.files['xl/styles.xml'].content).toString();
    expect(/<font><b\/>/.test(styles), 'no bold font');
    const s1 = Buffer.from(raw.files['xl/worksheets/sheet2.xml'].content).toString();
    expect(/<row r="1">(<c [^>]* s="1"[^>]*>.*?<\/c>)+<\/row>/.test(s1), 'header row not styled bold');
    expect(/<col min="1" max="1" width="\d+"/.test(s1), 'no column widths');
  });

  await step('workbook: summary totals match Firestore for EVERY employee', async () => {
    let checked = 0;
    for (const u of employees) {
      const mine = allShifts.filter((s) => s.uid === u.id);
      const days = new Set(mine.map((s) => cDate(s.inTime)));
      let worked = 0; let brk = 0;
      for (const s of mine) {
        const isToday = cDate(s.inTime) === today;
        const breaks = (s.breaks || []).filter((b) => b && b.start);
        const complete = s.outTime && s.outTime >= s.inTime && breaks.every((b) => b.end && b.end >= b.start);
        if (!complete) continue;
        const b = breaks.reduce((a, x) => a + (x.end - x.start), 0);
        if (s.outTime - s.inTime - b < 0) continue;
        worked += s.outTime - s.inTime - b; brk += b;
        void isToday;
      }
      const row = summary.find((r) => r[1] === (u.email || '') && r[0] === (u.name || '(no name)'));
      expect(row, `no summary row for uid ${u.id.slice(0, 6)}…`);
      expect(Number(row[3]) === days.size, `days ${row[3]} != ${days.size} for ${u.id.slice(0, 6)}`);
      // Excel rounds each duration to whole minutes; allow 1 min per complete shift
      const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
      expect(Math.abs(toMin(row[4]) - worked / 60000) <= mine.length + 1, `hours ${row[4]} vs ${hmm(worked)} for ${u.id.slice(0, 6)}`);
      expect(Math.abs(toMin(row[5]) - brk / 60000) <= mine.length + 1, `break ${row[5]} vs ${hmm(brk)} for ${u.id.slice(0, 6)}`);
      checked++;
    }
    return `${checked} employees, ${allShifts.length} shifts in period`;
  });

  const empRow = summary.find((r) => r[1] === env.E2E_EMP_EMAIL);
  const sheet = empRow ? rowsOf(empRow[2]) : [];
  const forDate = (d) => sheet.filter((r) => r[0] === d);
  await step('test employee sheet: columns as specified', async () => {
    expect(JSON.stringify(sheet[0]) === JSON.stringify(['Date', 'Clock In', 'Clock Out', 'Break Start', 'Break End', 'Break Duration', 'Total Worked Hours']), JSON.stringify(sheet[0]));
  });
  await step('edge: several breaks listed + day total', async () => {
    const r = forDate(D(3));
    expect(JSON.stringify(r[0]) === JSON.stringify([D(3), '09:00', '17:30', '12:00', '12:45', '0:45', '7:25']), JSON.stringify(r[0]));
    expect(JSON.stringify(r[1]) === JSON.stringify([D(3), '', '', '15:00', '15:20', '0:20', '']), JSON.stringify(r[1]));
    expect(r[2][4] === 'Day total' && r[2][5] === '1:05', JSON.stringify(r[2]));
  });
  await step('edge: missing clock-out shown as Missing', async () => {
    const r = forDate(D(4))[0];
    expect(r[1] === '08:45' && r[2] === 'Missing' && r[6] === 'Missing' && r[5] === '0:30', JSON.stringify(r));
  });
  await step('edge: break never ended shown as Missing', async () => {
    const r = forDate(D(5))[0];
    expect(r[3] === '12:30' && r[4] === 'Missing' && r[5] === 'Missing' && r[6] === 'Missing', JSON.stringify(r));
  });
  await step('timezone: 00:20 Colombo clock-in stays on its Colombo date', async () => {
    const r = forDate(D(7))[0];
    expect(r && r[1] === '00:20' && r[2] === '04:20' && r[6] === '4:00', JSON.stringify(r));
  });
  await step('timezone: today row matches Firestore epoch times in Asia/Colombo', async () => {
    const r = forDate(today);
    expect(r[0][1] === cTime(todayDoc.inTime) && r[0][2] === cTime(todayDoc.outTime), JSON.stringify(r[0]));
    const brs = r.filter((x) => x[3] && x[4] !== 'Day total');
    expect(brs.length === 3, `break rows ${brs.length}`);
    todayDoc.breaks.forEach((b, i) => expect(brs[i][3] === cTime(b.start) && brs[i][4] === cTime(b.end), `break ${i} ${JSON.stringify(brs[i])}`));
  });
  await step('edge: days with no activity + mid-period join', async () => {
    expect(forDate(D(1))[0][1] === 'No activity', JSON.stringify(forDate(D(1))[0]));
    expect(forDate(D(11))[0][1] === 'Not joined yet', JSON.stringify(forDate(D(11))[0]));
    expect(forDate(D(29))[0][1] === 'Not joined yet', 'start of period');
    expect(forDate(joinDate)[0][1] === 'No activity', 'join day');
    expect(/Joined/.test(empRow[7]), `notes: ${empRow[7]}`);
  });
  await step('edge: test employee summary (4 days worked complete, 2 incomplete)', async () => {
    // complete: D3 7:25, D6 6:10, D7 4:00, today (computed above)
    const todayBreak = todayDoc.breaks.reduce((a, b) => a + (b.end - b.start), 0);
    const todayWorked = todayDoc.outTime - todayDoc.inTime - todayBreak;
    const expWorked = (7 * 60 + 25 + 6 * 60 + 10 + 4 * 60) * 60000 + todayWorked;
    expect(empRow[3] === '6', `days ${empRow[3]}`);
    expect(empRow[6] === '2', `incomplete ${empRow[6]}`);
    expect(empRow[4] === hmm(expWorked), `hours ${empRow[4]} vs ${hmm(expWorked)}`);
    expect(empRow[5] === hmm(65 * 60000 + todayBreak), `break ${empRow[5]}`);
  });
  await step('edge: employee with no records', async () => {
    const r = summary.find((x) => x[1] === env.E2E_EMP2_EMAIL);
    expect(r && r[3] === '0' && r[4] === '0:00' && r[5] === '0:00', JSON.stringify(r));
    expect(/No records/.test(r[7]), r[7]);
    const s2 = rowsOf(r[2]).slice(1, 31);
    expect(s2.every((x) => x[1] === 'No activity' || x[1] === 'Not joined yet'), 'unexpected rows');
  });
}

// =====================================================================
// 8. Cleanup
// =====================================================================
async function cleanup() {
  if (SKIP_CLEANUP) { console.log('cleanup skipped (E2E_SKIP_CLEANUP=1)'); return; }
  await step('cleanup: delete seeded/test shifts', async () => {
    for (const p of seeded) await fsDelete(emp.token, p);
    return `${seeded.length} docs`;
  });
  if (joinSet) {
    await step('cleanup: restore test employee createdAt', async () => {
      const prev = empProfileBefore && empProfileBefore.createdAt;
      if (prev) await fsSet(emp.token, `users/${emp.uid}`, { createdAt: prev }, ['createdAt']);
      else {
        const r = await fetch(`${FS}/users/${emp.uid}?updateMask.fieldPaths=createdAt`, {
          method: 'PATCH', headers: { Authorization: `Bearer ${emp.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: {} }),
        });
        if (!r.ok) throw new Error(`${r.status}`);
      }
    });
  }
  void emp2ProfileCreated;
}
await cleanup();
await finish();

async function finish() {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  const relevantErrors = consoleErrors.filter((e) => !/favicon|ERR_BLOCKED_BY_CLIENT|status of 401|status of 403|status of 400/.test(e));
  if (relevantErrors.length) console.log('Browser console errors:\n  ' + [...new Set(relevantErrors)].join('\n  '));
  console.log(`Screenshots: ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
}
