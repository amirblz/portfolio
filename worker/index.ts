// The site's Worker: static assets, plus the two endpoints behind the messenger's Send.
//   POST /api/pass  Turnstile token in, 30-minute pass cookie out.
//   POST /api/send  one or more of the visitor's lines, e-mailed to Amir.
// Nothing is stored and no message text is logged.

import { body, parse, subject, threadId, tooLong, type Mx, OWN_DOMAIN } from "./mail";
import { mint, verify } from "./pass";

export interface Env {
  ASSETS: Fetcher;
  MAIL: SendEmail;
  /** 8 requests per 60 s. */
  RL_MIN: RateLimit;
  /** 2 requests per 10 s. */
  RL_BURST: RateLimit;
  TURNSTILE_SECRET: string;
  PASS_SECRET: string;
  /** Amir's inbox: a verified Email Routing destination, kept out of the public repo. */
  MAIL_TO: string;
  /** The hostname Turnstile must report the challenge was solved on. */
  SITE_HOST: string;
}

export type Reason = "check" | "pass" | "rate" | "size" | "invalid" | "server";

const STATUS: Record<Reason, number> = { check: 403, pass: 401, rate: 429, size: 413, invalid: 400, server: 502 };
const MAX_BODY = 16 * 1024;
const FROM = { email: `messenger@${OWN_DOMAIN}`, name: "Website Messenger" };

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });

const fail = (reason: Reason) => json({ ok: false, reason }, STATUS[reason]);

const ipOf = (request: Request) => request.headers.get("CF-Connecting-IP") ?? "unknown";

async function limited(env: Env, keys: string[]) {
  const outcomes = await Promise.all(
    keys.flatMap((key) => [env.RL_MIN.limit({ key }), env.RL_BURST.limit({ key })]),
  );
  return outcomes.some((o) => !o.success);
}

/** The JSON body, "size" when it is too big, or null when it is not JSON. */
async function readJson(request: Request): Promise<unknown | "size" | null> {
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY) return "size";
  const raw = await request.text();
  if (raw.length > MAX_BODY) return "size";
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function pass(request: Request, env: Env) {
  if (await limited(env, [`pass:${ipOf(request)}`])) return fail("rate");
  const data = await readJson(request);
  if (data === "size") return fail("size");
  const token = (data as { token?: unknown } | null)?.token;
  if (typeof token !== "string" || !token || token.length > 2048) return fail("invalid");

  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET);
  form.set("response", token);
  form.set("remoteip", ipOf(request));
  let outcome: { success?: boolean; hostname?: string };
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`siteverify ${res.status}`);
    outcome = await res.json();
  } catch (e) {
    console.error("turnstile", String(e));
    return fail("server");
  }
  if (outcome.success !== true || outcome.hostname !== env.SITE_HOST) return fail("check");
  return new Response(null, { status: 204, headers: { "Set-Cookie": await mint(env.PASS_SECRET), "Cache-Control": "no-store" } });
}

/** Whether the reply address's domain takes mail. A warning only: the e-mail goes out regardless. */
export async function mxOf(address: string): Promise<Mx> {
  const domain = address.slice(address.lastIndexOf("@") + 1);
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return "unknown";
    const dns = (await res.json()) as { Status?: number; Answer?: { type: number; data: string }[] };
    if (dns.Status === 3) return "none";
    if (dns.Status !== 0) return "unknown";
    // A null MX ("0 .") says the domain takes no mail.
    const hosts = (dns.Answer ?? []).filter((a) => a.type === 15 && !/^\d+\s+\.$/.test(a.data.trim()));
    return hosts.length ? "ok" : "none";
  } catch {
    return "unknown";
  }
}

async function send(request: Request, env: Env) {
  const id = await verify(request, env.PASS_SECRET);
  if (!id) return fail("pass");
  if (await limited(env, [`send:${id}`, `send:${ipOf(request)}`])) return fail("rate");
  const data = await readJson(request);
  if (data === "size") return fail("size");
  // The honeypot field is invisible to people; a bot that fills it gets a success and no e-mail.
  if ((data as { website?: unknown } | null)?.website) return json({ ok: true });
  const message = parse(data);
  if (!message) return fail("invalid");
  if (tooLong(message)) return fail("size");

  const mx = message.replyTo ? await mxOf(message.replyTo) : undefined;
  const country = (request.cf as { country?: string } | undefined)?.country;
  try {
    await env.MAIL.send({
      from: FROM,
      to: env.MAIL_TO,
      replyTo: message.replyTo,
      subject: subject(message),
      text: body(message, { country, now: new Date(), mx }),
      headers: { References: threadId(message.visitor), "In-Reply-To": threadId(message.visitor) },
    });
  } catch (e) {
    console.error("send", (e as { code?: string }).code ?? "unknown");
    return fail("server");
  }
  return json(mx ? { ok: true, mx } : { ok: true });
}

const ROUTES: Record<string, (request: Request, env: Env) => Promise<Response>> = {
  "/api/pass": pass,
  "/api/send": send,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = ROUTES[url.pathname];
    if (!route) return url.pathname.startsWith("/api/") ? json({ ok: false }, 404) : env.ASSETS.fetch(request);
    if (request.method !== "POST") return json({ ok: false }, 405, { Allow: "POST" });
    // Same-origin JSON only: a cross-site form or beacon has a different Origin or cannot set the type.
    if (request.headers.get("Origin") !== url.origin) return fail("check");
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) return fail("invalid");
    return route(request, env);
  },
} satisfies ExportedHandler<Env>;
