import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "./index";
import { mint } from "./pass";

const ORIGIN = "https://amirbalazade.com";
const message = { visitor: "lil_pixel_1990", lines: ["hello", "I have a job for you"], first: true, page: "/contact/chat" };

function limiter(cap = Infinity) {
  const counts = new Map<string, number>();
  return {
    keys: counts,
    async limit({ key }: { key: string }) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= cap };
    },
  };
}

let sent: unknown[];
let testEnv: Env;
let upstream: { siteverify: () => Response | Promise<Response>; dns: () => Response | Promise<Response> };

beforeEach(() => {
  sent = [];
  testEnv = {
    ...(env as unknown as Env),
    SITE_HOST: "amirbalazade.com",
    MAIL: {
      send: vi.fn(async (m: unknown) => {
        sent.push(m);
        return { messageId: "<id@amirbalazade.com>" };
      }),
    } as unknown as SendEmail,
    RL_MIN: limiter(),
    RL_BURST: limiter(),
    ASSETS: { fetch: vi.fn(async () => new Response("asset")) } as unknown as Fetcher,
  };
  upstream = {
    siteverify: () => Response.json({ success: true, hostname: "amirbalazade.com" }),
    dns: () => Response.json({ Status: 0, Answer: [{ type: 15, data: "10 mx.example.com." }] }),
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "challenges.cloudflare.com") return upstream.siteverify();
    if (url.hostname === "cloudflare-dns.com") return upstream.dns();
    throw new Error(`unexpected fetch ${url}`);
  });
});

afterEach(() => vi.restoreAllMocks());

function post(path: string, data: unknown, headers: Record<string, string> = {}) {
  return worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7", ...headers },
      body: typeof data === "string" ? data : JSON.stringify(data),
    }) as Request<unknown, IncomingRequestCfProperties>,
    testEnv,
  );
}

async function cookie() {
  return (await mint(testEnv.PASS_SECRET)).split(";")[0];
}

const sendWithPass = async (data: unknown, headers: Record<string, string> = {}) =>
  post("/api/send", data, { Cookie: await cookie(), ...headers });

describe("routing", () => {
  it("hands everything outside /api to the assets", async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/about`) as never, testEnv);
    expect(await res.text()).toBe("asset");
  });

  it("404s an unknown endpoint", async () => {
    expect((await post("/api/nope", {})).status).toBe(404);
  });

  it("allows POST only", async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/api/send`) as never, testEnv);
    expect(res.status).toBe(405);
  });

  it("refuses another origin", async () => {
    const res = await sendWithPass(message, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("refuses a request with no origin", async () => {
    const res = await worker.fetch(
      new Request(`${ORIGIN}/api/pass`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }) as never,
      testEnv,
    );
    expect(res.status).toBe(403);
  });

  it("refuses a body that is not JSON", async () => {
    const res = await sendWithPass(message, { "Content-Type": "text/plain" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/pass", () => {
  it("swaps a solved challenge for a pass cookie", async () => {
    const res = await post("/api/pass", { token: "tok" });
    expect(res.status).toBe(204);
    expect(res.headers.get("Set-Cookie")).toMatch(/^__Host-ympass=.+HttpOnly/);
  });

  it("sends the secret, token and visitor IP to siteverify", async () => {
    await post("/api/pass", { token: "tok" });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const form = init!.body as FormData;
    expect([form.get("secret"), form.get("response"), form.get("remoteip")]).toEqual([
      "test-turnstile",
      "tok",
      "203.0.113.7",
    ]);
  });

  it.each([
    ["a failed challenge", { success: false }],
    ["another hostname", { success: true, hostname: "evil.example" }],
  ])("refuses %s", async (_, outcome) => {
    upstream.siteverify = () => Response.json(outcome);
    const res = await post("/api/pass", { token: "tok" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, reason: "check" });
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("reports a server problem when siteverify is down", async () => {
    upstream.siteverify = () => new Response("", { status: 500 });
    const res = await post("/api/pass", { token: "tok" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, reason: "server" });
  });

  it("refuses a missing token", async () => {
    expect((await post("/api/pass", {})).status).toBe(400);
    expect((await post("/api/pass", "nope")).status).toBe(400);
  });

  it("rate limits per IP", async () => {
    testEnv.RL_BURST = limiter(2);
    expect((await post("/api/pass", { token: "a" })).status).toBe(204);
    expect((await post("/api/pass", { token: "b" })).status).toBe(204);
    const res = await post("/api/pass", { token: "c" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, reason: "rate" });
  });
});

describe("POST /api/send", () => {
  it("e-mails the lines to Amir", async () => {
    const res = await sendWithPass(message);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    const mail = sent[0] as Record<string, unknown>;
    expect(mail).toMatchObject({
      from: { email: "messenger@amirbalazade.com", name: "Website Messenger" },
      to: "inbox@example.com",
      subject: "Website message from lil_pixel_1990",
      headers: { References: "<ym.lil_pixel_1990@amirbalazade.com>", "In-Reply-To": "<ym.lil_pixel_1990@amirbalazade.com>" },
    });
    expect(mail.replyTo).toBeUndefined();
    expect(mail.text).toMatch(/^hello\nI have a job for you\n\n-- \n/);
    expect(mail.text).toContain("Visitor: lil_pixel_1990");
  });

  it("sets Reply-To and reports the domain's mail server", async () => {
    const res = await sendWithPass({ ...message, replyTo: "jane@example.com" });
    expect(await res.json()).toEqual({ ok: true, mx: "ok" });
    expect(sent[0]).toMatchObject({ replyTo: "jane@example.com" });
    expect((sent[0] as { text: string }).text).toContain("Reply to: jane@example.com (mail server found)");
  });

  it.each([
    ["NXDOMAIN", () => Response.json({ Status: 3 }), "none"],
    ["no MX records", () => Response.json({ Status: 0 }), "none"],
    ["a null MX", () => Response.json({ Status: 0, Answer: [{ type: 15, data: "0 ." }] }), "none"],
    ["SERVFAIL", () => Response.json({ Status: 2 }), "unknown"],
    ["DoH down", () => new Response("", { status: 503 }), "unknown"],
    [
      "DoH unreachable",
      () => {
        throw new Error("network");
      },
      "unknown",
    ],
  ] as const)("still sends on %s, with a warning", async (_, dns, mx) => {
    upstream.dns = dns;
    const res = await sendWithPass({ ...message, replyTo: "jane@example.com" });
    expect(await res.json()).toEqual({ ok: true, mx });
    expect(sent).toHaveLength(1);
  });

  it("asks for a new pass when the cookie is missing or forged", async () => {
    const res = await post("/api/send", message);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "pass" });
    const forged = (await mint("not-the-secret")).split(";")[0];
    expect((await post("/api/send", message, { Cookie: forged })).status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("rate limits per pass and per IP", async () => {
    testEnv.RL_MIN = limiter(8);
    const pass = await cookie();
    for (let i = 0; i < 8; i++) expect((await post("/api/send", message, { Cookie: pass })).status).toBe(200);
    const res = await post("/api/send", message, { Cookie: pass });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, reason: "rate" });
    // A fresh pass from the same IP is still over the IP's limit.
    expect((await sendWithPass(message)).status).toBe(429);
    const keys = [...(testEnv.RL_MIN as unknown as ReturnType<typeof limiter>).keys.keys()];
    expect(keys.some((k) => k === "send:203.0.113.7")).toBe(true);
    expect(sent).toHaveLength(8);
  });

  it("pretends to succeed for a bot that fills the honeypot", async () => {
    const res = await sendWithPass({ ...message, website: "http://spam.example" });
    expect(await res.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it("refuses an invalid message", async () => {
    const res = await sendWithPass({ ...message, name: "Eve\r\nBcc: x@example.com" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: "invalid" });
    expect(sent).toHaveLength(0);
  });

  it("refuses more than 8 KB of text", async () => {
    const res = await sendWithPass({ ...message, lines: Array(9).fill("x".repeat(1000)) });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, reason: "size" });
  });

  it("refuses an oversized request before reading it", async () => {
    const res = await sendWithPass(JSON.stringify({ ...message, pad: "x".repeat(20_000) }));
    expect(res.status).toBe(413);
  });

  it("reports a server problem when the mail does not go out", async () => {
    testEnv.MAIL = { send: vi.fn(async () => Promise.reject(Object.assign(new Error("x"), { code: "E_INTERNAL" }))) } as never;
    const res = await sendWithPass(message);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, reason: "server" });
  });

  it("never caches a response", async () => {
    expect((await sendWithPass(message)).headers.get("Cache-Control")).toBe("no-store");
  });
});
