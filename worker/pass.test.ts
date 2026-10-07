import { describe, expect, it } from "vitest";
import { COOKIE, LIFETIME, mint, verify } from "./pass";

describe("pass", () => {
  const SECRET = "s3cret";
  const withCookie = (cookie: string) => new Request("https://x/", { headers: { Cookie: cookie } });
  const valueOf = (setCookie: string) => setCookie.split(";")[0];

  it("mints a host-only, script-proof cookie that verifies", async () => {
    const set = await mint(SECRET);
    expect(set).toMatch(new RegExp(`^${COOKIE}=`));
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Secure");
    expect(set).toContain("SameSite=Strict");
    expect(set).toContain("Path=/");
    expect(await verify(withCookie(`a=1; ${valueOf(set)}`), SECRET)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("rejects a pass signed with another secret", async () => {
    expect(await verify(withCookie(valueOf(await mint("other"))), SECRET)).toBeNull();
  });

  it("rejects a tampered id", async () => {
    const v = valueOf(await mint(SECRET));
    const i = COOKIE.length + 1;
    const tampered = v.slice(0, i) + (v[i] === "A" ? "B" : "A") + v.slice(i + 1);
    expect(await verify(withCookie(tampered), SECRET)).toBeNull();
  });

  it("rejects an expired pass", async () => {
    const now = Date.now();
    const v = valueOf(await mint(SECRET, now));
    expect(await verify(withCookie(v), SECRET, now + (LIFETIME - 1) * 1000)).not.toBeNull();
    expect(await verify(withCookie(v), SECRET, now + LIFETIME * 1000)).toBeNull();
  });

  it("rejects a pass dated too far ahead", async () => {
    const now = Date.now();
    const v = valueOf(await mint(SECRET, now + 3600_000));
    expect(await verify(withCookie(v), SECRET, now)).toBeNull();
  });

  it("rejects a missing or malformed cookie", async () => {
    expect(await verify(new Request("https://x/"), SECRET)).toBeNull();
    expect(await verify(withCookie(`${COOKIE}=junk`), SECRET)).toBeNull();
  });
});
