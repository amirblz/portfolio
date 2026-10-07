// Yahoo! Messenger: the buddy list and the IM window. Amir's side is a script (ym-brain) that asks
// for a reply address and a name; the visitor's lines reach his inbox by e-mail once they pause
// typing (ym-mail), and the log stays in this browser.

import { byMouse, play, store } from "./desktop";
import { deliver, pass, type Failure, type Outcome, type Outgoing } from "./ym-mail";
import { blank, bounced, respond, type Profile, type Question } from "../lib/ym-brain";
import {
  bodySafe,
  headerSafe,
  isAddress,
  MAX_LINES,
  MAX_NAME,
  MAX_PAGE,
  MAX_TEXT,
  MAX_WAIT_MS,
  newThread,
  sendAt,
  THREAD,
} from "../lib/ym-parse";
import ym from "../data/ym.json";
import emoticons from "../data/ym-emoticons.json";

const GREETING = "hey! I'm not at my desk, leave a message and it lands in my inbox ✉";
const WELCOME = "welcome back 👋";
const GOT_IT = `your mail app should open with our chat in it 👍 if it didn't: ${ym.email}`;
const PASTE = `our chat is too long for a mail link, so I copied it 📋 paste it into the mail. if your mail app didn't open: ${ym.email}`;
const TOO_LONG = `our chat is too long for a mail link 😅 copy it from here and write to ${ym.email}`;
const SUBJECT = "Yahoo! Messenger chat from your site";
const RETRY = "click the red ! to try again, or use E-mail Amir up top";
const FAILED: Record<Failure, string> = {
  rate: "whoa, that's more than my inbox takes at once 😅 wait a minute, then click the red ! to resend",
  size: `that's too long for one e-mail 😅 ${RETRY}`,
  check: `my spam check didn't let that through 😕 ${RETRY}`,
  pass: `my spam check didn't let that through 😕 ${RETRY}`,
  invalid: `something went wrong on my side 😕 ${RETRY}`,
  server: `something went wrong on my side 😕 ${RETRY}`,
  offline: "looks like you're offline. click the red ! once you're back",
};
const BUZZ_BACK = "BUZZ! back 😄";
const TOO_MANY = "You can only BUZZ once every few seconds.";

// Built by hand: URLSearchParams encodes spaces as "+", which mail apps show literally.
export function mailto(to: string, fields: { subject?: string; body?: string }) {
  const query = Object.entries(fields)
    .map(([k, v]) => [k, (v ?? "").trim()])
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `mailto:${to}${query ? `?${query}` : ""}`;
}

/* ---------- archive ---------- */

type Mail = "queued" | "sending" | "sent" | "failed";

interface Line {
  who: "amir" | "me";
  text: string;
  at: number;
  /** A visitor's line on its way to Amir's inbox. Answers, buzzes and pre-e-mail lines have none. */
  mail?: Mail;
  buzz?: true;
}
interface Archive {
  me: string;
  /** Random and private to this archive: the mails' thread key, since ids repeat. */
  thread: string;
  log: Line[];
  profile?: Profile;
}

const MAIL = new Set<unknown>(["queued", "sending", "sent", "failed"]);
const isProfile = (p: unknown): p is Profile =>
  typeof p === "object" && p !== null && Array.isArray((p as Profile).asked) && Array.isArray((p as Profile).later);

const KEY = "ym-archive";
const CAP = 200;
// A gap this long starts a new visit: a date divider, and Amir says welcome back.
const VISIT = 30 * 60_000;
const local = () => localStorage;
// With storage blocked or full the chat still holds together until the page reloads.
let memory: Archive | null = null;
// The last save failed, so storage holds an older archive than memory does.
let stale = false;

const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

function visitorId() {
  const adj = pick(["cool", "cyber", "lil", "mystic", "radical", "sk8er", "sunny", "techno"]);
  const noun = pick(["guest", "surfer", "ninja", "dragon", "rocker", "gamer", "pixel"]);
  const name = `${adj}_${noun}_${1980 + Math.floor(Math.random() * 20)}`;
  return Math.random() < 0.25 ? `xX_${name}_Xx` : name;
}

function load(): Archive {
  if (stale && memory) return memory;
  try {
    const a = JSON.parse(store.get(local, KEY) ?? "null");
    if (typeof a?.me === "string" && Array.isArray(a.log)) {
      const log = a.log.filter(
        (l: Line) =>
          (l?.who === "amir" || l?.who === "me") &&
          typeof l.text === "string" &&
          typeof l.at === "number" &&
          (l.mail === undefined || MAIL.has(l.mail)),
      );
      const found = typeof a.thread === "string" && THREAD.test(a.thread);
      memory = { me: a.me, thread: found ? a.thread : newThread(), log, profile: isProfile(a.profile) ? a.profile : undefined };
      if (!found) save(memory);
      return memory;
    }
  } catch {}
  return (memory ??= { me: visitorId(), thread: newThread(), log: [] });
}

function save(a: Archive) {
  a.log = a.log.slice(-CAP);
  memory = a;
  stale = !store.set(local, KEY, JSON.stringify(a));
}

/* ---------- the log ---------- */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const byCode = new Map(Object.entries(emoticons).flatMap(([id, codes]) => codes.map((c) => [c, id] as const)));
// Longest first, so ":((" wins over ":(".
const tokens = new RegExp(
  `${esc(ym.email)}|${[...byCode.keys()].sort((a, b) => b.length - a.length).map(esc).join("|")}`,
  "g",
);

function fill(el: HTMLElement, text: string) {
  let i = 0;
  for (const m of text.matchAll(tokens)) {
    // Not after a letter, so "http://" keeps its ":/" (by hand: Safari < 16.4 has no lookbehind).
    if (m[0] !== ym.email && /[A-Za-z0-9]/.test(text[m.index - 1] ?? "")) continue;
    el.append(text.slice(i, m.index));
    if (m[0] === ym.email) {
      const a = document.createElement("a");
      a.href = `mailto:${ym.email}`;
      a.textContent = ym.email;
      el.append(a);
    } else {
      const img = document.createElement("img");
      img.src = `/ym/emoticons/${byCode.get(m[0])}.gif`;
      img.alt = m[0];
      el.append(img);
    }
    i = m.index + m[0].length;
  }
  el.append(text.slice(i));
}

function lineEl(me: string, line: Line, prev?: Line) {
  const items: HTMLElement[] = [];
  if (prev && line.at - prev.at > VISIT) {
    const date = document.createElement("li");
    date.className = "ym-date";
    date.textContent = new Date(line.at).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    items.push(date);
  }
  const li = document.createElement("li");
  li.dataset.at = String(line.at);
  li.classList.toggle("me", line.who === "me");
  li.classList.toggle("ym-buzz", !!line.buzz);
  const who = document.createElement("b");
  who.className = "ym-who";
  who.textContent = `${line.who === "me" ? me : ym.me}: `;
  li.append(who);
  fill(li, line.text);
  mark(li, line.mail);
  items.push(li);
  return items;
}

/** ✓ once in Amir's inbox, a red ! to retry when it didn't get there, greyed out on the way. */
function mark(li: HTMLElement, mail?: Mail) {
  li.querySelector(".ym-mark")?.remove();
  li.classList.toggle("ym-pending", mail === "queued" || mail === "sending");
  if (mail === "sent") {
    const ok = document.createElement("span");
    ok.className = "ym-mark ym-sent";
    ok.textContent = "✓";
    ok.title = "In Amir's inbox";
    ok.setAttribute("role", "img");
    ok.setAttribute("aria-label", "sent");
    li.append(ok);
  } else if (mail === "failed") {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "ym-mark ym-retry";
    retry.dataset.ym = "retry";
    retry.textContent = "!";
    retry.title = "Not sent. Click to try again";
    retry.setAttribute("aria-label", "Not sent. Try again");
    li.append(retry);
  }
}

function remark(lines: Line[]) {
  for (const line of lines) {
    for (const li of document.querySelectorAll<HTMLElement>(`.ym-log li[data-at="${line.at}"]`)) mark(li, line.mail);
  }
}

const logOf = (chat: HTMLElement) => chat.querySelector<HTMLElement>(".ym-log")!;

function post(chat: HTMLElement, line: Line) {
  const a = load();
  const prev = a.log.at(-1);
  a.log.push(line);
  save(a);
  const log = logOf(chat);
  log.append(...lineEl(a.me, line, prev));
  log.scrollTop = log.scrollHeight;
}

// Amir's lines queue up behind "is typing..." in the status bar, one after another.
const queues = new WeakMap<HTMLElement, Promise<void>>();
// Bumped by Delete Archive: lines queued before it belong to the deleted conversation.
const rounds = new WeakMap<HTMLElement, number>();

/** A question counts as asked once its line is on screen. */
function say(chat: HTMLElement, text: string, ask?: Question) {
  const round = rounds.get(chat) ?? 0;
  const next = (queues.get(chat) ?? Promise.resolve()).then(
    () =>
      new Promise<void>((done) => {
        if (round !== (rounds.get(chat) ?? 0)) return done();
        const typing = chat.querySelector<HTMLElement>("[data-ym-typing]")!;
        typing.textContent = `${ym.me} is typing...`;
        setTimeout(() => {
          typing.textContent = "";
          // Closed meanwhile: the line is dropped, and an empty log greets again next time.
          if (chat.isConnected && round === (rounds.get(chat) ?? 0)) {
            post(chat, { who: "amir", text, at: Date.now() });
            play("ym-message");
            if (ask) shown(ask);
          }
          done();
        }, 700 + Math.min(1800, text.length * 25));
      }),
  );
  queues.set(chat, next);
}

function shown(ask: Question) {
  const a = load();
  const open = a.profile?.open;
  if (!open) return;
  const { shown: _, ...q } = open;
  if (JSON.stringify(q) !== JSON.stringify(ask)) return;
  open.shown = true;
  save(a);
}

function showMe(root: ParentNode, me: string) {
  for (const el of root.querySelectorAll("[data-ym-me]")) el.textContent = me;
}

/** Send As names the reply address once the visitor has confirmed one. */
function showReply(root: ParentNode) {
  const reply = load().profile?.reply;
  for (const el of root.querySelectorAll("[data-ym-reply]")) el.textContent = reply ? ` (${reply})` : "";
}

function start(chat: HTMLElement) {
  if (chat.dataset.ymReady) return;
  chat.dataset.ymReady = "";
  const a = load();
  // A question still being typed when the last chat closed was never asked.
  if (a.profile?.open && !a.profile.open.shown) a.profile.open = undefined;
  save(a);
  showMe(document, a.me);
  showReply(document);
  void pass();
  // The old log goes in silently; only what arrives from now on is announced.
  const log = logOf(chat);
  log.setAttribute("aria-live", "off");
  log.replaceChildren(...a.log.flatMap((line, i) => lineEl(a.me, line, a.log[i - 1])));
  log.scrollTop = log.scrollHeight;
  requestAnimationFrame(() => log.setAttribute("aria-live", "polite"));
  const last = a.log.at(-1);
  if (!last) say(chat, GREETING);
  else if (Date.now() - last.at > VISIT) say(chat, WELCOME);
}

/** This visit's lines: those since the last gap longer than VISIT. */
function visitOf(log: Line[]) {
  if (!log.length || Date.now() - log.at(-1)!.at > VISIT) return [];
  let i = log.length - 1;
  while (i > 0 && log[i].at - log[i - 1].at <= VISIT) i--;
  return log.slice(i);
}

/** The visitor's line goes into the log, Amir answers, and the line waits to go out by e-mail. */
function send(chat: HTMLElement) {
  const input = chat.querySelector<HTMLTextAreaElement>(".ym-input")!;
  const text = bodySafe(input.value);
  if (!text) return;
  input.value = "";
  const a = load();
  const mailed = visitOf(a.log).filter((l) => l.mail);
  const before = a.profile ?? blank();
  const r = respond(before, text, { first: !mailed.length, earlier: mailed.map((l) => l.text).join("\n") });
  // An answer that adds a reply address or name after the mail went out rides a mail of its own,
  // unless lines are waiting: they read the profile when they go.
  const learnt =
    mailed.length &&
    !queuedOf(a).length &&
    (r.profile.reply !== before.reply || r.profile.name !== before.name || r.profile.company !== before.company);
  a.profile = r.profile;
  save(a);
  post(chat, { who: "me", text, at: Date.now(), ...((r.mail || learnt) && { mail: "queued" as const }) });
  for (const s of r.say) say(chat, s.text, s.ask);
  showReply(document);
  schedule();
}

/* ---------- e-mail ---------- */

let timer = 0;
// One request at a time: lines typed meanwhile go in the next.
let flying = false;
// Set on pagehide: a request then fails in this page though the browser still delivers it.
let leaving = false;
const enc = new TextEncoder();

const queuedOf = (a: Archive) => a.log.filter((l) => l.mail === "queued");
const liveChat = () => [...document.querySelectorAll<HTMLElement>("[data-ym-chat]")].find((c) => "ymReady" in c.dataset);

/** Lines go out once the visitor pauses, or a minute after the first while Amir waits for an answer. */
function schedule() {
  clearTimeout(timer);
  if (flying) return;
  const a = load();
  const queued = queuedOf(a);
  if (!queued.length) return;
  const last = a.log.filter((l) => l.who === "me").at(-1)!;
  const due = a.profile?.open ? queued[0].at + MAX_WAIT_MS : sendAt([...queued, last])!;
  timer = window.setTimeout(flush, Math.max(0, due - Date.now()));
}

/** As many of the oldest queued lines as one request takes. */
function batchOf(queued: Line[]) {
  const out: Line[] = [];
  let bytes = 0;
  for (const l of queued) {
    const n = enc.encode(l.text).length + 1;
    if (out.length && (out.length >= MAX_LINES || bytes + n > MAX_TEXT)) break;
    out.push(l);
    bytes += n;
  }
  return out;
}

function setMail(ats: Set<number>, mail: Mail) {
  const a = load();
  const changed = a.log.filter((l) => ats.has(l.at) && l.mail);
  for (const l of changed) l.mail = mail;
  save(a);
  remark(changed);
}

function outgoing(a: Archive, lines: Line[]): Outgoing {
  const p = a.profile ?? blank();
  const website = document.querySelector<HTMLInputElement>(".ym-hp")?.value;
  return {
    visitor: a.me,
    thread: a.thread,
    lines: lines.map((l) => l.text),
    first: !a.log.some((l) => l.mail === "sent"),
    page: headerSafe(location.pathname, MAX_PAGE),
    name: (p.name && headerSafe(p.name, MAX_NAME)) || undefined,
    company: (p.company && headerSafe(p.company, MAX_NAME)) || undefined,
    replyTo: isAddress(p.reply) ? p.reply : undefined,
    topic: p.topic,
    website: website || undefined,
  };
}

// One tab at a time reads, claims and sends the queue; without Web Locks each tab just goes.
const locked = <T>(run: () => Promise<T>) => (navigator.locks ? navigator.locks.request("ym-send", run) : run());

async function flush() {
  clearTimeout(timer);
  if (flying || !queuedOf(load()).length) return;
  flying = true;
  try {
    await locked(deliverQueued);
  } finally {
    flying = false;
    schedule();
  }
}

async function deliverQueued() {
  const passed = await pass();
  // Read inside the lock: another tab may have sent these lines meanwhile.
  const a = load();
  const batch = batchOf(queuedOf(a));
  if (!batch.length) return;
  const ats = new Set(batch.map((l) => l.at));
  let outcome: Outcome = { ok: false, reason: passed === true ? "server" : passed };
  if (passed === true) {
    setMail(ats, "sending");
    outcome = await deliver(outgoing(a, batch));
  }
  const chat = liveChat();
  if (outcome.ok) {
    setMail(ats, "sent");
    const reply = a.profile?.reply;
    if (outcome.mx === "none" && reply) {
      const b = load();
      const r = bounced(b.profile ?? blank(), reply);
      b.profile = r.profile;
      save(b);
      if (chat) for (const s of r.say) say(chat, s.text, s.ask);
    }
  } else if (!leaving) {
    // What stopped this request would stop the rest, unless it was this batch's own content.
    if (outcome.reason !== "invalid" && outcome.reason !== "size") for (const l of queuedOf(load())) ats.add(l.at);
    setMail(ats, "failed");
    if (chat) say(chat, FAILED[outcome.reason]);
  }
}

function retry() {
  const a = load();
  const failed = a.log.filter((l) => l.mail === "failed");
  for (const l of failed) l.mail = "queued";
  save(a);
  remark(failed);
  void flush();
}

// A line left queued by a page that closed before it could go out waits for a retry; one left
// sending most likely arrived (requests are keepalive), and the visit goes on as if it did. Only
// lines too old for any open tab to still hold: a younger one may belong to another tab.
{
  const a = load();
  const old = Date.now() - MAX_WAIT_MS - 30_000;
  const left = a.log.filter((l) => (l.mail === "queued" || l.mail === "sending") && l.at < old);
  for (const l of left) l.mail = l.mail === "queued" ? "failed" : "sent";
  if (left.length) save(a);
  schedule();
}

// Another tab sent, failed or queued lines: show their marks, and send what waits if it is due.
addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  remark(load().log.filter((l) => l.mail));
  schedule();
});

// Hidden may be the last moment a phone gives the page: whatever waits goes now.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void flush();
});
addEventListener("pagehide", () => {
  leaving = true;
  void flush();
});
addEventListener("pageshow", () => (leaving = false));

// Chrome on Windows drops a mailto URL past 2048 characters without a word.
const MAX_URL = 1900;
// Held while the clipboard is busy, so a double-click doesn't open two mails.
let mailing = false;

/** E-mail Amir: the whole conversation, plus anything still in the box, in the visitor's mail app. */
async function email(chat: HTMLElement, button: HTMLElement) {
  if (mailing) return;
  const a = load();
  const draft = chat.querySelector<HTMLTextAreaElement>(".ym-input")!.value.trim();
  if (!draft && !a.log.some((l) => l.who === "me" && !l.buzz)) return tip(button, "Type a message first, then e-mail it.");
  const lines = a.log.filter((l) => !l.buzz).map((l) => `${l.who === "me" ? a.me : ym.me}: ${l.text}`);
  if (draft) lines.push(`${a.me}: ${draft}`);
  const body = `${lines.join("\n")}\n\n-- ${a.me}, via Yahoo! Messenger on amirbalazade.com`;
  let url = mailto(ym.email, { subject: SUBJECT, body });
  let reply = GOT_IT;
  if (url.length > MAX_URL) {
    // Too long for the link: the chat rides the clipboard, or stays here if that fails too.
    mailing = true;
    try {
      await navigator.clipboard.writeText(body);
    } catch {
      return say(chat, TOO_LONG);
    } finally {
      mailing = false;
    }
    url = mailto(ym.email, { subject: SUBJECT, body: "(paste our chat here)" });
    reply = PASTE;
  }
  location.href = url;
  say(chat, reply);
}

// Two buzzes per few seconds; the third gets YM's own scolding. Amir answers each fresh round in
// words: he never buzzes back.
const BUZZ_GAP = 5000;
let buzzes: number[] = [];
let unbuzz: (() => void) | undefined;

function buzz(chat: HTMLElement) {
  const now = Date.now();
  buzzes = buzzes.filter((t) => now - t < BUZZ_GAP);
  const log = logOf(chat);
  if (buzzes.length >= 2) {
    const note = document.createElement("li");
    note.className = "ym-note";
    note.textContent = TOO_MANY;
    log.append(note);
    log.scrollTop = log.scrollHeight;
    return;
  }
  const fresh = !buzzes.length;
  buzzes.push(now);
  post(chat, { who: "me", text: "BUZZ!!!", at: now, buzz: true });
  play("ym-buzz");
  // Shakes, or flashes under reduced motion (CSS picks); restarted if still running.
  const win = chat.closest<HTMLElement>(".window") ?? chat;
  unbuzz?.();
  void win.offsetWidth;
  win.classList.add("ym-buzzing");
  const done = (e: AnimationEvent) => {
    if (e.target !== win || !e.animationName.startsWith("ym-")) return;
    // A restart cancels the old run too; only minimizing (the window hidden) ends it that way.
    if (e.type === "animationcancel" && win.getClientRects().length) return;
    unbuzz?.();
  };
  win.addEventListener("animationend", done);
  win.addEventListener("animationcancel", done);
  unbuzz = () => {
    win.classList.remove("ym-buzzing");
    win.removeEventListener("animationend", done);
    win.removeEventListener("animationcancel", done);
    unbuzz = undefined;
  };
  if (fresh) say(chat, BUZZ_BACK);
}

function deleteArchive(chat: HTMLElement) {
  const a = load();
  a.log = [];
  // What Amir learnt goes with the log: the next visitor on this device starts over.
  a.profile = undefined;
  a.thread = newThread();
  save(a);
  showReply(document);
  rounds.set(chat, (rounds.get(chat) ?? 0) + 1);
  logOf(chat).replaceChildren();
  say(chat, GREETING);
}

for (const chat of document.querySelectorAll<HTMLElement>("[data-ym-chat]")) start(chat);
if (document.querySelector("[data-ym-me]")) showMe(document, load().me);

const fine = matchMedia("(hover: hover) and (pointer: fine)");

document.addEventListener("xp:open", (e) => {
  const el = (e as CustomEvent<HTMLElement>).detail;
  const chat = el.querySelector<HTMLElement>("[data-ym-chat]");
  if (chat) {
    play("ym-door-open");
    start(chat);
    // Ready to type, as YM was; a touch screen would throw its keyboard over the log instead.
    if (fine.matches) chat.querySelector<HTMLElement>(".ym-input")!.focus({ preventScroll: true });
  } else if (el.querySelector("[data-ym-me]")) showMe(el, load().me);
});

document.addEventListener("xp:close", (e) => {
  if ((e as CustomEvent<HTMLElement>).detail.querySelector("[data-ym-chat]")) play("ym-door-close");
});

/* ---------- buddy list ---------- */

// Buddies select on a mouse click and open on a double-click, like the desktop's icons. Capture
// runs this before the desktop's [data-open] handler, which skips a click already prevented.
document.addEventListener(
  "click",
  (e) => {
    const buddy = (e.target as Element).closest<HTMLElement>(".ym-buddy");
    if (!buddy || !byMouse(e) || e.detail === 2 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    buddy.closest(".ym-list")!.querySelector(".ym-buddy.selected")?.classList.remove("selected");
    buddy.classList.add("selected");
  },
  { capture: true },
);

// The ad slot rotates its self-ads, holding still while the pointer or focus is on it.
setInterval(() => {
  for (const slot of document.querySelectorAll<HTMLElement>("[data-ym-ads]")) {
    const ads = [...slot.children] as HTMLElement[];
    if (ads.length < 2 || slot.matches(":hover, :focus-within")) continue;
    const i = ads.findIndex((a) => !a.hidden);
    ads.forEach((a, k) => (a.hidden = k !== (i + 1) % ads.length));
  }
}, 8000);

/* ---------- IM window ---------- */

// Toolbar buttons with nothing behind them answer in an XP balloon under themselves.
let tipTimer = 0;
function tip(btn: HTMLElement, text: string) {
  const chat = btn.closest<HTMLElement>("[data-ym-chat]")!;
  const el = chat.querySelector<HTMLElement>(".ym-tip")!;
  clearTimeout(tipTimer);
  // Shown first, filled a frame later: a live region misses text set while it was hidden.
  el.textContent = "";
  el.hidden = false;
  requestAnimationFrame(() => {
    el.textContent = text;
    const box = chat.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const left = Math.max(4, Math.min(b.left - box.left, box.width - el.offsetWidth - 4));
    el.style.left = `${left}px`;
    el.style.top = `${b.bottom - box.top + 8}px`;
    el.style.setProperty("--tail", `${b.left - box.left - left + Math.min(16, b.width / 2)}px`);
  });
  tipTimer = window.setTimeout(() => (el.hidden = true), 5000);
}

function smileys(chat: HTMLElement, open: boolean) {
  chat.querySelector<HTMLElement>(".ym-smileys")!.hidden = !open;
  chat.querySelector('[data-ym="smileys"]')!.setAttribute("aria-expanded", String(open));
}

function menu(chat: HTMLElement, open: boolean) {
  chat.querySelector<HTMLElement>(".ym-menu-list")!.hidden = !open;
  chat.querySelector('[data-ym="menu"]')!.setAttribute("aria-expanded", String(open));
}

function confirmBox(chat: HTMLElement, open: boolean) {
  chat.querySelector<HTMLElement>(".ym-confirm")!.hidden = !open;
  chat.querySelector<HTMLElement>(open ? '[data-ym="archive-no"]' : ".ym-input")!.focus();
}

document.addEventListener("click", (e) => {
  const t = e.target as Element;
  const chat = t.closest<HTMLElement>("[data-ym-chat]");
  for (const c of document.querySelectorAll<HTMLElement>("[data-ym-chat]")) {
    if (c !== chat || !t.closest(".ym-tip, [data-ym-joke]")) c.querySelector<HTMLElement>(".ym-tip")!.hidden = true;
    if (c !== chat || !t.closest('.ym-smileys, [data-ym="smileys"]')) smileys(c, false);
    if (c !== chat || !t.closest('[data-ym="menu"]')) menu(c, false);
  }
  if (!chat) return;

  const joke = t.closest<HTMLElement>("[data-ym-joke]");
  if (joke) return tip(joke, joke.dataset.ymJoke!);

  const action = t.closest<HTMLElement>("[data-ym]");
  switch (action?.dataset.ym) {
    case "send":
      send(chat);
      chat.querySelector<HTMLElement>(".ym-input")!.focus();
      return;
    case "email":
      return email(chat, action);
    case "retry":
      return retry();
    case "buzz":
      return buzz(chat);
    case "smileys": {
      const open = !!chat.querySelector<HTMLElement>(".ym-smileys")!.hidden;
      smileys(chat, open);
      if (open) chat.querySelector<HTMLElement>(".ym-smileys button")!.focus();
      return;
    }
    case "menu": {
      const open = !!chat.querySelector<HTMLElement>(".ym-menu-list")!.hidden;
      menu(chat, open);
      if (open) chat.querySelector<HTMLElement>('.ym-menu-list [role="menuitem"]')!.focus();
      return;
    }
    case "archive":
      return confirmBox(chat, true);
    case "archive-yes":
      confirmBox(chat, false);
      return deleteArchive(chat);
    case "archive-no":
      return confirmBox(chat, false);
  }

  const smiley = t.closest<HTMLElement>("[data-ym-smiley]");
  if (smiley) {
    const input = chat.querySelector<HTMLTextAreaElement>(".ym-input")!;
    input.focus();
    input.setRangeText(`${smiley.dataset.ymSmiley} `, input.selectionStart, input.selectionEnd, "end");
    smileys(chat, false);
  }
});

document.addEventListener("keydown", (e) => {
  const t = e.target as Element;
  const chat = t.closest?.<HTMLElement>("[data-ym-chat]");
  if (!chat) return;

  // Enter sends, Shift+Enter breaks the line, and an IME keeps its Enter (Safari only says 229).
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && t.matches(".ym-input")) {
    e.preventDefault();
    return send(chat);
  }

  const confirm = t.closest(".ym-confirm");
  if (confirm && e.key === "Tab") {
    e.preventDefault();
    const buttons = [...confirm.querySelectorAll<HTMLElement>("button")];
    buttons[(buttons.indexOf(t as HTMLElement) + 1) % buttons.length].focus();
    return;
  }

  if (e.key !== "Escape") return;
  // Escape closes the popup it's in, not the whole window behind it.
  if (confirm) confirmBox(chat, false);
  else if (t.closest(".ym-menu-list")) {
    menu(chat, false);
    chat.querySelector<HTMLElement>('[data-ym="menu"]')!.focus();
  } else if (t.closest(".ym-smileys")) {
    smileys(chat, false);
    chat.querySelector<HTMLElement>('[data-ym="smileys"]')!.focus();
  } else return;
  e.stopPropagation();
}, { capture: true });

// Tabbing out of the menu or the emoticon picker closes it. A null relatedTarget (Safari's
// unfocusable buttons under a click) is left to the click handler.
document.addEventListener("focusout", (e) => {
  const t = e.target as Element;
  const to = e.relatedTarget as Element | null;
  const chat = t.closest?.<HTMLElement>("[data-ym-chat]");
  if (!chat || !to) return;
  if (t.closest(".ym-menu") && !to.closest(".ym-menu")) menu(chat, false);
  if (t.closest(".ym-format") && !to.closest(".ym-format")) smileys(chat, false);
});
