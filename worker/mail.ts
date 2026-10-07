// What a messenger Send becomes: the visitor's lines, checked, as one plain-text e-mail.

export const MAX_LINE = 1000;
export const MAX_LINES = 20;
export const MAX_TEXT = 8 * 1024;

export type Topic = "job" | "project";
export type Mx = "ok" | "none" | "unknown";

export interface Message {
  visitor: string;
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

// Header-bound fields never carry line breaks or other controls; the body allows newlines and tabs.
const HEADER_UNSAFE = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;
const BODY_UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
export const OWN_DOMAIN = "amirbalazade.com";

const text = (v: unknown, max: number, min = 1) =>
  typeof v === "string" && v.length >= min && v.length <= max && !HEADER_UNSAFE.test(v);

const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);

export function isAddress(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 254 || !ADDRESS.test(v)) return false;
  const domain = v.slice(v.lastIndexOf("@") + 1).toLowerCase();
  return domain !== OWN_DOMAIN && !domain.endsWith(`.${OWN_DOMAIN}`);
}

/** The request body as a Message, or null when anything in it is off. */
export function parse(body: unknown): Message | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!text(b.visitor, 40) || !/^[A-Za-z0-9_]+$/.test(b.visitor as string)) return null;
  if (!text(b.page, 200) || !(b.page as string).startsWith("/")) return null;
  if (typeof b.first !== "boolean") return null;
  if (!Array.isArray(b.lines) || b.lines.length < 1 || b.lines.length > MAX_LINES) return null;
  const lines = b.lines.map((l) => (typeof l === "string" ? l.trim() : ""));
  if (lines.some((l) => !l || l.length > MAX_LINE || BODY_UNSAFE.test(l))) return null;
  if (!optional(b.name, (v) => text(v, 80))) return null;
  if (!optional(b.company, (v) => text(v, 80))) return null;
  if (!optional(b.replyTo, isAddress)) return null;
  if (!optional(b.topic, (v) => v === "job" || v === "project")) return null;
  return {
    visitor: b.visitor as string,
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
  const base = `Website message from ${m.visitor}`;
  if (!m.first) return base;
  return [m.topic && TAGS[m.topic], base, m.name && `· ${m.name}`].filter(Boolean).join(" ");
}

const MX_NOTE: Record<Mx, string> = {
  ok: "mail server found",
  none: "no mail server found for its domain",
  unknown: "mail server not checked",
};

export function body(m: Message, c: Context) {
  const who = [m.name, m.company].filter(Boolean).join(", ");
  const time = c.now.toISOString().slice(0, 16).replace("T", " ");
  const footer = [
    who && `Name: ${who}`,
    m.replyTo && `Reply to: ${m.replyTo} (${MX_NOTE[c.mx ?? "unknown"]})`,
    `Visitor: ${m.visitor}`,
    c.country && `Country: ${c.country}`,
    `Time: ${time} UTC`,
    `Page: ${m.page}`,
  ].filter(Boolean);
  return `${m.lines.join("\n")}\n\n-- \n${footer.join("\n")}\n`;
}

/** Threads every e-mail from one visitor together. */
export const threadId = (visitor: string) => `<ym.${visitor}@${OWN_DOMAIN}>`;
