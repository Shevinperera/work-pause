// Read-only smoke test: real sign-in through the redesigned page for an admin
// and an employee, then sign out. Writes nothing to Firestore.
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const c = JSON.parse(readFileSync(fileURLToPath(new URL('./credentials.json', import.meta.url)), 'utf8'));
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
let failed = 0;
for (const [label, email, pass, view] of [
  ['admin', c.E2E_ADMIN_EMAIL, c.E2E_ADMIN_PASS, '#adminView'],
  ['employee', c.E2E_EMP2_EMAIL, c.E2E_EMP2_PASS, '#employeeView'],
]) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  try {
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('#loginView:not(.hidden)', { timeout: 20000 });
    await page.type('#emailInput', email);
    await page.type('#passwordInput', pass);
    await page.keyboard.press('Enter'); // submit via keyboard, not just the button
    await page.waitForSelector(`${view}:not(.hidden)`, { timeout: 20000 });
    await page.click(`${view} .logout-btn`);
    await page.waitForSelector('#loginView:not(.hidden)', { timeout: 20000 });
    const cleared = await page.$eval('#passwordInput', (e) => e.value === '');
    if (!cleared) throw new Error('password field not cleared after sign-in');
    console.log(`PASS ${label}: sign in (Enter key) -> ${view} -> log out -> sign-in page`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${label}: ${e.message}`);
  }
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);

