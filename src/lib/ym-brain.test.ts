import { describe, expect, it } from "vitest";
import ym from "../data/ym.json";
import { blank, bounced, respond, yesNo, type Profile, type Reply } from "./ym-brain";

/** A visitor typing lines in one visit; each question Amir asks is on screen before the next line. */
function visit(...lines: string[]) {
  let profile = blank();
  let mailed = "";
  const replies: Reply[] = [];
  for (const text of lines) {
    const r = respond(profile, text, { first: !mailed, earlier: mailed });
    if (r.mail) mailed += `${text}\n`;
    profile = r.profile;
    if (profile.open) profile.open.shown = true;
    replies.push(r);
  }
  return { profile, replies, said: (i: number) => replies[i].say.map((s) => s.text), last: replies.at(-1)! };
}

describe("yesNo", () => {
  it.each([
    ["yes", true, ""],
    ["Yep, that's me", true, "that's me"],
    ["that's right!", true, ""],
    ["ok", true, ""],
    ["👍", true, ""],
    ["evet", true, ""],
    ["no, it's janet", false, "it's janet"],
    ["Nope.", false, ""],
    ["not quite: jane@acme.io", false, "jane@acme.io"],
    ["hayır", false, ""],
  ])("%s", (text, yes, rest) => {
    expect(yesNo(text)).toEqual({ yes, rest });
  });

  it.each(["nobody told me", "yesterday works", "okayish", "notably", "Yasmin here"])("%s is neither", (text) => {
    expect(yesNo(text).yes).toBeUndefined();
  });
});

describe("respond", () => {
  it("thanks the first line of a visit and asks for an address", () => {
    const v = visit("hi there, love the site");
    expect(v.said(0)).toEqual(["thanks! that's on its way to my inbox ✉", "what's your e-mail, so I can write back?"]);
    expect(v.last.mail).toBe(true);
    expect(v.profile.open?.kind).toBe("ask-address");
  });

  it("takes an address given as the answer, and keeps the answer out of the e-mail", () => {
    const v = visit("hello", "jane@acme.com");
    expect(v.profile.reply).toBe("jane@acme.com");
    expect(v.said(1)).toEqual(["got it, I'll write back to jane@acme.com ✓"]);
    expect(v.last.mail).toBe(false);
  });

  it("asks about a typo, then takes yes as the suggestion and no as typed", () => {
    expect(visit("hello", "jane@gmial.com").said(1)).toEqual(["quick check: did you mean jane@gmail.com?"]);
    expect(visit("hello", "jane@gmial.com", "yes").profile.reply).toBe("jane@gmail.com");
    expect(visit("hello", "jane@gmial.com", "no").profile.reply).toBe("jane@gmial.com");
    expect(visit("hello", "jane@gmial.com", "oops, jane@hotmail.com").profile.reply).toBe("jane@hotmail.com");
  });

  it("keeps no reply address when 'no' keeps a typo the Worker would refuse", () => {
    const v = visit("reach me at jane@gmail", "no");
    expect(v.profile.reply).toBeUndefined();
  });

  it("confirms an address found in a message, then the name, one question at a time", () => {
    const v = visit("Hi, I'm Jane from Acme. reach me at jane@acme.com");
    expect(v.said(0)).toEqual(["thanks! that's on its way to my inbox ✉", "should I write back to jane@acme.com?"]);
    const v2 = visit("Hi, I'm Jane from Acme. reach me at jane@acme.com", "yep");
    expect(v2.profile.reply).toBe("jane@acme.com");
    expect(v2.said(1)).toEqual(["got it, I'll write back to jane@acme.com ✓", "nice to meet you! you're Jane from Acme, right?"]);
    const v3 = visit("Hi, I'm Jane from Acme. reach me at jane@acme.com", "yep", "yes");
    expect(v3.profile).toMatchObject({ name: "Jane", company: "Acme", open: undefined });
    expect(v3.said(2)).toEqual(["nice to meet you, Jane 👋"]);
  });

  it("takes a corrected name", () => {
    const v = visit("I'm Jane, jane@acme.com", "yes", "no, it's janet");
    expect(v.profile.name).toBe("Janet");
    expect(v.last.mail).toBe(false);
  });

  it("asks for the name after a plain no, and takes it bare", () => {
    const v = visit("Thanks, Jane", "no");
    expect(v.said(1)).toEqual(["sorry! what should I call you?"]);
    expect(visit("Thanks, Jane", "no", "Sam").profile.name).toBe("Sam");
    expect(visit("Thanks, Jane", "no", "lol").profile.name).toBeUndefined();
  });

  it("asks for the right address after a no", () => {
    const v = visit("write to jane@acme.com", "no");
    expect(v.said(1)).toEqual(["oops. what's the right address?"]);
    expect(visit("write to jane@acme.com", "no", "jane@work.io").profile.reply).toBe("jane@work.io");
  });

  it("e-mails an answer that says more", () => {
    const v = visit("hi! jane@acme.com", "yes, and we'd love to talk about a frontend role next week");
    expect(v.profile.reply).toBe("jane@acme.com");
    expect(v.last.mail).toBe(true);
  });

  it("drops the question on an unrelated line and never asks it again", () => {
    const v = visit("hello", "do you do freelance work?", "how about next month?");
    expect(v.replies[1].mail).toBe(true);
    expect(v.profile.reply).toBeUndefined();
    expect(v.replies.flatMap((r) => r.say.map((s) => s.text)).filter((t) => t.includes("your e-mail"))).toHaveLength(1);
  });

  it("accepts a decline", () => {
    expect(visit("hello", "rather not").said(1)).toEqual(["no problem 👍"]);
  });

  it("says the topic's line once", () => {
    const v = visit("we're hiring for a senior frontend role", "the salary is flexible");
    expect(v.profile.topic).toBe("job");
    expect(v.said(0)).toContain(ym.topics.job);
    expect(v.said(1)).not.toContain(ym.topics.job);
  });

  it("reads a line typed before the question showed up as a message", () => {
    let p: Profile = blank();
    const a = respond(p, "hello", { first: true, earlier: "" });
    p = a.profile; // the question is still being typed
    const b = respond(p, "yes", { first: false, earlier: "hello" });
    expect(b.mail).toBe(true);
    expect(b.say).toEqual([]);
    expect(b.profile.open?.kind).toBe("ask-address");
  });

  it("asks before switching to a new address", () => {
    const v = visit("jane@acme.com", "yes", "actually use jane@work.io");
    expect(v.said(2)).toEqual(["should I write back to jane@work.io instead of jane@acme.com?"]);
  });

  it("skips a waiting question an answer already settled", () => {
    const v = visit("I'm Jane, write to jane@acme.com", "no, I'm Jane Doe and it's jane.doe@acme.com");
    expect(v.profile.reply).toBe("jane.doe@acme.com");
    expect(v.profile.open?.kind).toBe("who");
  });
});

describe("bounced", () => {
  it("asks once whether the address is right", () => {
    const p = { ...blank(), reply: "jane@acme.con" };
    const r = bounced(p, "jane@acme.con");
    expect(r.say.map((s) => s.text)).toEqual(["hmm, acme.con doesn't seem to take e-mail. is jane@acme.con right?"]);
    expect(bounced(r.profile, "jane@acme.con").say).toEqual([]);
  });
});
