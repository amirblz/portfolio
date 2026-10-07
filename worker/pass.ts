// The pass: proof that this browser solved Turnstile in the last half hour. A signed cookie, so the
// Worker keeps no state; its random id is the key the rate limits count against.

export const COOKIE = "__Host-ympass";
export const LIFETIME = 30 * 60;

const enc = new TextEncoder();

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function unb64url(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const key = (secret: string) =>
  crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function mint(secret: string, now = Date.now()) {
  const id = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const body = `${id}.${Math.floor(now / 1000) + LIFETIME}`;
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body)));
  return `${COOKIE}=${body}.${b64url(sig)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${LIFETIME}`;
}

/** The pass id when the request carries a valid, unexpired pass; null otherwise. */
export async function verify(request: Request, secret: string, now = Date.now()) {
  const value = (request.headers.get("Cookie") ?? "")
    .split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  const m = value?.match(/^([A-Za-z0-9_-]{22})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/);
  if (!m) return null;
  const [, id, exp, sig] = m;
  const left = Number(exp) - Math.floor(now / 1000);
  if (left <= 0 || left > LIFETIME) return null;
  const ok = await crypto.subtle.verify("HMAC", await key(secret), unb64url(sig), enc.encode(`${id}.${exp}`));
  return ok ? id : null;
}
