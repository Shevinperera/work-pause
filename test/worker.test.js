// Worker endpoint tests with a locally generated RSA key standing in for
// Google's signing keys, and a fake Firestore REST API.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import XLSX from 'xlsx';
import { handleExport } from '../server/worker.js';
import { resetJwksCache, FIREBASE_JWKS_URL } from '../server/auth.js';
import { PROJECT_ID, NOW, users, shifts } from './fixtures.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(claims, { key = privateKey, kid = 'k1' } = {}) {
  const now = Math.floor(NOW / 1000);
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`, aud: PROJECT_ID,
    iat: now - 10, exp: now + 3600, auth_time: now - 10, ...claims,
  };
  const data = `${b64u({ alg: 'RS256', kid, typ: 'JWT' })}.${b64u(payload)}`;
  const sig = createSign('RSA-SHA256').update(data).sign(key).toString('base64url');
  return `${data}.${sig}`;
}

const enc = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
};
const docOf = (coll, id, data) => ({
  name: `projects/${PROJECT_ID}/databases/(default)/documents/${coll}/${id}`,
  fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])),
});

const profiles = {
  admin1: { name: 'Admin', email: 'admin@example.com', role: 'admin' },
  ...Object.fromEntries(users.map(({ uid, ...u }) => [uid, u])),
};

let calls;
let firestoreDown;
async function fakeFetch(url, init = {}) {
  calls.push({ url, init });
  if (url === FIREBASE_JWKS_URL) {
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'max-age=600' } });
  }
  if (firestoreDown) return new Response('{}', { status: 503 });
  const m = /documents\/users\/([^/?]+)$/.exec(url);
  if (m) {
    const p = profiles[decodeURIComponent(m[1])];
    return p ? Response.json(docOf('users', m[1], p)) : new Response('{}', { status: 404 });
  }
  if (url.endsWith(':runQuery')) {
    const q = JSON.parse(init.body).structuredQuery;
    if (q.from[0].collectionId === 'users') {
      return Response.json(users.map(({ uid, ...u }) => ({ document: docOf('users', uid, u) })));
    }
    const [gte, lte] = q.where.compositeFilter.filters.map((f) => f.fieldFilter.value.stringValue);
    const hits = shifts.filter((s) => s.date >= gte && s.date <= lte);
    return Response.json([{ readTime: 'x' }, ...hits.map((s) => ({ document: docOf('shifts', `${s.uid}_${s.date}`, s) }))]);
  }
  return new Response('not found', { status: 404 });
}

const env = { FIREBASE_PROJECT_ID: PROJECT_ID };
const call = (headers = {}, method = 'GET') =>
  handleExport(new Request('https://app.test/api/export', { method, headers }), env, { fetchImpl: fakeFetch, now: () => NOW });

beforeEach(() => {
  calls = [];
  firestoreDown = false;
  resetJwksCache();
});

test('no token -> 401', async () => {
  const res = await call();
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('garbage token -> 401', async () => {
  assert.equal((await call({ Authorization: 'Bearer not.a.jwt' })).status, 401);
});

test('token signed by another key -> 401', async () => {
  assert.equal((await call({ Authorization: `Bearer ${sign({ sub: 'admin1' }, { key: other.privateKey })}` })).status, 401);
});

test('expired token -> 401', async () => {
  const t = sign({ sub: 'admin1', exp: Math.floor(NOW / 1000) - 3600 });
  assert.equal((await call({ Authorization: `Bearer ${t}` })).status, 401);
});

test('token for another Firebase project -> 401', async () => {
  const t = sign({ sub: 'admin1', aud: 'other-project', iss: 'https://securetoken.google.com/other-project' });
  assert.equal((await call({ Authorization: `Bearer ${t}` })).status, 401);
});

test('valid employee token -> 403 and no attendance data is read', async () => {
  const res = await call({ Authorization: `Bearer ${sign({ sub: 'alice' })}` });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'Admin access required' });
  assert.ok(!calls.some((c) => c.url.endsWith(':runQuery')));
});

test('valid token without a profile -> 403', async () => {
  assert.equal((await call({ Authorization: `Bearer ${sign({ sub: 'ghost' })}` })).status, 403);
});

test('admin -> 200 xlsx with correct headers and contents', async () => {
  const res = await call({ Authorization: `Bearer ${sign({ sub: 'admin1' })}` });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="attendance_2026-10-01_to_2026-10-30.xlsx"');
  const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' });
  assert.deepEqual(wb.SheetNames, ['Summary', 'Alice Perera', 'Bob Silva', 'Carol Fernando']);
  const summary = XLSX.utils.sheet_to_json(wb.Sheets.Summary, { header: 1, raw: false });
  assert.deepEqual(summary[1].slice(3, 7), ['6', '18:00', '1:00', '2']);
  // the query asked for one day of slack on each side
  const q = calls.find((c) => c.url.endsWith(':runQuery') && c.init.body.includes('"shifts"'));
  assert.match(q.init.body, /2026-09-30/);
  assert.match(q.init.body, /2026-10-31/);
  // Firestore was called with the caller's own token
  assert.ok(calls.filter((c) => c.url.includes('firestore')).every((c) => c.init.headers.Authorization.startsWith('Bearer ey')));
});

test('POST -> 405', async () => {
  assert.equal((await call({}, 'POST')).status, 405);
});

test('Firestore outage -> 502 (not a crash)', async () => {
  firestoreDown = true;
  assert.equal((await call({ Authorization: `Bearer ${sign({ sub: 'admin1' })}` })).status, 502);
});

