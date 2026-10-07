import { describe, expect, it } from "vitest";
import { body, isAddress, parse, subject, tooLong, type Message } from "./mail";

const valid = { visitor: "xX_sk8er_ninja_1985_Xx", lines: ["hi there"], first: true, page: "/contact/chat" };

describe("parse", () => {
  it("accepts a minimal message and trims lines", () => {
    expect(parse({ ...valid, lines: ["  hi  "] })).toEqual({ ...valid, lines: ["hi"] });
  });

  it("accepts every optional field", () => {
    const m = { ...valid, name: "Ayşe Yılmaz", company: "Acme", replyTo: "ayse@acme.com.tr", topic: "job" };
    expect(parse(m)).toMatchObject(m);
  });

  it.each([
    ["not an object", null],
    ["visitor with a space", { ...valid, visitor: "a b" }],
    ["visitor too long", { ...valid, visitor: "a".repeat(41) }],
    ["page not a path", { ...valid, page: "https://evil.example" }],
    ["first missing", { ...valid, first: undefined }],
    ["no lines", { ...valid, lines: [] }],
    ["blank line", { ...valid, lines: ["   "] }],
    ["too many lines", { ...valid, lines: Array(21).fill("x") }],
    ["line too long", { ...valid, lines: ["x".repeat(1001)] }],
    ["control char in line", { ...valid, lines: ["a\u0000b"] }],
    ["CR in line", { ...valid, lines: ["a\rb"] }],
    ["CRLF in name", { ...valid, name: "Eve\r\nBcc: x@example.com" }],
    ["LF in company", { ...valid, company: "Acme\nX" }],
    ["line separator in name", { ...valid, name: "Eve\u2028X" }],
    ["name too long", { ...valid, name: "x".repeat(81) }],
    ["reply address with CRLF", { ...valid, replyTo: "a@b.com\r\nBcc: c@d.com" }],
    ["reply address malformed", { ...valid, replyTo: "a@b" }],
    ["unknown topic", { ...valid, topic: "spam" }],
  ])("rejects %s", (_, input) => {
    expect(parse(input)).toBeNull();
  });

  it("allows newlines and tabs inside a line", () => {
    expect(parse({ ...valid, lines: ["a\n\tb"] })?.lines).toEqual(["a\n\tb"]);
  });
});

describe("isAddress", () => {
  it.each(["a@b.co", "first.last+tag@sub.example.org", "o'neil@example.ie"])("accepts %s", (a) => {
    expect(isAddress(a)).toBe(true);
  });

  it.each([
    "contact@amirbalazade.com",
    "CONTACT@AmirBalazade.com",
    "x@mail.amirbalazade.com",
    "no-at.example.com",
    "a@-b.com",
    "a@b.c",
    "a b@c.com",
    `${"a".repeat(65)}@b.com`,
  ])("rejects %s", (a) => {
    expect(isAddress(a)).toBe(false);
  });
});

it("tooLong counts UTF-8 bytes across lines", () => {
  const m = parse({ ...valid, lines: Array(9).fill("ş".repeat(500)) })!;
  expect(tooLong(m)).toBe(true);
  expect(tooLong(parse({ ...valid, lines: Array(8).fill("x".repeat(1000)) })!)).toBe(false);
});

describe("subject", () => {
  const m: Message = { ...valid, name: "Jane", topic: "project" };

  it("tags the first e-mail with topic and name", () => {
    expect(subject(m)).toBe("[Project] Website message from xX_sk8er_ninja_1985_Xx · Jane");
  });

  it("keeps later e-mails to the visitor id", () => {
    expect(subject({ ...m, first: false })).toBe("Website message from xX_sk8er_ninja_1985_Xx");
  });

  it("leaves out what is unknown", () => {
    expect(subject(valid)).toBe("Website message from xX_sk8er_ninja_1985_Xx");
  });

  it("tags spam on any e-mail, without dropping it", () => {
    const spam = { ...m, lines: ["cheap backlinks for your site"] };
    expect(subject(spam)).toBe("[Possible spam] [Project] Website message from xX_sk8er_ninja_1985_Xx · Jane");
    expect(subject({ ...spam, first: false })).toBe("[Possible spam] Website message from xX_sk8er_ninja_1985_Xx");
  });
});

describe("body", () => {
  const now = new Date("2026-10-07T14:03:59Z");

  it("puts the lines first and the details in the footer", () => {
    const m: Message = { ...valid, lines: ["one", "two"], name: "Jane", company: "Acme", replyTo: "j@acme.com" };
    expect(body(m, { now, country: "TR", mx: "ok" })).toBe(
      "one\ntwo\n\n-- \nName: Jane, Acme\nReply to: j@acme.com (mail server found)\n" +
        "Visitor: xX_sk8er_ninja_1985_Xx\nCountry: TR\nTime: 2026-10-07 14:03 UTC\nPage: /contact/chat\n",
    );
  });

  it("warns when the reply domain takes no mail", () => {
    expect(body({ ...valid, replyTo: "j@nomail.example" }, { now, mx: "none" })).toContain(
      "Reply to: j@nomail.example (no mail server found for its domain)",
    );
  });

  it("drops footer lines it has nothing for", () => {
    const text = body(valid, { now });
    expect(text).not.toMatch(/Name:|Reply to:|Country:|Phone:|LinkedIn:|GitHub:/);
  });

  it("lists phones and profiles from the lines", () => {
    const m = { ...valid, lines: ["call +90 532 123 45 67", "linkedin.com/in/jane and github.com/jane"] };
    expect(body(m, { now })).toContain(
      "Phone: +90 532 123 45 67\nLinkedIn: https://linkedin.com/in/jane\nGitHub: https://github.com/jane\nVisitor:",
    );
  });
});
