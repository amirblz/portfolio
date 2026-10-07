import { describe, expect, it } from "vitest";
import { findAddress, findContacts, findTopic, findWho, fixDomain, isAddress, isSpam, sendAt } from "./ym-parse";

describe("isAddress", () => {
  it.each(["a@b.co", "first.last+tag@sub.example.org", "o'neil@example.ie"])("accepts %s", (a) => {
    expect(isAddress(a)).toBe(true);
  });

  it.each(["contact@amirbalazade.com", "x@mail.AmirBalazade.com", "a@b", "a b@c.com", "a@-b.com"])("rejects %s", (a) => {
    expect(isAddress(a)).toBe(false);
  });
});

describe("fixDomain", () => {
  it.each([
    ["gmial.com", "gmail.com"],
    ["gamil.com", "gmail.com"],
    ["gmail.con", "gmail.com"],
    ["gmail.co", "gmail.com"],
    ["gmail", "gmail.com"],
    ["hotmal.com", "hotmail.com"],
    ["hotmail.cmo", "hotmail.com"],
    ["outlok.com", "outlook.com"],
    ["yaho.com", "yahoo.com"],
    ["iclod.com", "icloud.com"],
    ["acme.con", "acme.com"],
    ["acme.ogr", "acme.org"],
    ["GMIAL.COM", "gmail.com"],
  ])("%s → %s", (typed, meant) => {
    expect(fixDomain(typed)).toBe(meant);
  });

  it.each(["gmail.com", "mail.com", "me.com", "acme.com", "okan.edu.tr", "acme.co", "web.de", "proton.me", "startup.io"])(
    "leaves %s alone",
    (d) => {
      expect(fixDomain(d)).toBeUndefined();
    },
  );
});

describe("findAddress", () => {
  it.each([
    ["reach me at jane@acme.com", "jane@acme.com"],
    ["mail: <jane.doe@acme.co.uk>.", "jane.doe@acme.co.uk"],
    ["Jane@Acme.COM thanks", "Jane@acme.com"],
    ["jane [at] acme [dot] com", "jane@acme.com"],
    ["jane(at)acme(dot)com", "jane@acme.com"],
    ["jane at acme dot com", "jane@acme.com"],
    ["contact me: john dot doe at gmail dot com", "john.doe@gmail.com"],
    ["old: a@x.com, new: b@y.com", "b@y.com"],
    ["write to contact@amirbalazade.com or me@jane.dev", "me@jane.dev"],
  ])("%s", (text, address) => {
    expect(findAddress(text)).toEqual({ address });
  });

  it("suggests a fix for a typo", () => {
    expect(findAddress("jane@gmial.com")).toEqual({ address: "jane@gmial.com", suggestion: "jane@gmail.com" });
    expect(findAddress("my mail is jane@gmail")).toEqual({ address: "jane@gmail", suggestion: "jane@gmail.com" });
  });

  it.each([
    "I work at acme dot com",
    "meet me at noon",
    "email me at contact@amirbalazade.com",
    "twitter @jane",
    "jane@localhost",
    "no address here",
  ])("finds nothing in %s", (text) => {
    expect(findAddress(text)).toBeUndefined();
  });
});

describe("findWho", () => {
  it.each([
    ["Hi, I'm Jane Doe from Acme Corp. We're hiring", { name: "Jane Doe", company: "Acme Corp." }],
    ["hi! my name is jane doe and i work at acme", { name: "Jane Doe", company: "acme" }],
    ["This is Mehmet from Trendyol, hope you're well", { name: "Mehmet", company: "Trendyol" }],
    ["I’m Ayşe Yılmaz", { name: "Ayşe Yılmaz" }],
    ["Merhaba, benim adım ayşe", { name: "Ayşe" }],
    ["Merhaba, adım Can.", { name: "Can" }],
    ["Jane here from Acme, quick question", { name: "Jane", company: "Acme" }],
    ["Quick question about your work.\nThanks,\nJane Smith", { name: "Jane Smith" }],
    ["love the site! — Jane", { name: "Jane" }],
    ["Best, JANE", { name: "Jane" }],
    ["I'm a recruiter at Google and we're looking for", { company: "Google" }],
    ["I work at Google", { company: "Google" }],
    ["it's Jane from Google", { name: "Jane", company: "Google" }],
    ["Talent partner at Spotify here", { company: "Spotify" }],
    ["I'm with Acme Labs", { company: "Acme Labs" }],
    ["I am Jean-Luc O'Neil, CTO at Acme Inc.", { name: "Jean-Luc O'Neil", company: "Acme Inc." }],
    ["me llamo lucía", { name: "Lucía" }],
    ["you can call me Sam", { name: "Sam" }],
    ["Selam Amir, ben Zeynep, Getir'de çalışıyorum.", { name: "Zeynep", company: "Getir" }],
    ["Best regards,\nMaria Garcia\nHead of Engineering at Acme", { name: "Maria Garcia", company: "Acme" }],
    ["Hello Amir, I am Sarah Connor, Talent Acquisition at Booking.com.", { name: "Sarah Connor", company: "Booking.com" }],
    ["My name is Elon and I'm with SpaceX", { name: "Elon", company: "SpaceX" }],
  ])("%s", (text, who) => {
    expect(findWho(text)).toEqual(who);
  });

  it.each([
    "I'm interested in your work",
    "I'm looking for a developer",
    "i'm jane",
    "This is great work",
    "this is Amir's site right?",
    "thanks Amir",
    "Thanks, Amir!",
    "It's Monday and",
    "call me tomorrow",
    "I'm from London",
    "Jane from London",
    "I'm currently working at home",
    "we're building a shop",
    "I'm with my team",
    "I'm Not Interested, just browsing",
    "Ben Smith said hi",
  ])("finds nobody in %s", (text) => {
    expect(findWho(text)).toEqual({});
  });
});

describe("findTopic", () => {
  it.each([
    ["We're hiring a frontend engineer, full-time role", "job"],
    ["Is your CV up to date? We have an opening", "job"],
    ["Yeni bir pozisyon için mülakat ayarlayabilir miyiz?", "job"],
    ["Can you build me a website? What's your quote?", "project"],
    ["freelance project, budget 5k", "project"],
    ["bir proje için teklif almak istiyorum", "project"],
  ])("%s → %s", (text, topic) => {
    expect(findTopic(text)).toBe(topic);
  });

  it.each(["hey, love the site", "role for a project", "approach to apps"])("leaves %s untagged", (text) => {
    expect(findTopic(text)).toBeUndefined();
  });
});

describe("findContacts", () => {
  it("finds phones in common formats", () => {
    const text = "call +90 532 123 45 67 or (555) 123-4567, office 0212.555.66.77, wa 0090 532 1234567";
    expect(findContacts(text).phones).toEqual(["+90 532 123 45 67", "(555) 123-4567", "0212.555.66.77", "0090 532 1234567"]);
  });

  it.each([
    "on 2026-10-07 at 14:00",
    "budget 50000 usd",
    "IBAN TR33 0006 1005 1978 6457 8413 26",
    "card 4111 1111 1111 1111 1111",
    "version 1.2.3",
  ])("finds no phone in %s", (text) => {
    expect(findContacts(text).phones).toEqual([]);
  });

  it("finds profiles and normalises them", () => {
    const text = "see linkedin.com/in/jane-doe/ and https://www.linkedin.com/in/jane-doe, github.com/janedoe/repo.";
    expect(findContacts(text)).toMatchObject({
      linkedin: ["https://linkedin.com/in/jane-doe", "https://www.linkedin.com/in/jane-doe"],
      github: ["https://github.com/janedoe/repo"],
    });
  });
});

describe("isSpam", () => {
  it.each([
    "We sell high quality backlinks for your site",
    "Get on the first page of Google today",
    "see a.com/x b.com/y http://c.net",
    "SEO and traffic packages, special offer",
    "Grow with SEO: https://cheap.example/x",
    "Bitcoin trading, message on WhatsApp",
  ])("flags %s", (text) => {
    expect(isSpam(text)).toBe(true);
  });

  it.each([
    "Can you help with SEO on my new site?",
    "Hi, I'm Jane, we're hiring. Details: https://acme.com/jobs/1",
    "my portfolio https://jane.dev and github.com/jane",
    "Bet you get a lot of these",
  ])("passes %s", (text) => {
    expect(isSpam(text)).toBe(false);
  });
});

describe("sendAt", () => {
  it("waits for a quiet spell, but no longer than a minute from the first line", () => {
    expect(sendAt([])).toBeUndefined();
    expect(sendAt([{ at: 0 }])).toBe(15_000);
    expect(sendAt([{ at: 0 }, { at: 10_000 }])).toBe(25_000);
    expect(sendAt([{ at: 0 }, { at: 50_000 }])).toBe(60_000);
  });
});
