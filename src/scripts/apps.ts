// What happens inside windows. Windows fetched from other routes arrive without their scripts, so
// every app's behaviour is a delegated handler here, keyed on data attributes in its markup.

import { play } from "./desktop";
import { iconSrc } from "../data/apps";

const windowOf = (el: Element) => el.closest<HTMLElement>("[data-window]");
const closeWindow = (el: Element) => windowOf(el)?.querySelector<HTMLElement>('[data-action="close"]')?.click();

document.addEventListener("click", (e) => {
  const t = e.target as Element;

  const ie = t.closest<HTMLElement>("[data-ie]");
  if (ie) {
    const frame = ie.closest(".ie")!.querySelector<HTMLIFrameElement>(".ie-page")!;
    frame.src = ie.dataset.ie === "home" ? frame.dataset.home! : frame.src;
    return;
  }

  const pv = t.closest<HTMLElement>("[data-pv]");
  if (pv) return viewer(pv.closest(".pv")!, pv.dataset.pv!);

  const wiz = t.closest<HTMLElement>("[data-wiz]");
  if (wiz) return wizard(wiz.closest(".wiz")!, wiz.dataset.wiz!);

  const tab = t.closest<HTMLElement>('.sysprop [role="tab"]');
  if (tab) return selectTab(tab);

  if (t.closest("[data-close]")) return closeWindow(t);

  if (t.closest('[data-wp="print"]')) return print();

  if (t.closest('[data-bin="empty"]')) return emptyBin(t.closest(".explorer")!);
});

/* ---------- Picture and Fax Viewer ---------- */

let slideshow = 0;

function viewer(root: HTMLElement, action: string) {
  const shots = [...root.querySelectorAll<HTMLElement>(".pv-shot")];
  const i = Math.max(0, shots.findIndex((s) => s.classList.contains("current")));
  const show = (j: number) => {
    const n = (j + shots.length) % shots.length;
    shots.forEach((s, k) => s.classList.toggle("current", k === n));
    root.querySelector(".pv-count")!.textContent = `${n + 1} of ${shots.length}`;
  };

  if (action === "prev") show(i - 1);
  else if (action === "next") show(i + 1);
  else if (action === "fit" || action === "actual") {
    root.classList.toggle("actual", action === "actual");
    root.querySelector('[data-pv="fit"]')!.setAttribute("aria-pressed", String(action === "fit"));
    root.querySelector('[data-pv="actual"]')!.setAttribute("aria-pressed", String(action === "actual"));
  } else if (action === "slideshow") {
    const stage = root.querySelector<HTMLElement>(".pv-stage")!;
    stage.requestFullscreen?.().then(() => {
      let j = i;
      slideshow = window.setInterval(() => show(++j), 3000);
    }, () => {});
  }
}

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) clearInterval(slideshow);
});

/* ---------- setup wizards ---------- */

function wizard(root: HTMLElement, action: string) {
  if (action === "cancel") return closeWindow(root);
  const pages = [...root.querySelectorAll<HTMLElement>(".wiz-page")];
  const i = Math.max(0, pages.findIndex((p) => p.classList.contains("current")));
  const n = Math.min(pages.length - 1, Math.max(0, i + (action === "next" ? 1 : -1)));
  pages.forEach((p, k) => p.classList.toggle("current", k === n));
  const back = root.querySelector<HTMLButtonElement>('[data-wiz="back"]')!;
  back.disabled = n === 0;
  // Keep focus on the button row: Next turns into Finish on the last page, Back dies on the first.
  const target = n === pages.length - 1 ? root.querySelector<HTMLElement>(".wiz-finish") : back.disabled ? root.querySelector<HTMLElement>('[data-wiz="next"]') : null;
  target?.focus();
  root.querySelector("[data-wiz-status]")!.textContent = `Step ${n + 1} of ${pages.length}: ${pages[n].getAttribute("aria-label")}`;
}

/* ---------- System Properties tabs ---------- */

function selectTab(tab: HTMLElement) {
  const list = tab.closest('[role="tablist"]')!;
  for (const t of list.querySelectorAll<HTMLElement>('[role="tab"]')) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")!)?.classList.toggle("current", on);
  }
  tab.focus();
}

document.addEventListener("keydown", (e) => {
  const tab = (e.target as Element).closest?.<HTMLElement>('.sysprop [role="tab"]');
  if (!tab || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
  const tabs = [...tab.parentElement!.querySelectorAll<HTMLElement>('[role="tab"]')];
  const i = tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : -1);
  selectTab(tabs[(i + tabs.length) % tabs.length]);
});

/* ---------- Recycle Bin ---------- */

// A reopened window is cloned from the fetched page, full again, so the emptying is replayed.
let binEmptied = false;
document.addEventListener("xp:open", (e) => {
  const el = (e as CustomEvent<HTMLElement>).detail;
  if (binEmptied && el.dataset.window === "recycle-bin") emptyBin(el.querySelector(".explorer")!, false);
});

function emptyBin(root: HTMLElement, sound = true) {
  const files = root.querySelectorAll<HTMLElement>(".ex-file");
  if (!files.length) return;
  binEmptied = true;
  if (sound) play("recycle");
  files.forEach((f) => f.remove());
  root.querySelector<HTMLElement>(".ex-empty")!.hidden = false;
  root.querySelector(".ex-count")!.textContent = "0 objects";
  root.querySelector<HTMLButtonElement>('[data-bin="empty"]')!.disabled = true;
  const empty = iconSrc("recycle-bin-empty");
  for (const img of document.querySelectorAll<HTMLImageElement>(
    '[data-open="recycle-bin"] img, [data-window="recycle-bin"] .title-bar-icon, [data-task="recycle-bin"] img',
  )) {
    img.src = empty;
    img.srcset = img.srcset ? `${empty} 1x, ${iconSrc("recycle-bin-empty", 96)} 3x` : "";
  }
}
