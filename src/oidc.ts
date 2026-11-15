// Verifies a GitHub Actions OIDC token (a JWT that GitHub signs for each workflow run),
// so one specific workflow can read the usage counts without any shared secret: the
// maintainer's dashboard sync (.github/workflows/stats.yml) asks GitHub for a token with
// audience STATS_AUDIENCE and sends it to /stats.json. Uses Web Crypto only, so it runs
// on Node, Vercel, and Deno alike.

export const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com';
export const STATS_AUDIENCE = 'research-methods-stats';

export interface OidcPolicy {
  /** owner/name of the only repository whose workflow may read. */
  repository: string;
  /** The workflow file and branch that may read, e.g. `.github/workflows/stats.yml@refs/heads/main`. */
  workflow: string;
  audience?: string;
}

type Jwk = JsonWebKey & { kid?: string };
export type JwksFetcher = () => Promise<Jwk[]>;

let cache: { at: number; keys: Jwk[] } | undefined;

const fetchGithubJwks: JwksFetcher = async () => {
  const res = await fetch(`${GITHUB_ISSUER}/.well-known/jwks`);
  if (!res.ok) throw new Error(`GitHub JWKS responded ${res.status}`);
  return ((await res.json()) as { keys: Jwk[] }).keys;
};

async function keyFor(kid: string, fetchJwks: JwksFetcher): Promise<Jwk | undefined> {
  if (!cache || Date.now() - cache.at > 3_600_000 || !cache.keys.some((k) => k.kid === kid)) {
    cache = { at: Date.now(), keys: await fetchJwks() };
  }
  return cache.keys.find((k) => k.kid === kid);
}

/** For tests: forget cached keys. */
export function resetJwksCache() {
  cache = undefined;
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64url(s)));

/** True when `token` is a valid, unexpired GitHub OIDC token from the allowed workflow. */
export async function verifyGithubOidc(token: string, policy: OidcPolicy, fetchJwks: JwksFetcher = fetchGithubJwks): Promise<boolean> {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return false;
    const header = json(h) as { alg?: string; kid?: string };
    if (header.alg !== 'RS256' || !header.kid) return false;
    const jwk = await keyFor(header.kid, fetchJwks);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return false;

    const c = json(p) as Record<string, unknown>;
    const now = Date.now() / 1000;
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    return (
      c.iss === GITHUB_ISSUER &&
      aud.includes(policy.audience ?? STATS_AUDIENCE) &&
      typeof c.exp === 'number' && c.exp > now - 60 &&
      (typeof c.nbf !== 'number' || c.nbf < now + 60) &&
      c.repository === policy.repository &&
      c.workflow_ref === `${policy.repository}/${policy.workflow}`
    );
  } catch {
    return false;
  }
}
