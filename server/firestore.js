// Tiny Firestore REST client. Requests are made with the caller's Firebase
// ID token, so Firestore security rules still apply on top of our checks.

export class FirestoreError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function decodeValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  if ('referenceValue' in v) return v.referenceValue;
  return null;
}

export function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
  return out;
}

export function createFirestore({ projectId, idToken, fetchImpl = fetch }) {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const headers = { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };

  async function getDoc(path) {
    const res = await fetchImpl(`${base}/${path}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new FirestoreError(`Firestore read failed (${res.status})`, res.status);
    const body = await res.json();
    return { id: body.name.split('/').pop(), ...decodeFields(body.fields) };
  }

  async function runQuery(collectionId, filters) {
    const fieldFilters = filters.map(([field, op, value]) => ({
      fieldFilter: { field: { fieldPath: field }, op, value: { stringValue: value } },
    }));
    const where = fieldFilters.length === 1
      ? fieldFilters[0]
      : { compositeFilter: { op: 'AND', filters: fieldFilters } };
    const res = await fetchImpl(`${base}:runQuery`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], where } }),
    });
    if (!res.ok) throw new FirestoreError(`Firestore query failed (${res.status})`, res.status);
    const rows = await res.json();
    return rows
      .filter((r) => r.document)
      .map((r) => ({ id: r.document.name.split('/').pop(), ...decodeFields(r.document.fields) }));
  }

  return { getDoc, runQuery };
}

