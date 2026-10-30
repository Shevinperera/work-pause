// HTTP-level checks against a running `wrangler dev` (no credentials needed).
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
let failed = 0;
async function check(name, fn) {
  const t = Date.now();
  try {
    await fn();
    console.log(`PASS ${name} (${Date.now() - t}ms)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

for (const p of ['/', '/index.html', '/app.js', '/style.css', '/logo.png']) {
  await check(`static ${p} -> 200`, async () => {
    const r = await fetch(BASE + p);
    expect(r.status === 200, `got ${r.status}`);
  });
}
for (const p of ['/server/worker.js', '/server/auth.js', '/package.json', '/wrangler.json', '/test/fixtures.js', '/node_modules/xlsx/package.json', '/.assetsignore', '/.gitignore']) {
  await check(`private ${p} not served`, async () => {
    const r = await fetch(BASE + p);
    const body = await r.text();
    expect(r.status === 404 || (!body.includes('FIREBASE_PROJECT_ID') && !body.includes('"name"') && !body.includes('import ')), `got ${r.status}, body starts: ${body.slice(0, 60)}`);
    expect(r.status === 404, `got ${r.status}`);
  });
}
await check('export without token -> 401', async () => {
  const r = await fetch(`${BASE}/api/export`);
  expect(r.status === 401, `got ${r.status}`);
  expect((await r.json()).error, 'no error body');
});
await check('export with garbage token -> 401', async () => {
  const r = await fetch(`${BASE}/api/export`, { headers: { Authorization: 'Bearer abc.def.ghi' } });
  expect(r.status === 401, `got ${r.status}`);
});
await check('export with forged unsigned token -> 401', async () => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const forged = `${b({ alg: 'none', typ: 'JWT' })}.${b({ sub: 'x', aud: 'work-pause-2933d', iss: 'https://securetoken.google.com/work-pause-2933d', iat: now, exp: now + 600 })}.`;
  const r = await fetch(`${BASE}/api/export`, { headers: { Authorization: `Bearer ${forged}` } });
  expect(r.status === 401, `got ${r.status}`);
});
await check('POST export -> 405', async () => {
  const r = await fetch(`${BASE}/api/export`, { method: 'POST' });
  expect(r.status === 405, `got ${r.status}`);
});
await check('unknown api -> 404 json', async () => {
  const r = await fetch(`${BASE}/api/nope`);
  expect(r.status === 404, `got ${r.status}`);
});
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);

