// Every window the desktop can open. `href` is the window's own route: the desktop fetches it and
// lifts its [data-window] element, so a route and its window never drift apart. Apps without an
// href are built on the client (folders, dialogs).

export interface App {
  id: string;
  title: string;
  icon: string;
  href?: string;
  /** Label under the desktop icon; omit to keep the app off the desktop. */
  desktop?: string;
  /** Children of a folder window. */
  items?: string[];
  width?: number;
  height?: number;
}

export const apps: App[] = [
  { id: "welcome", title: "Welcome", icon: "tour-xp", href: "/", width: 560, height: 360 },
  { id: "remorch-app", title: "Remorch - Internet Explorer", icon: "ie", href: "/work/remorch-app", desktop: "Remorch", width: 960, height: 640 },
  { id: "remorch-panel", title: "Remorch Admin - Picture and Fax Viewer", icon: "picture-viewer", href: "/work/remorch-panel", desktop: "Remorch Admin", width: 900, height: 620 },
  { id: "remorch-pay", title: "Remorch Pay - Picture and Fax Viewer", icon: "picture-viewer", href: "/work/remorch-pay", desktop: "Remorch Pay", width: 900, height: 620 },
  { id: "wordy", title: "wordy.cards Setup", icon: "setup", href: "/work/wordy", desktop: "wordy.cards", width: 600, height: 460 },
  { id: "zhambon", title: "Zhambon Setup", icon: "wizard", href: "/work/zhambon", desktop: "Zhambon", width: 600, height: 460 },
  { id: "demos", title: "Demos", icon: "folder-opened", desktop: "Demos", items: ["ossa", "cairn"], width: 420, height: 280 },
  { id: "ossa", title: "OSSA - Internet Explorer", icon: "ie", href: "/work/ossa", width: 960, height: 640 },
  { id: "cairn", title: "CAIRN - Internet Explorer", icon: "ie", href: "/work/cairn", width: 960, height: 640 },
  { id: "cv", title: "Resume.doc - WordPad", icon: "wordpad", href: "/cv", desktop: "Resume.doc", width: 760, height: 620 },
  { id: "contact", title: "Outlook Express", icon: "outlook-express", href: "/contact", desktop: "Outlook Express", width: 560, height: 420 },
  { id: "about", title: "System Properties", icon: "system-properties", href: "/about", desktop: "My Computer", width: 420, height: 460 },
  { id: "recycle-bin", title: "Recycle Bin", icon: "recycle-bin-full", href: "/recycle-bin", desktop: "Recycle Bin", width: 520, height: 340 },
];

export const appById = Object.fromEntries(apps.map((a) => [a.id, a]));

/** Desktop icon for an app: My Computer shows its own icon, not the window's. */
export const desktopIcon: Record<string, string> = { about: "my-computer" };

export const iconSrc = (name: string, size: 32 | 96 = 32) => `/xp/icons/${size}/${name}.png`;
