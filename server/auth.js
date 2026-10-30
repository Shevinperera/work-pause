// Verifies Firebase Auth ID tokens (RS256 JWTs) with WebCrypto, no libraries.
// https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library

export const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const CLOCK_SKEW_S = 60;
let jwksCache = { keys: null, expiresAt: 0, url: null };

export class AuthError extends Error {}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(segment) {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(segment)));
  } catch {
    throw new AuthError('Malformed token');
  }
}

async function getJwks(fetchImpl, url, nowMs) {
  if (jwksCache.keys && jwksCache.url === url && jwksCache.expiresAt > nowMs) return jwksCache.keys;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Could not fetch signing keys (${res.status})`);
  const body = await res.json();
  const maxAge = Number((/max-age=(\d+)/.exec(res.headers.get('cache-control') || '') || [])[1] || 3600);
  jwksCache = { keys: body.keys || [], expiresAt: nowMs + maxAge * 1000, url };
  return jwksCache.keys;
}

/** For tests. */
export function resetJwksCache() {
  jwksCache = { keys: null, expiresAt: 0, url: null };
}

/**
 * @returns decoded claims ({ sub, email, ... }) or throws AuthError
 */
export async function verifyFirebaseIdToken(token, projectId, {
  fetchImpl = fetch, nowMs = Date.now(), jwksUrl = FIREBASE_JWKS_URL,
} = {}) {
  if (!token || typeof token !== 'string') throw new AuthError('Missing token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('Malformed token');
  const [h, p, sig] = parts;
  const header = decodeJson(h);
  const claims = decodeJson(p);

  if (header.alg !== 'RS256' || !header.kid) throw new AuthError('Unsupported token algorithm');

  const keys = await getJwks(fetchImpl, jwksUrl, nowMs);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new AuthError('Unknown signing key');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(sig),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new AuthError('Invalid token signature');

  const now = Math.floor(nowMs / 1000);
  if (typeof claims.exp !== 'number' || claims.exp < now - CLOCK_SKEW_S) throw new AuthError('Token expired');
  if (typeof claims.iat !== 'number' || claims.iat > now + CLOCK_SKEW_S) throw new AuthError('Token issued in the future');
  if (claims.aud !== projectId) throw new AuthError('Token audience mismatch');
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) throw new AuthError('Token issuer mismatch');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new AuthError('Token has no subject');
  if (typeof claims.auth_time === 'number' && claims.auth_time > now + CLOCK_SKEW_S) {
    throw new AuthError('Token auth_time in the future');
  }
  return claims;
}

