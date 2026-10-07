// Yahoo! Messenger: the buddy list and the IM window. There is no server: Amir's side is a short
// script, the visitor's lines leave through their own mail app, and the log stays in this browser.

import { byMouse, play, store } from "./desktop";
import ym from "../data/ym.json";
import emoticons from "../data/ym-emoticons.json";

const GREETING = "hey! I'm not at my desk, leave a message and it lands in my inbox ✉";
const WELCOME = "welcome back 👋";
const OFFLINE = "I'm offline, hit ✉ Send as e-mail when you're done and it lands in my inbox";
const GOT_IT = `got it 👍 if your mail app didn't open: ${ym.email}`;
const PASTE = `too long for a mail link, so I copied it 📋 paste it into the mail. if your mail app didn't open: ${ym.email}`;
const TOO_LONG = `that's too long for a mail link 😅 copy it from here and write to ${ym.email}`;
const SUBJECT = "Yahoo! Messenger message from your site";
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

interface Line {
  who: "amir" | "me";
  text: string;
  at: number;
  mailed?: true;
  buzz?: true;
}
interface Archive {
  me: string;
  log: Line[];
}

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
        (l: Line) => (l?.who === "amir" || l?.who === "me") && typeof l.text === "string" && typeof l.at === "number",
      );
      return (memory = { me: a.me, log });
    }
  } catch {}
  return (memory ??= { me: visitorId(), log: [] });
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
  li.classList.toggle("me", line.who === "me");
  li.classList.toggle("ym-buzz", !!line.buzz);
  const who = document.createElement("b");
  who.className = "ym-who";
  who.textContent = `${line.who === "me" ? me : ym.me}: `;
  li.append(who);
  fill(li, line.text);
  items.push(li);
  return items;
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

function say(chat: HTMLElement, text: string) {
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
          }
          done();
        }, 700 + Math.min(1800, text.length * 25));
      }),
  );
  queues.set(chat, next);
}

function showMe(root: ParentNode, me: string) {
  for (const el of root.querySelectorAll("[data-ym-me]")) el.textContent = me;
}

function start(chat: HTMLElement) {
  if (chat.dataset.ymReady) return;
  chat.dataset.ymReady = "";
  const a = load();
  save(a);
  showMe(document, a.me);
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

const unmailed = (a: Archive) => a.log.filter((l) => l.who === "me" && !l.mailed && !l.buzz);

/** The visitor's line goes into the log; nothing is sent until "Send as e-mail". */
function send(chat: HTMLElement, reply = true) {
  const input = chat.querySelector<HTMLTextAreaElement>(".ym-input")!;
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  const first = !unmailed(load()).length;
  post(chat, { who: "me", text, at: Date.now() });
  if (first && reply) say(chat, OFFLINE);
}

// Chrome on Windows drops a mailto URL past 2048 characters without a word.
const MAX_URL = 1900;
// Held while the clipboard is busy, so a double-click doesn't mail the same lines twice.
let mailing = false;

async function email(chat: HTMLElement, button: HTMLElement) {
  if (mailing) return;
  send(chat, false);
  const a = load();
  const lines = unmailed(a);
  if (!lines.length) return tip(button, "Type a message first, then send it as e-mail.");
  const body = `${lines.map((l) => l.text).join("\n\n")}\n\n-- ${a.me}, via Yahoo! Messenger on amirbalazade.com`;
  let url = mailto(ym.email, { subject: SUBJECT, body });
  let reply = GOT_IT;
  if (url.length > MAX_URL) {
    // Too long for the link: the message rides the clipboard, or stays unsent if that fails too.
    mailing = true;
    try {
      await navigator.clipboard.writeText(body);
    } catch {
      return say(chat, TOO_LONG);
    } finally {
      mailing = false;
    }
    url = mailto(ym.email, { subject: SUBJECT, body: "(paste your message here)" });
    reply = PASTE;
  }
  // Reloaded: more lines may have been posted while the clipboard was busy.
  const sent = new Set(lines.map((l) => l.at));
  const b = load();
  for (const l of unmailed(b)) if (sent.has(l.at)) l.mailed = true;
  save(b);
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
  save(a);
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
