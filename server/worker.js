// Cloudflare Worker: serves the static app and the admin-only Excel export.
import { verifyFirebaseIdToken, AuthError } from './auth.js';
import { createFirestore, FirestoreError } from './firestore.js';
import { buildAttendanceReport, reportPeriod, addDays } from './report.js';
import { buildAttendanceWorkbook } from './workbook.js';

const REPORT_DAYS = 30;

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * GET /api/export  (Authorization: Bearer <Firebase ID token>)
 * 401 no/invalid token, 403 not an admin, 502 Firestore failure.
 */
export async function handleExport(request, env, { fetchImpl = fetch, now = Date.now } = {}) {
  if (request.method !== 'GET') return jsonError(405, 'Method not allowed');
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) return jsonError(500, 'Server is missing FIREBASE_PROJECT_ID');

  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  if (!match) return jsonError(401, 'Sign in required');
  const idToken = match[1].trim();

  let claims;
  try {
    claims = await verifyFirebaseIdToken(idToken, projectId, { fetchImpl, nowMs: now() });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(401, 'Invalid or expired session');
    return jsonError(502, 'Could not verify session');
  }

  const db = createFirestore({ projectId, idToken, fetchImpl });
  try {
    const profile = await db.getDoc(`users/${encodeURIComponent(claims.sub)}`);
    if (!profile || profile.role !== 'admin') return jsonError(403, 'Admin access required');

    const nowMs = now();
    const { start, end } = reportPeriod(nowMs, REPORT_DAYS);

    const [employees, shifts] = await Promise.all([
      db.runQuery('users', [['role', 'EQUAL', 'employee']]),
      // One day of slack on each side: shifts are bucketed by the Colombo date
      // of their clock-in, which can differ from the browser-local `date` key.
      db.runQuery('shifts', [
        ['date', 'GREATER_THAN_OR_EQUAL', addDays(start, -1)],
        ['date', 'LESS_THAN_OR_EQUAL', addDays(end, 1)],
      ]),
    ]);

    const users = employees.map((u) => ({ uid: u.id, ...u }));
    const report = buildAttendanceReport(users, shifts, nowMs, REPORT_DAYS);
    const { filename, bytes } = buildAttendanceWorkbook(report);

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof FirestoreError) {
      if (err.status === 401 || err.status === 403) return jsonError(403, 'Access denied by database rules');
      return jsonError(502, 'Database request failed');
    }
    console.error('export failed', err);
    return jsonError(500, 'Export failed');
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/export') return handleExport(request, env);
    if (url.pathname.startsWith('/api/')) return jsonError(404, 'Not found');
    return env.ASSETS.fetch(request);
  },
};
