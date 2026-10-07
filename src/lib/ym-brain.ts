// Amir's side of the messenger: what he answers to each of the visitor's lines. He reads their
// reply address, a likely typo in it and their name, asks about each once, and understands the
// answer: yes, no, a correction, or a line about something else. Pure: the chat keeps the Profile
// and posts the lines.

import ym from "../data/ym.json";
import { findAddress, findTopic, findWho, type Topic } from "./ym-parse";

export type Question =
  /** Reply to this address? */
  | { kind: "address"; address: string }
  /** Did you mean the suggestion? */
  | { kind: "typo"; address: string; suggestion: string }
  /** Are you this person, from this company? */
  | { kind: "who"; name?: string; company?: string }
  | { kind: "ask-address" }
  | { kind: "ask-name" };

export interface Profile {
  reply?: string;
  name?: string;
  company?: string;
  topic?: Topic;
  /** Never asked again: "ask-address", "ask-name", "address:<a>", "who:<name>|<company>", "mx:<a>". */
  asked: string[];
  /** Waiting for an answer; `shown` once the line is on screen, so a line typed before it isn't one. */
  open?: Question & { shown?: true };
  /** Asked when the open question is settled. */
  later: Question[];
}

export interface Said {
  text: string;
  /** The question this line asks: the chat marks it shown when the line is posted. */
  ask?: Question;
}

export interface Reply {
  profile: Profile;
  say: Said[];
  /** False when the line only answered Amir's question: it stays out of the e-mail. */
  mail: boolean;
}

export const blank = (): Profile => ({ asked: [], later: [] });

/* ---------- Amir's lines ---------- */

const FIRST = "thanks! that's on its way to my inbox ✉";
const DOMAIN = (a: string) => a.slice(a.lastIndexOf("@") + 1);

function ask(q: Question, p: Profile): string {
  switch (q.kind) {
    case "address":
      return p.reply && p.reply !== q.address
        ? `should I write back to ${q.address} instead of ${p.reply}?`
        : `should I write back to ${q.address}?`;
    case "typo":
      return `quick check: did you mean ${q.suggestion}?`;
    case "who":
      if (q.name && q.company) return `nice to meet you! you're ${q.name} from ${q.company}, right?`;
      if (q.name) return `nice to meet you! you're ${q.name}, right?`;
      return `you're with ${q.company}, right?`;
    case "ask-address":
      return "what's your e-mail, so I can write back?";
    case "ask-name":
      return "sorry! what should I call you?";
  }
}

const SAVED = (a: string) => `got it, I'll write back to ${a} ✓`;
const MET = (p: Profile) => (p.name ? `nice to meet you, ${p.name} 👋` : `got it, ${p.company} 👍`);
const WHICH = "oops. what's the right address?";
const FINE = "no problem 👍";
const NO_MX = (a: string) => `hmm, ${DOMAIN(a)} doesn't seem to take e-mail. is ${a} right?`;

/* ---------- reading an answer ---------- */

const YES =
  "y|ya|yah|yeah|yea|yes+|yep|yup|ye|sure|correct|right|exactly|indeed|absolutely|definitely|of course|" +
  "ok|okay|k|kk|that['’]?s (?:right|it|me|correct)|it is|perfect|evet|aynen|doğru|tabii?|tamam|olur|si|sí|oui|ja|👍|✅|👌";
const NO = "n|no+|nope|nah|not quite|not really|not exactly|wrong|incorrect|hayır|hayir|yok|değil|degil|non|nein|👎|❌";
const LEAD = new RegExp(`^\\s*(?:(${NO})|(${YES}))(?=$|[^\\p{L}\\d])[\\s,.!:;-]*`, "iu");
const DECLINE = /\b(?:rather not|prefer not|no,? thanks?|no,? thank you|not now|skip|never ?mind|don['’]?t want|i['’]?ll pass)\b/i;
// What's left of "no, it's janet" once the lead-in goes.
const NAME_LEAD = /^(?:it['’]?s|i['’]?m|i am|this is|call me|my name is|name['’]?s)\s+/i;
// Short replies that aren't a name.
const NOT_A_NAME = /^(?:lol|haha+|hmm+|ok|nothing|nobody|anonymous|whatever|idk|why|what|huh)\b/i;

/** "yes"/"no" opening the line, and the rest of it. */
export function yesNo(text: string): { yes?: boolean; rest: string } {
  const m = LEAD.exec(text);
  if (!m) return { rest: text.trim() };
  return { yes: !m[1], rest: text.slice(m[0].length).trim() };
}

/** A name given on its own ("Janet", "no, it's janet"), up to three words. */
function bareName(rest: string): string | undefined {
  const s = rest.replace(NAME_LEAD, "").replace(/[.!]+$/, "").trim();
  if (!s || NOT_A_NAME.test(s) || !/^[\p{L}'’.-]+(?:\s+[\p{L}'’.-]+){0,2}$/u.test(s)) return;
  return findWho(`my name is ${s}`).name;
}

// Words that carry no message of their own in an answer.
const FILLER = new Set(
  `yes yeah yep yup sure ok okay no nope nah thanks thank you thx ty please pls it its it's that's thats
  is was mine my me i i'm im correct right exactly indeed absolutely definitely the one a an address
  email e-mail mail name call called great cool perfect awesome nice sorry oops lol haha and also just
  actually use instead typo mistake that this at dot should be meant mean spelled from with here`.split(/\s+/),
);

/** Whether an answer also says something worth e-mailing, beyond the address and name it gave. */
function saysMore(text: string, used: (string | undefined)[]) {
  let s = yesNo(text).rest.replace(/\S+@\S+/g, " ");
  for (const u of used) if (u) for (const w of u.split(/\s+/)) s = s.replace(w, " ");
  const words = s.toLowerCase().replace(/’/g, "'").match(/[\p{L}'][\p{L}'-]+/gu) ?? [];
  return words.filter((w) => !FILLER.has(w)).length >= 2;
}

/* ---------- the conversation ---------- */

function key(q: Question): string {
  switch (q.kind) {
    case "address":
      return `address:${q.address}`;
    case "typo":
      return `address:${q.address}`;
    case "who":
      return `who:${q.name ?? ""}|${q.company ?? ""}`;
    default:
      return q.kind;
  }
}

/** Answered meanwhile, by a line that settled something else. */
function settled(p: Profile, q: Question) {
  switch (q.kind) {
    case "address":
      return q.address === p.reply;
    case "typo":
      return q.address === p.reply || q.suggestion === p.reply;
    case "ask-address":
      return !!p.reply;
    case "who":
      return q.name === p.name && q.company === p.company;
    case "ask-name":
      return !!p.name;
  }
}

const asksAddress = (q?: Question) => !!q && (q.kind === "address" || q.kind === "typo" || q.kind === "ask-address");

class Turn {
  say: Said[] = [];
  constructor(public p: Profile) {}

  line(text: string) {
    this.say.push({ text });
  }

  /** Queues a question, asked now if nothing else is waiting. */
  queue(q: Question, force = false, text?: string) {
    const k = key(q);
    if (!force && this.p.asked.includes(k)) return;
    if (!this.p.asked.includes(k)) this.p.asked.push(k);
    if (this.p.open) this.p.later.push(q);
    else this.open(q, text);
  }

  open(q: Question, text = ask(q, this.p)) {
    this.p.open = q;
    this.say.push({ text, ask: q });
  }

  /** Asks the next waiting question that still matters. */
  next() {
    while (!this.p.open && this.p.later.length) {
      const q = this.p.later.shift()!;
      if (!settled(this.p, q)) this.open(q);
    }
  }

  /** An address they just typed: kept unless it looks mistyped. */
  address(found: { address: string; suggestion?: string }) {
    if (found.suggestion) return this.queue({ kind: "typo", ...found } as Question, true);
    this.p.reply = found.address;
    this.line(SAVED(found.address));
  }
}

/** Settles the open question with this line, or returns false when the line is about something else. */
function answer(t: Turn, q: Question, text: string): { used: (string | undefined)[] } | false {
  const { yes, rest } = yesNo(text);
  const p = t.p;
  switch (q.kind) {
    case "address":
    case "ask-address": {
      const found = findAddress(rest);
      if (found && found.address !== (q.kind === "address" ? q.address : undefined)) {
        t.address(found);
        return { used: [] };
      }
      if (q.kind === "address") {
        if (yes === true || found) {
          p.reply = q.address;
          t.line(SAVED(q.address));
        } else if (yes === false) t.queue({ kind: "ask-address" }, true, WHICH);
        else return false;
      } else if (yes === false || DECLINE.test(text)) t.line(FINE);
      else return false;
      return { used: [] };
    }
    case "typo": {
      const found = findAddress(rest);
      if (found && found.address !== q.address && found.address !== q.suggestion) t.address(found);
      else if (found?.address === q.address || yes === false) {
        p.reply = q.address;
        t.line(SAVED(q.address));
      } else if (found?.address === q.suggestion || yes === true) {
        p.reply = q.suggestion;
        t.line(SAVED(q.suggestion));
      } else return false;
      return { used: [] };
    }
    case "who":
    case "ask-name": {
      const who = findWho(rest);
      const name = who.name ?? (yes !== true ? bareName(rest) : undefined);
      if (name || who.company) {
        // A correction: what they typed now wins, the rest of the question stands if they said yes.
        p.name = name ?? (q.kind === "who" && yes === true ? q.name : p.name);
        p.company = who.company ?? (q.kind === "who" && yes === true ? q.company : p.company);
        t.line(MET(p));
        return { used: [name, who.company] };
      }
      if (q.kind === "who" && yes === true) {
        p.name = q.name ?? p.name;
        p.company = q.company ?? p.company;
        t.line(MET(p));
        return { used: [] };
      }
      if (q.kind === "who" && yes === false) t.queue({ kind: "ask-name" }, true);
      else if (yes === false || DECLINE.test(text)) t.line(FINE);
      else return false;
      return { used: [] };
    }
  }
}

/** What Amir says to the visitor's line, and what he learnt from it. */
export function respond(
  profile: Profile,
  text: string,
  visit: {
    /** No line of this visit has gone out by e-mail yet. */
    first: boolean;
    /** This visit's e-mailed lines so far, for the topic. */
    earlier: string;
  },
): Reply {
  const t = new Turn(structuredClone(profile));
  const p = t.p;
  let mail = true;

  const open = p.open?.shown ? p.open : undefined;
  if (open) {
    const { shown: _, ...q } = open;
    p.open = undefined;
    const settled = answer(t, q, text);
    if (settled) mail = saysMore(text, settled.used);
  }

  if (mail) {
    if (visit.first) t.line(FIRST);
    if (!p.topic) {
      p.topic = findTopic(`${visit.earlier}\n${text}`);
      if (p.topic) t.line(ym.topics[p.topic]);
    }
    const found = findAddress(text);
    if (found && ![found.address, found.suggestion].includes(p.reply ?? "-")) {
      t.queue(found.suggestion ? ({ kind: "typo", ...found } as Question) : { kind: "address", address: found.address });
    }
    const who = findWho(text);
    if ((who.name && who.name !== p.name) || (who.company && who.company !== p.company)) t.queue({ kind: "who", ...who });
    if (!p.reply && ![p.open, ...p.later].some(asksAddress)) t.queue({ kind: "ask-address" });
  }

  t.next();
  return { profile: p, say: t.say, mail };
}

/** The Worker found no mail server for the reply address: Amir asks once whether it's right. */
export function bounced(profile: Profile, address: string): Reply {
  const t = new Turn(structuredClone(profile));
  if (!t.p.asked.includes(`mx:${address}`)) {
    t.p.asked.push(`mx:${address}`);
    const q: Question = { kind: "address", address };
    if (t.p.open) t.p.later.unshift(q);
    else {
      t.p.open = q;
      t.say.push({ text: NO_MX(address), ask: q });
    }
  }
  return { profile: t.p, say: t.say, mail: false };
}
