import { describe, expect, it, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { checkAuth, safeEqual } from "@/lib/server/auth";
import { middleware } from "@/middleware";

const H = (authorization: string | null = null, xToken: string | null = null, cookie: string | null = null) => ({ authorization, xToken, cookie });
const TOKEN = "t".repeat(24);

describe("checkAuth (S-AUTH)", () => {
  it("allows local default (no token, no remote hosts)", () => {
    expect(checkAuth(H(), {}).ok).toBe(true);
  });
  it("requires the token when configured — Bearer, x-montage-token, or cookie", () => {
    const env = { token: TOKEN };
    expect(checkAuth(H(), env)).toMatchObject({ ok: false, status: 401 });
    expect(checkAuth(H("Bearer wrong-wrong-wrong-wrong"), env)).toMatchObject({ ok: false, status: 401 });
    expect(checkAuth(H(`Bearer ${TOKEN}`), env).ok).toBe(true);
    expect(checkAuth(H(null, TOKEN), env).ok).toBe(true);
    expect(checkAuth(H(null, null, `a=b; montage_token=${TOKEN}`), env).ok).toBe(true);
  });
  it("fails closed for remote hosts without a token", () => {
    expect(checkAuth(H(), { remoteHosts: "studio.example.com" })).toMatchObject({ ok: false, status: 503 });
    expect(checkAuth(H(`Bearer ${TOKEN}`), { remoteHosts: "studio.example.com", token: TOKEN }).ok).toBe(true);
  });
  it("rejects a weak token as a configuration error (never accepts it)", () => {
    expect(checkAuth(H("Bearer short"), { token: "short" })).toMatchObject({ ok: false, status: 503 });
  });
  it("safeEqual is exact", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("middleware enforces auth + host guard", () => {
  const saved = { t: process.env.MONTAGE_API_TOKEN, h: process.env.MONTAGE_ALLOWED_HOSTS };
  afterEach(() => {
    if (saved.t === undefined) delete process.env.MONTAGE_API_TOKEN; else process.env.MONTAGE_API_TOKEN = saved.t;
    if (saved.h === undefined) delete process.env.MONTAGE_ALLOWED_HOSTS; else process.env.MONTAGE_ALLOWED_HOSTS = saved.h;
  });
  const req = (headers: Record<string, string> = {}) => new NextRequest("http://localhost:3000/api/budget", { headers: { host: "localhost:3000", ...headers } });

  it("401 without token, passes with token", () => {
    process.env.MONTAGE_API_TOKEN = TOKEN;
    expect(middleware(req()).status).toBe(401);
    expect(middleware(req({ authorization: `Bearer ${TOKEN}` })).status).toBe(200);
  });
  it("foreign Origin is still rejected even with a valid token (CSRF)", () => {
    process.env.MONTAGE_API_TOKEN = TOKEN;
    expect(middleware(req({ authorization: `Bearer ${TOKEN}`, origin: "https://evil.example" })).status).toBe(403);
  });
  it("remote host without token → 503 (fail closed)", () => {
    delete process.env.MONTAGE_API_TOKEN;
    process.env.MONTAGE_ALLOWED_HOSTS = "studio.example.com";
    expect(middleware(req()).status).toBe(503);
  });
});
