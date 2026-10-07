// What the messenger reads out of a visitor's lines: a reply address (and its likely typo), a name
// and company, the topic, phones and profile links, and spam signs. Pure, and free of lookbehind
// (Safari < 16.4): the chat uses it to ask the right questions, the Worker to annotate the e-mail.

export const OWN_DOMAIN = "amirbalazade.com";

const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

const ownDomain = (domain: string) => {
  const d = domain.toLowerCase();
  return d === OWN_DOMAIN || d.endsWith(`.${OWN_DOMAIN}`);
};

/** A deliverable-looking address that isn't the site's own. */
export function isAddress(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 254 || !ADDRESS.test(v)) return false;
  return !ownDomain(v.slice(v.lastIndexOf("@") + 1));
}

/* ---------- reply address ---------- */

// Mailbox providers people mistype. Exact matches are left alone; near misses get a "did you mean".
const PROVIDERS = [
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de", "ymail.com",
  "hotmail.com", "hotmail.co.uk", "hotmail.fr", "hotmail.de", "hotmail.it", "outlook.com",
  "outlook.com.tr", "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "protonmail.com", "proton.me", "pm.me", "gmx.com", "gmx.de", "gmx.net", "web.de", "mail.com",
  "yandex.com", "yandex.ru", "yandex.com.tr", "mail.ru", "zoho.com", "fastmail.com", "hey.com",
  "tutanota.com", "qq.com", "163.com", "comcast.net", "att.net", "verizon.net",
];
const KNOWN = new Set(PROVIDERS);
// Endings no registry hands out, only a slipped finger on .com/.net/.org.
const TLD_FIX: Record<string, string> = {
  con: "com", cmo: "com", ocm: "com", comm: "com", coom: "com", vom: "com", xom: "com", cpm: "com",
  cim: "com", c0m: "com", nte: "net", nett: "net", ogr: "org", rog: "org", orgg: "org",
};
// "gmail" with nothing after it.
const BARE: Record<string, string> = Object.fromEntries(
  PROVIDERS.filter((d) => d.endsWith(".com")).map((d) => [d.slice(0, -4), d]),
);

/** Optimal string alignment distance: an adjacent swap counts as one edit. */
function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** The domain the visitor most likely meant, or undefined when it looks right. */
export function fixDomain(domain: string): string | undefined {
  const d = domain.toLowerCase();
  if (KNOWN.has(d)) return;
  if (!d.includes(".")) return BARE[d];
  let best = "";
  let min = Infinity;
  for (const p of PROVIDERS) {
    const n = distance(d, p);
    if (n < min) [best, min] = [p, n];
  }
  // Short domains sit close to real ones (mail.com, me.com), so they get one edit, not two.
  if (min <= (d.length < 9 ? 1 : 2)) return best;
  const dot = d.lastIndexOf(".");
  const tld = TLD_FIX[d.slice(dot + 1)];
  if (tld) return `${d.slice(0, dot)}.${tld}`;
}

export interface Found {
  /** As typed, domain lowercased. */
  address: string;
  /** The likely intended address, when the typed one looks mistyped or has no ending. */
  suggestion?: string;
}

const TLD = "com|net|org|io|dev|me|co|edu|gov|info|biz|app|ai|tr|uk|de|fr|it|es|nl|ru|us|ca|au|in";
const LABEL = "[A-Za-z0-9-]+";
// "john [at] gmail [dot] com", "john(at)gmail(dot)com".
const BRACKET_AT = /\s*[[({<]\s*(?:at|@)\s*[\])}>]\s*/gi;
const BRACKET_DOT = /\s*[[({<]\s*(?:dot|\.)\s*[\])}>]\s*/gi;
// "john at gmail dot com": a spoken "at" only before a domain that ends like one.
const SPOKEN_AT = new RegExp(`([A-Za-z0-9_%+-]+)\\s+at\\s+(?=${LABEL}(?:\\s+dot\\s+${LABEL})*\\s+dot\\s+(?:${TLD})\\b)`, "gi");
// "work at acme dot com" is a workplace, not "work@acme.com".
const NOT_LOCAL = new Set(
  "work works working worked me us him her them reach find email mail contact write look is are am be i we you it that this someone anyone here there available based".split(" "),
);
const SPOKEN_DOTS = new RegExp(`(${"[A-Za-z0-9_%+-]+"}(?:\\s+dot\\s+[A-Za-z0-9_%+-]+)*)@(${LABEL}(?:\\s+dot\\s+${LABEL})+)`, "gi");
const CANDIDATE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*/g;

function unmask(text: string) {
  return text
    .replace(BRACKET_AT, "@")
    .replace(BRACKET_DOT, ".")
    .replace(SPOKEN_AT, (all, word: string) => (NOT_LOCAL.has(word.toLowerCase()) ? all : `${word}@`))
    .replace(SPOKEN_DOTS, (_, local: string, domain: string) => `${local}@${domain}`.replace(/\s+dot\s+/gi, "."));
}

/** The last reply address in the text: the latest one typed wins, the site's own never does. */
export function findAddress(text: string): Found | undefined {
  let found: Found | undefined;
  for (const [raw] of unmask(text).matchAll(CANDIDATE)) {
    const m = raw.replace(/^[.'-]+|[.'-]+$/g, "");
    const at = m.lastIndexOf("@");
    const local = m.slice(0, at);
    const domain = m.slice(at + 1).toLowerCase();
    if (!local || ownDomain(domain)) continue;
    const address = `${local}@${domain}`;
    const fix = fixDomain(domain);
    const suggestion = fix && `${local}@${fix}`;
    if (suggestion && isAddress(suggestion)) found = { address, suggestion };
    else if (isAddress(address)) found = { address };
  }
  return found;
}

/* ---------- name and company ---------- */

export interface Who {
  name?: string;
  company?: string;
}

const set = (s: string) => new Set(s.trim().split(/\s+/));
// Words after "I'm" or "this is" that aren't a name.
const NOT_NAME = set(`
  a an the and or but so to of in on at by for from with as not just also really very sure glad
  happy here there back new now still currently looking interested writing reaching contacting
  working hiring trying wondering curious hoping calling messaging emailing based located available
  good fine great ok okay well sorry excited impressed i im i'm i’m i'd i'll i've me my your you we
  we're our us it it's its this that that's hi hello hey thanks thank about regarding recruiter
  developer engineer designer founder manager student freelancer hr cto ceo cofounder tomorrow today
  tonight later anytime maybe when if please asap soon monday tuesday wednesday thursday friday
  saturday sunday ve ben bir merhaba selam`);
// "Jane from London": a place, not an employer.
const PLACES = set(`
  turkey türkiye istanbul i̇stanbul ankara izmir bursa antalya london berlin germany uk usa us
  america canada amsterdam netherlands dubai paris france europe
  abroad home`);
const NOT_COMPANY = set(`
  a an the my our your this that home work night moment remote remotely school university college
  company startup agency team myself yourself free fun money clients people`);
const SUFFIX = /^(?:inc|ltd|co|corp|llc|gmbh|plc|a\.ş|b\.v|s\.a|ag|sa)\.?$/i;

const WORD = "[\\p{L}][\\p{L}'’.-]*";
const NAME = `(${WORD}(?:[ \\t]+${WORD}){0,2})`;
const COMPANY = `([\\p{L}\\d][\\p{L}\\d&'’.,-]*(?:[ \\t]+[\\p{L}\\d&][\\p{L}\\d&'’.,-]*){0,3})`;
// d: the name's own span, to read the company right after it.
const re = (s: string, flags = "giu") => new RegExp(s, flags);

// Said outright: case doesn't matter ("my name is jane").
const EXPLICIT = [
  `\\bmy name(?:['’]s| is)`, `(?:^|[.!?,]\\s*)name(?:['’]s| is)`, `\\b(?:you can|just|friends) call me`,
  `\\bbenim (?:adım|ismim)`, `(?:^|[.!?,]\\s*)(?:adım|ismim)`, `\\bme llamo`, `\\bje m['’]appelle`,
  `\\bmein name ist`, `\\bich hei(?:ß|ss)e`,
].map((lead) => re(`${lead}[ \\t]+${NAME}`, "dgiu"));
// Said in passing: only a capitalised name counts ("I'm Jane", not "I'm interested").
const CASUAL = [
  ...[`\\bI['’]?m`, `\\bI am`, `\\b(?:this|it)(?: is|['’]s)`, `\\bhere(?: is|['’]s)`].map((lead) =>
    re(`${lead}[ \\t]+${NAME}`, "dgiu"),
  ),
  // "Jane here" opening a line.
  re(`(?:^|\\n)[ \\t]*${NAME}[ \\t]+here\\b`, "dgiu"),
  // Turkish "Merhaba, ben Zeynep": lowercase "ben" only, so "Ben Smith" stays a name.
  re(`(?:^|[.!?,][ \\t]*)ben[ \\t]+${NAME}`, "dgu"),
];
// A sign-off near the end: "Thanks,\nJane Doe\nCTO, Acme", "Best, Jane", "— Jane". Needs the comma
// or line break: "thanks Amir" thanks Amir.
const SIGNOFF = re(
  `(?:(?:thanks|thank you|cheers|best|regards|best regards|kind regards|warm regards|br|sincerely|teşekkürler|saygılarımla|iyi çalışmalar)[ \\t]*(?:[,.!][ \\t]*\\n?|\\n)|(?:^|\\n)[ \\t]*(?:--|-)|[ \\t\\n](?:—|–))[ \\t]*${NAME}[ \\t]*[.!]?(?:\\n[^\\n]*){0,2}\\s*$`,
  "dgiu",
);
// The company right after a name: "Jane from Acme", "Jane here from Acme", "Jane @ Acme".
const AFTER_NAME = re(`^[ \\t]+(?:here[ \\t]+)?(?:from|at|with|@)[ \\t]+${COMPANY}`, "iu");
// Where they work, said anywhere. Strict ones need a capital: "we're building" is no company.
const WORKPLACE: [RegExp, boolean][] = [
  [`\\b(?:work|working|works)[ \\t]+(?:at|for|with)`, false],
  [`\\b(?:recruiter|engineer|developer|designer|founder|co-?founder|cto|ceo|manager|lead|director|hr|talent partner|talent acquisition|head of [\\p{L} ]+?)[ \\t]+(?:at|with|from|for|@)`, false],
  [`\\bon behalf of`, false],
  [`\\bwe(?:['’]re| are)`, true],
  [`\\bI['’]?m[ \\t]+with`, true],
].map(([lead, strict]) => [re(`${lead}[ \\t]+${COMPANY}`), strict as boolean]);
// Turkish "Getir'de çalışıyorum", "Trendyol şirketinde".
const WORKPLACE_TR = re(`(\\p{Lu}[\\p{L}\\d&.-]*(?:[ \\t]+\\p{Lu}[\\p{L}\\d&.-]*){0,2})(?:['’](?:de|da|te|ta)[ \\t]+çalış\\p{L}*|[ \\t]+şirketinde)`, "u");

const isCap = (w: string) => /^\p{Lu}/u.test(w);
const title = (w: string) => w.charAt(0).toLocaleUpperCase("en-US") + w.slice(1);
const notName = (w: string) => NOT_NAME.has(w.toLowerCase()) || NOT_NAME.has(w.toLocaleLowerCase("tr"));

/** The name words up to the first that isn't one, and how much of `raw` they took. */
function nameOf(raw: string, casual: boolean): [string, number] | undefined {
  const words: string[] = [];
  let used = 0;
  for (const part of raw.split(/(?=[ \t])/)) {
    const w = part.trimStart();
    const clean = w.replace(/[.'’-]+$/, "");
    if (!clean || notName(clean) || /['’]s$/i.test(clean)) break;
    // Casual names are capitalised; an explicit all-lowercase one ("my name is jane doe") is fine.
    if ((casual || (words.length && isCap(words[0]))) && !isCap(clean)) break;
    words.push(clean);
    used += part.length - (w.length - clean.length);
    if (w !== clean) break;
  }
  if (!words.length || words.join(" ").length > 60) return;
  // ALL CAPS and all lowercase get title case; anything else stays as typed (McAdams, de Vries).
  const name = words.map((w) => (w === w.toLowerCase() || w === w.toUpperCase() ? title(w.toLowerCase()) : w)).join(" ");
  return [name, used];
}

function companyOf(raw: string, strict: boolean): string | undefined {
  const words: string[] = [];
  for (const w of raw.split(/[ \t]+/)) {
    const suffix = words.length > 0 && SUFFIX.test(w.replace(/,$/, ""));
    const clean = suffix ? w.replace(/,$/, "") : w.replace(/[.,'’-]+$/, "");
    const lower = clean.toLowerCase();
    if (!clean) break;
    if (!words.length) {
      if (NOT_COMPANY.has(lower) || PLACES.has(lower) || notName(clean)) break;
      if (strict && !isCap(clean) && !/^\d/.test(clean)) break;
    } else if (!suffix && clean !== "&" && ((!isCap(clean) && !/^\d/.test(clean)) || notName(clean))) break;
    words.push(clean);
    // A suffix or a full stop/comma ends the name.
    if (suffix || clean !== w) break;
  }
  while (words.at(-1) === "&") words.pop();
  const c = words.join(" ");
  return c && c.length <= 60 ? c : undefined;
}

const HOST = /^amir\b/i;

/** Who is writing, as far as the text says; the chat confirms it before using it. */
export function findWho(text: string): Who {
  const who: Who = {};
  const tries: [RegExp[], boolean][] = [[EXPLICIT, false], [CASUAL, true], [[SIGNOFF], true]];
  search: for (const [patterns, casual] of tries) {
    for (const p of patterns) {
      for (const m of text.matchAll(p)) {
        const found = nameOf(m[1], casual);
        // Visitors address Amir by name ("this is Amir's site", "Thanks, Amir"); he isn't them.
        if (!found || (casual && HOST.test(found[0]))) continue;
        who.name = found[0];
        const end = m.indices![1][0] + found[1];
        const after = AFTER_NAME.exec(text.slice(end));
        if (after) who.company = companyOf(after[1], false);
        break search;
      }
    }
  }
  if (!who.company) {
    search: for (const [p, strict] of WORKPLACE) {
      for (const m of text.matchAll(p)) {
        const c = companyOf(m[1], strict);
        if (c) {
          who.company = c;
          break search;
        }
      }
    }
  }
  const tr = who.company ? undefined : WORKPLACE_TR.exec(text)?.[1];
  if (tr) who.company = tr;
  return who;
}

/* ---------- topic ---------- */

export type Topic = "job" | "project";

// Whole words, Unicode-aware: \b only knows ASCII.
const words = (s: string, flags = "giu") => re(`(?:^|[^\\p{L}\\d])(?:${s})(?=$|[^\\p{L}\\d])`, flags);
const CUES: Record<Topic, RegExp> = {
  job: words(
    "hiring|hire you|recruit\\p{L}*|roles?|positions?|vacanc\\p{L}*|jobs?|openings?|full[- ]time|" +
      "part[- ]time|salary|compensation|interview\\p{L}*|cv|resume|résumé|headhunt\\p{L}*|talent|" +
      "candidate\\p{L}*|join (?:our|the) team|team is (?:growing|looking)|relocat\\p{L}*|offer letter|" +
      "iş ilanı|pozisyon\\p{L}*|işe alım|mülakat|maaş|kariyer|aday\\p{L}*",
  ),
  project: words(
    "projects?|freelanc\\p{L}*|contract work|build (?:me|us|a|an)|website|web site|landing page|" +
      "web app|mobile app|e-?commerce|online (?:shop|store)|mvp|prototype|quote|estimate|budget|" +
      "deadline|redesign|consult\\p{L}*|proje\\p{L}*|teklif|bütçe|uygulama|web sitesi",
  ),
};

/** Job or project, when the text leans clearly one way. */
export function findTopic(text: string): Topic | undefined {
  const job = [...text.matchAll(CUES.job)].length;
  const project = [...text.matchAll(CUES.project)].length;
  if (job > project) return "job";
  if (project > job) return "project";
}

/* ---------- contacts ---------- */

export interface Contacts {
  phones: string[];
  linkedin: string[];
  github: string[];
}

// 9-15 digits, maybe a leading + or 00, with spaces, dots, dashes or brackets between; not glued
// to a word ("TR33 0006..." is an IBAN).
const PHONE = /(^|[^\w+])((?:\+|00)?\(?\d[\d \t().-]{7,22}\d)(?![\w])/g;
const DATE = /^\d{4}[-./]\d{1,2}[-./]\d{1,2}|^\d{1,2}[-./]\d{1,2}[-./]\d{4}/;
const LINKEDIN = /\b(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|company)\/[\w%-]+\/?/gi;
const GITHUB = /\b(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9-]{1,39}(?:\/[\w.-]+)?\/?/gi;

const unique = (xs: string[]) => [...new Set(xs)];
const https = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`).replace(/[./]+$/, "");

/** Phones and LinkedIn/GitHub profiles in the text, for the e-mail's footer. */
export function findContacts(text: string): Contacts {
  const phones = [...text.matchAll(PHONE)]
    .map((m) => m[2].trim())
    .filter((p) => {
      const digits = p.replace(/\D/g, "").length;
      return digits >= 9 && digits <= 15 && !DATE.test(p);
    });
  return {
    phones: unique(phones),
    linkedin: unique([...text.matchAll(LINKEDIN)].map(([u]) => https(u))),
    github: unique([...text.matchAll(GITHUB)].map(([u]) => https(u))),
  };
}

/* ---------- spam ---------- */

const LINK = /\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|net|org|io|xyz|top|ru|info|biz|online|site|shop|click|link)\/\S*/gi;
// Spam on its own.
const STRONG = words(
  "backlinks?|guest posts?|link building|first page of google|rank(?:ing)? (?:your|on) (?:website|google)|" +
    "casino|viagra|cialis|payday loans?|binary options|lottery|onlyfans|escort|bahis|kumar|" +
    "crypto investment|investment opportunity|guaranteed (?:returns?|profits?)|earn \\$\\d+",
  "iu",
);
// Spam when two turn up, or one with a link: a real client may well ask about SEO.
const WEAK = words(
  "seo|crypto\\p{L}*|bitcoin|btc|usdt|forex|trading|whatsapp|telegram|click here|limited time|act now|" +
    "100% free|make money|passive income|traffic|dm me|special offer|discount|per month",
);

/** Spam signs: more than two links, a telltale phrase, or two weaker ones (a link counts). */
export function isSpam(text: string): boolean {
  const links = [...text.matchAll(LINK)].length;
  if (links > 2 || STRONG.test(text)) return true;
  const weak = new Set([...text.matchAll(WEAK)].map((m) => m[0].trim().toLowerCase())).size;
  return weak + Math.min(links, 1) >= 2;
}

/* ---------- coalescing ---------- */

/** Lines this close together go out as one e-mail. */
export const QUIET_MS = 15_000;
/** A visitor who never pauses still gets mailed this long after their first unsent line. */
export const MAX_WAIT_MS = 60_000;

/** When the pending lines (oldest first, epoch ms) should go out. */
export function sendAt(pending: readonly { at: number }[]): number | undefined {
  if (!pending.length) return;
  return Math.min(pending.at(-1)!.at + QUIET_MS, pending[0].at + MAX_WAIT_MS);
}
