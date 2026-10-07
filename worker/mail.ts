// What a messenger Send becomes: the visitor's lines, checked, as one plain-text e-mail.

import {
  BODY_UNSAFE,
  findContacts,
  HEADER_UNSAFE,
  isAddress,
  isSpam,
  MAX_LINE,
  MAX_LINES,
  MAX_NAME,
  MAX_PAGE,
  MAX_TEXT,
  OWN_DOMAIN,
  THREAD,
  type Topic,
} from "../src/lib/ym-parse";

export { isAddress, MAX_LINE, MAX_LINES, MAX_TEXT, OWN_DOMAIN, type Topic };

export type Mx = "ok" | "none" | "unknown";

export interface Message {
  visitor: string;
  /** Tells one visitor's thread from another's when ids collide. */
  thread?: string;
  lines: string[];
  /** The visit's first e-mail: its subject carries the name and topic. */
  first: boolean;
  page: string;
  name?: string;
  company?: string;
  replyTo?: string;
  topic?: Topic;
}

export interface Context {
  country?: string;
  now: Date;
  mx?: Mx;
}

const text = (v: unknown, max: number, min = 1) =>
  typeof v === "string" && v.length >= min && v.length <= max && !HEADER_UNSAFE.test(v);

const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);

/** The request body as a Message, or null when anything in it is off. */
export function parse(body: unknown): Message | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!text(b.visitor, 40) || !/^[A-Za-z0-9_]+$/.test(b.visitor as string)) return null;
  if (!text(b.page, MAX_PAGE) || !(b.page as string).startsWith("/")) return null;
  if (!optional(b.thread, (v) => typeof v === "string" && THREAD.test(v))) return null;
  if (typeof b.first !== "boolean") return null;
  if (!Array.isArray(b.lines) || b.lines.length < 1 || b.lines.length > MAX_LINES) return null;
  const lines = b.lines.map((l) => (typeof l === "string" ? l.trim() : ""));
  if (lines.some((l) => !l || l.length > MAX_LINE || BODY_UNSAFE.test(l))) return null;
  if (!optional(b.name, (v) => text(v, MAX_NAME))) return null;
  if (!optional(b.company, (v) => text(v, MAX_NAME))) return null;
  if (!optional(b.replyTo, isAddress)) return null;
  if (!optional(b.topic, (v) => v === "job" || v === "project")) return null;
  return {
    visitor: b.visitor as string,
    thread: b.thread as string | undefined,
    lines,
    first: b.first,
    page: b.page as string,
    name: b.name as string | undefined,
    company: b.company as string | undefined,
    replyTo: b.replyTo as string | undefined,
    topic: b.topic as Topic | undefined,
  };
}

export const tooLong = (m: Message) => new TextEncoder().encode(m.lines.join("\n")).length > MAX_TEXT;

const TAGS: Record<Topic, string> = { job: "[Job]", project: "[Project]" };

export function subject(m: Message) {
  // Tagged, never dropped: a false positive still reaches the inbox.
  const spam = isSpam(m.lines.join("\n")) && "[Possible spam]";
  const base = `Website message from ${m.visitor}${m.thread ? ` #${m.thread.slice(0, 6)}` : ""}`;
  if (!m.first) return [spam, base].filter(Boolean).join(" ");
  return [spam, m.topic && TAGS[m.topic], base, m.name && `· ${m.name}`].filter(Boolean).join(" ");
}

const MX_NOTE: Record<Mx, string> = {
  ok: "mail server found",
  none: "no mail server found for its domain",
  unknown: "mail server not checked",
};

export function body(m: Message, c: Context) {
  const who = [m.name, m.company].filter(Boolean).join(", ");
  const time = c.now.toISOString().slice(0, 16).replace("T", " ");
  const found = findContacts(m.lines.join("\n"));
  const footer = [
    who && `Name: ${who}`,
    m.replyTo && `Reply to: ${m.replyTo} (${MX_NOTE[c.mx ?? "unknown"]})`,
    ...found.phones.map((p) => `Phone: ${p}`),
    ...found.linkedin.map((u) => `LinkedIn: ${u}`),
    ...found.github.map((u) => `GitHub: ${u}`),
    `Visitor: ${m.visitor}`,
    c.country && `Country: ${c.country}`,
    `Time: ${time} UTC`,
    `Page: ${m.page}`,
  ].filter(Boolean);
  return `${m.lines.join("\n")}\n\n-- \n${footer.join("\n")}\n`;
}

/** Threads every e-mail from one visitor together. */
export const threadId = (m: Pick<Message, "visitor" | "thread">) => `<ym.${m.thread ?? m.visitor}@${OWN_DOMAIN}>`;
