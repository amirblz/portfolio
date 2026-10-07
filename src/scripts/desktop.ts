// The desktop's behaviour: boot, windows, taskbar, Start menu, tray and power screens.
// Windows come from their routes: opening one fetches its page and lifts the [data-window]
// element, so every window also exists as a plain server-rendered URL.

import { apps, appById, homeTitle, iconSrc, type App } from "../data/apps";

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T;

const html = document.documentElement;
const desktop = $("#desktop");
const layer = $("#windows");
const tasks = $("#tasks");
const startButton = $<HTMLButtonElement>("#start-button");
const startMenu = $("#start-menu");
const startAll = $<HTMLButtonElement>("#start-all");
const programs = $("#start-programs");
const phone = matchMedia("(max-width: 640px)");

// Storage is a thunk: with site data blocked, merely reading `localStorage` throws.
const store = {
  get: (s: () => Storage, k: string) => {
    try {
      return s().getItem(k);
    } catch {
      return null;
    }
  },
  set: (s: () => Storage, k: string, v: string) => {
    try {
      s().setItem(k, v);
    } catch {}
  },
};

/* ---------- sound ---------- */

let soundOn = store.get(() => localStorage, "xp-sound") !== "off";
const soundButton = $<HTMLButtonElement>("#tray-sound");

/** `untilEnd` resolves when the sound finishes (capped), not when it starts. */
export function play(name: string, untilEnd = false): Promise<void> {
  if (!soundOn) return Promise.resolve();
  const audio = new Audio(`/xp/sounds/${name}.mp3`);
  audio.volume = 0.5;
  return audio.play().then(
    () =>
      untilEnd
        ? new Promise<void>((done) => {
            audio.addEventListener("ended", () => done(), { once: true });
            setTimeout(done, 4000);
          })
        : undefined,
    () => {},
  );
}

function renderSound() {
  soundButton.setAttribute("aria-pressed", String(soundOn));
  soundButton.title = soundOn ? "Volume: on" : "Volume: muted";
  $<HTMLImageElement>("img", soundButton).src = iconSrc(soundOn ? "volume" : "mute");
}

soundButton.addEventListener("click", () => {
  soundOn = !soundOn;
  store.set(() => localStorage, "xp-sound", soundOn ? "on" : "off");
  renderSound();
  play("ding");
});
renderSound();

// Browsers only allow sound after a gesture, so the startup chime waits for the first one.
function chimeOnce() {
  if (store.get(() => sessionStorage, "xp-chimed")) return;
  store.set(() => sessionStorage, "xp-chimed", "1");
  play("startup");
}
addEventListener("pointerdown", chimeOnce, { once: true, capture: true });
addEventListener("keydown", chimeOnce, { once: true, capture: true });

/* ---------- boot ---------- */

function endBoot() {
  if (!html.classList.contains("booting")) return;
  html.classList.remove("booting");
  store.set(() => sessionStorage, "xp-booted", "1");
  afterBoot();
}

if (html.classList.contains("booting")) {
  const timer = setTimeout(endBoot, 1200);
  const skip = () => {
    clearTimeout(timer);
    endBoot();
  };
  addEventListener("pointerdown", skip, { once: true });
  addEventListener("keydown", skip, { once: true });
} else {
  queueMicrotask(afterBoot);
}

function afterBoot() {
  if (store.get(() => sessionStorage, "xp-balloon")) return;
  store.set(() => sessionStorage, "xp-balloon", "1");
  setTimeout(showBalloon, 1500);
}

/* ---------- windows ---------- */

interface Win {
  id: string;
  el: HTMLElement;
  task: HTMLButtonElement;
  invoker?: HTMLElement | null;
  restore?: { left: string; top: string; width: string; height: string };
}

const wins = new Map<string, Win>();
let z = 10;
let active: Win | null = null;
let cascade = 0;

const isMinimized = (w: Win) => w.el.dataset.state === "minimized";

function topWindow(except?: Win) {
  let best: Win | null = null;
  for (const w of wins.values()) {
    if (w === except || isMinimized(w)) continue;
    if (!best || Number(w.el.style.zIndex) > Number(best.el.style.zIndex)) best = w;
  }
  return best;
}

function place(el: HTMLElement, app: App | undefined) {
  const area = layer.getBoundingClientRect();
  const width = Math.min(app?.width ?? 640, area.width - 16);
  const height = Math.min(app?.height ?? 480, area.height - 16);
  const step = (cascade++ % 6) * 24;
  const left = Math.max(8, Math.min((area.width - width) / 2 + step - 60, area.width - width - 8));
  const top = Math.max(8, Math.min((area.height - height) / 2 + step - 60, area.height - height - 8));
  Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
}

function register(el: HTMLElement, invoker?: HTMLElement | null) {
  const id = el.dataset.window!;
  const app = appById[id];
  el.tabIndex = -1;
  el.dataset.title ??= app?.title ?? id;
  for (const dir of ["n", "e", "s", "w", "ne", "nw", "se", "sw"]) {
    const handle = document.createElement("div");
    handle.className = `rz rz-${dir}`;
    handle.dataset.resize = dir;
    el.append(handle);
  }

  const task = document.createElement("button");
  task.type = "button";
  task.className = "task";
  task.dataset.task = id;
  task.innerHTML = `<img src="${iconSrc(el.dataset.icon ?? app?.icon ?? "folder-opened")}" alt="" width="16" height="16"><span></span>`;
  task.querySelector("span")!.textContent = app?.title ?? id;
  task.addEventListener("click", () => {
    if (win === active && !isMinimized(win)) minimize(win);
    else focus(win);
  });
  tasks.append(task);

  const win: Win = { id, el, task, invoker };
  wins.set(id, win);
  place(el, app);
  document.dispatchEvent(new CustomEvent("xp:open", { detail: el }));
  return win;
}

function focus(win: Win, moveFocus = true) {
  const wasMinimized = isMinimized(win);
  delete win.el.dataset.state;
  if (wasMinimized) play("restore");
  win.el.style.zIndex = String(++z);
  active = win;
  for (const w of wins.values()) {
    w.el.classList.toggle("inactive", w !== win);
    w.task.setAttribute("aria-pressed", String(w === win));
  }
  if (moveFocus && !win.el.contains(document.activeElement)) win.el.focus({ preventScroll: true });
  syncLocation();
}

function deactivate() {
  active = null;
  for (const w of wins.values()) {
    w.el.classList.add("inactive");
    w.task.setAttribute("aria-pressed", "false");
  }
}

function minimize(win: Win) {
  win.el.dataset.state = "minimized";
  play("minimize");
  const next = topWindow(win);
  if (next) focus(next);
  else {
    deactivate();
    win.task.focus();
  }
}

function toggleMax(win: Win) {
  if (phone.matches) return;
  const { el } = win;
  const max = !el.classList.contains("maximized");
  el.classList.toggle("maximized", max);
  const button = $(`[data-action="maximize"], [data-action="restore"]`, el);
  button.setAttribute("aria-label", max ? "Restore" : "Maximize");
  button.dataset.action = max ? "restore" : "maximize";
}

function close(win: Win) {
  win.el.remove();
  win.task.remove();
  wins.delete(win.id);
  if (active === win) active = null;
  const next = topWindow();
  if (next) focus(next, false);
  else syncLocation();
  // A Start menu invoker is still connected but hidden, and can't take focus.
  const { invoker } = win;
  const back = invoker?.isConnected && invoker.offsetParent !== null ? invoker : next?.el ?? (invoker ? startButton : $(".desktop-icon"));
  back?.focus({ preventScroll: true });
}

/** The address bar follows the active window, so any state can be shared as a link. */
/** Folders have no route, so over one the address follows the topmost window that has one. */
function syncLocation(push = false) {
  const routed = (w: Win) => !!appById[w.id]?.href && !isMinimized(w);
  let shown = active && routed(active) ? active : null;
  if (active && !shown) {
    for (const w of wins.values()) if (routed(w) && (!shown || Number(w.el.style.zIndex) > Number(shown.el.style.zIndex))) shown = w;
  }
  const href = shown ? appById[shown.id].href! : "/";
  document.title = shown?.el.dataset.doctitle ?? homeTitle;
  if (location.pathname === href) return;
  history[push ? "pushState" : "replaceState"](null, "", href);
}

const cache = new Map<string, Promise<Document | null>>();

function fetchPage(href: string) {
  if (!cache.has(href)) {
    cache.set(
      href,
      fetch(href)
        .then((r) => (r.ok ? r.text() : null))
        .then((t) => (t ? new DOMParser().parseFromString(t, "text/html") : null))
        .catch(() => null),
    );
  }
  return cache.get(href)!;
}

async function open(id: string, invoker?: HTMLElement | null, push = true) {
  const existing = wins.get(id);
  if (existing) {
    focus(existing);
    return;
  }
  const app = appById[id];
  if (!app) return;

  let el: HTMLElement | null = null;
  let doctitle: string | undefined;
  if (app.items) el = buildFolder(app);
  else if (app.href) {
    const doc = await fetchPage(app.href);
    const found = doc?.querySelector<HTMLElement>(`[data-window="${id}"]`);
    if (!found) {
      // Route not on the desktop yet: just go there.
      location.assign(app.href);
      return;
    }
    if (wins.has(id)) return focus(wins.get(id)!);
    el = document.importNode(found, true);
    doctitle = doc!.title;
  }
  if (!el) return;

  if (doctitle) el.dataset.doctitle = doctitle;
  el.classList.add("opening");
  el.addEventListener("animationend", () => el!.classList.remove("opening"), { once: true });
  layer.append(el);
  const win = register(el, invoker);
  // Push before focus(): its own sync replaces, and would leave nothing for this push to add.
  active = win;
  if (push) syncLocation(true);
  focus(win);
}

function buildFolder(app: App) {
  const body = document.createElement("div");
  body.className = "folder";
  for (const id of app.items ?? []) {
    const child = appById[id];
    const a = document.createElement("a");
    a.className = "desktop-icon";
    a.href = child.href ?? `#${id}`;
    a.dataset.open = id;
    a.innerHTML = `<img src="${iconSrc(child.icon)}" srcset="${iconSrc(child.icon)} 1x, ${iconSrc(child.icon, 96)} 3x" alt="" width="32" height="32"><span></span>`;
    a.querySelector("span")!.textContent = child.title.split(" - ")[0];
    body.append(a);
  }
  return buildWindow(app, body);
}

/** Same markup as components/Window.astro, for windows that have no route. */
function buildWindow(app: App, body: Node) {
  const el = document.createElement("section");
  el.className = "window";
  el.dataset.window = app.id;
  el.dataset.icon = app.icon;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-labelledby", `${app.id}-title`);
  el.innerHTML = `
    <div class="title-bar">
      <img class="title-bar-icon" src="${iconSrc(app.icon)}" alt="" width="16" height="16">
      <h2 class="title-bar-text" id="${app.id}-title"></h2>
      <div class="title-bar-controls">
        <button type="button" aria-label="Minimize" data-action="minimize"></button>
        <button type="button" aria-label="Maximize" data-action="maximize"></button>
        <button type="button" aria-label="Close" data-action="close"></button>
      </div>
    </div>
    <div class="window-body flush"></div>`;
  $(".title-bar-text", el).textContent = app.title;
  $(".window-body", el).append(body);
  return el;
}

const winOf = (target: EventTarget | null) => {
  const el = (target as Element | null)?.closest?.<HTMLElement>("[data-window]");
  return el ? wins.get(el.dataset.window!) : undefined;
};

// Title bar buttons, and raising a window when anything inside it is touched.
layer.addEventListener("pointerdown", (e) => {
  const win = winOf(e.target);
  if (win && win !== active) focus(win, false);
});

layer.addEventListener("focusin", (e) => {
  const win = winOf(e.target);
  if (win && win !== active) focus(win, false);
});

layer.addEventListener("click", (e) => {
  const button = (e.target as Element).closest<HTMLElement>("[data-action]");
  const win = winOf(e.target);
  if (!button || !win) return;
  const action = button.dataset.action;
  if (action === "close") close(win);
  else if (action === "minimize") minimize(win);
  else toggleMax(win);
});

layer.addEventListener("dblclick", (e) => {
  const bar = (e.target as Element).closest(".title-bar");
  if (bar && !(e.target as Element).closest("button")) {
    const win = winOf(e.target);
    if (win) toggleMax(win);
  }
});

/* ---------- drag and resize ---------- */

const MIN_W = 260;
const MIN_H = 160;

layer.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || phone.matches) return;
  const target = e.target as HTMLElement;
  const win = winOf(target);
  if (!win || win.el.classList.contains("maximized")) return;
  const dir = target.dataset.resize;
  const onBar = target.closest(".title-bar") && !target.closest("button");
  if (!dir && !onBar) return;

  e.preventDefault();
  const { el } = win;
  // preventDefault stops the click from moving focus, so the raised window takes it here.
  if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
  const area = layer.getBoundingClientRect();
  const start = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  target.setPointerCapture(e.pointerId);

  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    if (!dir) {
      const left = Math.min(Math.max(start.left + dx, 60 - start.w), area.width - 60);
      const top = Math.min(Math.max(start.top + dy, 0), area.height - 24);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      return;
    }
    let { left, top, w, h } = start;
    if (dir.includes("e")) w = Math.max(MIN_W, start.w + dx);
    if (dir.includes("s")) h = Math.max(MIN_H, start.h + dy);
    if (dir.includes("w")) {
      w = Math.max(MIN_W, start.w - dx);
      left = start.left + start.w - w;
    }
    if (dir.includes("n")) {
      h = Math.max(MIN_H, start.h - dy);
      top = Math.max(0, start.top + start.h - h);
      h = start.top + start.h - top;
    }
    Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` });
  };
  const up = () => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    target.removeEventListener("pointercancel", up);
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", up);
});

// Same bounds as a drag, so a title bar never ends up out of reach.
addEventListener("resize", () => {
  const area = layer.getBoundingClientRect();
  for (const { el } of wins.values()) {
    if (el.classList.contains("maximized")) continue;
    el.style.left = `${Math.min(Math.max(el.offsetLeft, 60 - el.offsetWidth), area.width - 60)}px`;
    el.style.top = `${Math.min(Math.max(el.offsetTop, 0), area.height - 24)}px`;
  }
});

/* ---------- opening things ---------- */

// WebKit, so every iPhone browser, reports a tap's click as pointerType "mouse". The pointerdown
// before it reports "touch", so clicks ask this instead. A keyboard click has detail 0.
let lastPointer = "";
addEventListener("pointerdown", (e) => (lastPointer = e.pointerType), { capture: true, passive: true });
const byMouse = (e: MouseEvent) => e.detail > 0 && lastPointer === "mouse";

// Desktop and folder icons: a mouse selects on click and opens on double-click, like XP.
// Touch, keyboard and every other [data-open] link open on a single activation.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const link = (e.target as Element).closest<HTMLElement>("[data-open]");
  if (!link) return;
  e.preventDefault();
  const isIcon = link.classList.contains("desktop-icon");
  const mouse = byMouse(e);
  if (isIcon && mouse && e.detail === 1) {
    selectIcon(link);
    return;
  }
  if (isIcon && mouse && e.detail > 2) return;
  closeStart();
  selectIcon(null);
  open(link.dataset.open!, link);
});

function selectIcon(icon: HTMLElement | null) {
  for (const el of document.querySelectorAll(".desktop-icon.selected")) el.classList.remove("selected");
  icon?.classList.add("selected");
  icon?.focus({ preventScroll: true });
}

// Clicking empty desktop clears the selection and leaves no window active, as XP does.
desktop.addEventListener("pointerdown", (e) => {
  const t = e.target as Element;
  if (t === desktop || t === layer || t.classList.contains("desktop-icons")) {
    selectIcon(null);
    deactivate();
  }
});

addEventListener("popstate", () => {
  const app = apps.find((a) => a.href === location.pathname);
  if (app) open(app.id, null, false);
  else location.reload();
});

/* ---------- Start menu ---------- */

const menuItems = () =>
  [...startMenu.querySelectorAll<HTMLElement>("[role=menuitem], .start-foot button")].filter(
    (el) => el.offsetParent !== null,
  );

function openStart() {
  startMenu.hidden = false;
  startButton.setAttribute("aria-expanded", "true");
  menuItems()[0]?.focus();
}

function closeStart(returnFocus = false) {
  if (startMenu.hidden) return;
  startMenu.hidden = true;
  setPrograms(false);
  startButton.setAttribute("aria-expanded", "false");
  if (returnFocus) startButton.focus();
}

function setPrograms(show: boolean) {
  programs.hidden = !show;
  startAll.setAttribute("aria-expanded", String(show));
}

startButton.addEventListener("click", () => (startMenu.hidden ? openStart() : closeStart()));
// A mouse has already opened the list by hovering, so its click keeps it open; touch and keys toggle.
startAll.addEventListener("click", (e) => {
  setPrograms(byMouse(e) || Boolean(programs.hidden));
  if (!programs.hidden) $<HTMLElement>("[role=menuitem]", programs).focus();
});
startAll.addEventListener("pointerenter", (e) => {
  if (e.pointerType === "mouse") setPrograms(true);
});
startMenu.addEventListener("pointerover", (e) => {
  const t = e.target as Element;
  if ((e as PointerEvent).pointerType === "mouse" && !t.closest(".start-all-wrap") && t.closest(".start-cols")) setPrograms(false);
});

startMenu.addEventListener("keydown", (e) => {
  const items = menuItems();
  const i = items.indexOf(document.activeElement as HTMLElement);
  const inPrograms = programs.contains(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const scope = inPrograms ? items.filter((el) => programs.contains(el)) : items.filter((el) => !programs.contains(el));
    const j = scope.indexOf(document.activeElement as HTMLElement);
    const next = scope[(j + (e.key === "ArrowDown" ? 1 : -1) + scope.length) % scope.length];
    next?.focus();
  } else if (e.key === "ArrowRight" && document.activeElement === startAll) {
    e.preventDefault();
    setPrograms(true);
    $<HTMLElement>("[role=menuitem]", programs).focus();
  } else if (e.key === "ArrowLeft" && inPrograms) {
    e.preventDefault();
    setPrograms(false);
    startAll.focus();
  } else if (e.key === "Tab" && i >= 0) {
    closeStart();
  }
});

document.addEventListener("pointerdown", (e) => {
  const t = e.target as Element;
  if (!startMenu.hidden && !startMenu.contains(t) && !startButton.contains(t)) closeStart();
});

/* ---------- tray ---------- */

const clock = $<HTMLTimeElement>("#tray-clock");
function tick() {
  const now = new Date();
  clock.textContent = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  clock.dateTime = now.toISOString();
  clock.title = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  setTimeout(tick, 60_000 - (Date.now() % 60_000));
}
tick();

const balloon = $("#balloon");
let balloonTimer = 0;

function showBalloon() {
  balloon.hidden = false;
  play("balloon");
  balloonTimer = window.setTimeout(hideBalloon, 10_000);
}

function hideBalloon() {
  clearTimeout(balloonTimer);
  balloon.hidden = true;
}

balloon.addEventListener("click", (e) => {
  hideBalloon();
  if (!(e.target as Element).closest(".balloon-close")) open("welcome");
});

/* ---------- power ---------- */

const powerDialog = $("#power-dialog");
const shutdownScreen = $("#shutdown");

function reboot() {
  try {
    sessionStorage.removeItem("xp-booted");
    sessionStorage.removeItem("xp-chimed");
  } catch {}
  location.assign("/");
}

function hidePower() {
  powerDialog.hidden = true;
  html.classList.remove("powering");
  startButton.focus();
}

document.addEventListener("click", (e) => {
  const button = (e.target as Element).closest<HTMLElement>("[data-power]");
  if (!button) return;
  const action = button.dataset.power;
  closeStart();
  if (action === "dialog") {
    html.classList.add("powering");
    powerDialog.hidden = false;
    $<HTMLElement>('[data-power="shutdown"]', powerDialog).focus();
  } else if (action === "cancel") hidePower();
  else if (action === "restart") play("shutdown", true).then(reboot);
  else if (action === "logoff") play("logoff", true).then(reboot);
  else if (action === "shutdown") {
    powerDialog.hidden = true;
    play("shutdown");
    shutdownScreen.hidden = false;
    shutdownScreen.tabIndex = -1;
    shutdownScreen.focus();
  }
});

shutdownScreen.addEventListener("click", reboot);
shutdownScreen.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") reboot();
});

powerDialog.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const items = [...powerDialog.querySelectorAll<HTMLElement>("button")];
  const i = items.indexOf(document.activeElement as HTMLElement);
  e.preventDefault();
  items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
});

/* ---------- keyboard ---------- */

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!powerDialog.hidden) return hidePower();
  if (!startMenu.hidden) return closeStart(true);
  if (e.defaultPrevented || (e.target as Element).closest?.("input, textarea, select, [contenteditable]")) return;
  const focused = winOf(document.activeElement);
  if (focused) return close(focused);
  if (!balloon.hidden) return hideBalloon();
  if (active && document.activeElement === document.body) close(active);
});

/* ---------- start-up ---------- */

for (const el of layer.querySelectorAll<HTMLElement>(":scope > [data-window]")) {
  el.dataset.doctitle = document.title;
  register(el);
}
const first = topWindow();
if (first) focus(first, false);
