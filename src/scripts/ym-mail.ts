// The messenger's way to Amir's inbox: an invisible Turnstile check when the chat opens buys a
// 30-minute pass cookie from /api/pass, and /api/send turns lines into an e-mail. Requests are
// keepalive, so a line sent as the tab closes still arrives.

import ym from "../data/ym.json";
import { OWN_DOMAIN, type Topic } from "../lib/ym-parse";

export interface Outgoing {
  visitor: string;
  lines: string[];
  first: boolean;
  page: string;
  name?: string;
  company?: string;
  replyTo?: string;
  topic?: Topic;
  /** The honeypot: only a bot fills it. */
  website?: string;
}

export type Failure = "check" | "pass" | "rate" | "size" | "invalid" | "server" | "offline";
export type Outcome = { ok: true; mx?: "ok" | "none" | "unknown" } | { ok: false; reason: Failure };

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
// Cloudflare's always-pass invisible test key: the real one only works on the real domain.
const TEST_KEY = "1x00000000000000000000BB";
const sitekey = () => (location.hostname === OWN_DOMAIN ? ym.turnstile : TEST_KEY);

interface Turnstile {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | undefined;
let widget: string | undefined;
let waiting: { ok: (token: string) => void; no: () => void } | undefined;

function turnstile() {
  loading ??= new Promise<Turnstile>((ok, no) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? ok(window.turnstile) : no());
    s.onerror = () => {
      // Blocked or offline: the next try loads it again.
      loading = undefined;
      s.remove();
      no();
    };
    document.head.append(s);
  });
  return loading;
}

/** A fresh one-use token, or undefined when the check can't run or fails. */
async function token(): Promise<string | undefined> {
  let ts: Turnstile;
  try {
    ts = await turnstile();
  } catch {
    return;
  }
  return new Promise((ok) => {
    const timer = setTimeout(() => done(), 15_000);
    const done = (t?: string) => {
      clearTimeout(timer);
      waiting = undefined;
      ok(t);
    };
    waiting = { ok: done, no: () => done() };
    if (widget !== undefined) return ts.reset(widget);
    const box = document.createElement("div");
    box.className = "ym-check";
    document.body.append(box);
    widget = ts.render(box, {
      sitekey: sitekey(),
      callback: (t: string) => waiting?.ok(t),
      "error-callback": () => {
        waiting?.no();
        // Handled: Turnstile skips its own retry loop and console noise.
        return true;
      },
      "expired-callback": () => {},
    });
  });
}

const offline = () => navigator.onLine === false;
const JSON_POST = { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true } as const;

async function call(path: string, data: unknown): Promise<Response | Failure> {
  try {
    return await fetch(path, { ...JSON_POST, body: JSON.stringify(data) });
  } catch {
    return offline() ? "offline" : "server";
  }
}

async function reasonOf(res: Response): Promise<Failure> {
  try {
    const { reason } = (await res.json()) as { reason?: Failure };
    if (reason) return reason;
  } catch {}
  return "server";
}

let passing: Promise<true | Failure> | undefined;

/** Buys the pass, once per page unless it lapses or fails. The chat calls this when it opens. */
export function pass(): Promise<true | Failure> {
  passing ??= (async () => {
    // No network: say so now, not after the check's 15-second wait.
    if (offline()) return "offline";
    const t = await token();
    if (!t) return offline() ? "offline" : "check";
    const res = await call("/api/pass", { token: t });
    if (typeof res === "string") return res;
    return res.status === 204 ? true : reasonOf(res);
  })().then((r) => {
    if (r !== true) passing = undefined;
    return r;
  });
  return passing;
}

async function post(out: Outgoing): Promise<Outcome> {
  const res = await call("/api/send", out);
  if (typeof res === "string") return { ok: false, reason: res };
  if (!res.ok) return { ok: false, reason: await reasonOf(res) };
  try {
    const { mx } = (await res.json()) as { mx?: "ok" | "none" | "unknown" };
    return { ok: true, mx };
  } catch {
    return { ok: true };
  }
}

/** E-mails the lines, buying a new pass once if the old one lapsed. */
export async function deliver(out: Outgoing): Promise<Outcome> {
  const p = await pass();
  if (p !== true) return { ok: false, reason: p };
  const first = await post(out);
  if (first.ok || first.reason !== "pass") return first;
  passing = undefined;
  const again = await pass();
  return again === true ? post(out) : { ok: false, reason: again };
}
