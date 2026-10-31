import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/server/auth";
import { _resetRateLimit, isAllowed, parseTokens, rateLimit } from "@/lib/server/auth-roles";
import { middleware } from "@/middleware";

const ADMIN = "a".repeat(20), EDITOR = "e".repeat(20), VIEWER = "v".repeat(20);
const TOKENS = `${ADMIN}:admin,${EDITOR}:editor,${VIEWER}:viewer`;
const H = (t: string | null) => ({ authorization: t ? `Bearer ${t}` : null, xToken: null, cookie: null });

describe("T-04 roles", () => {
  it("parses roles; rejects bad role / short token as config error (503, never accepted)", () => {
    expect(parseTokens(TOKENS, undefined).entries.map((e) => e.role)).toEqual(["admin", "editor", "viewer"]);
    expect(parseTokens("x".repeat(20) + ":root", undefined).errors.length).toBe(1);
    expect(checkAuth(H("short"), { tokens: "short:admin" })).toMatchObject({ ok: false, status: 503 });
  });
  it("token → role; unknown → 401; legacy single token = admin", () => {
    expect(checkAuth(H(VIEWER), { tokens: TOKENS })).toMatchObject({ ok: true, role: "viewer" });
    expect(checkAuth(H(EDITOR), { tokens: TOKENS })).toMatchObject({ ok: true, role: "editor" });
    expect(checkAuth(H("z".repeat(20)), { tokens: TOKENS })).toMatchObject({ ok: false, status: 401 });
    expect(checkAuth(H(ADMIN), { token: ADMIN })).toMatchObject({ ok: true, role: "admin" });
  });
  it("permission matrix", () => {
    expect(isAllowed("viewer", "GET", "/api/projects")).toBe(true);
    expect(isAllowed("viewer", "POST", "/api/export")).toBe(false);
    expect(isAllowed("editor", "POST", "/api/export")).toBe(true);
    expect(isAllowed("editor", "POST", "/api/extensions/skills/x")).toBe(false);
    expect(isAllowed("editor", "DELETE", "/api/extensions/skills/x")).toBe(false);
    expect(isAllowed("editor", "GET", "/api/extensions")).toBe(true);
    expect(isAllowed("admin", "DELETE", "/api/extensions/skills/x")).toBe(true);
  });
  it("rate limit: window per key, resets after 60s", () => {
    _resetRateLimit();
    expect([1, 2, 3, 4].map(() => rateLimit("k", 3, 1000))).toEqual([true, true, true, false]);
    expect(rateLimit("other", 3, 1000)).toBe(true);
    expect(rateLimit("k", 3, 62_000)).toBe(true);
    expect(rateLimit("k", 0, 1000)).toBe(true); // 0 = بلا حد
  });
});

describe("T-04 middleware", () => {
  const saved = { t: process.env.MONTAGE_API_TOKEN, ts: process.env.MONTAGE_API_TOKENS, r: process.env.MONTAGE_RATE_LIMIT_PER_MIN };
  beforeEach(() => { delete process.env.MONTAGE_API_TOKEN; process.env.MONTAGE_API_TOKENS = TOKENS; _resetRateLimit(); });
  afterEach(() => {
    for (const [k, v] of [["MONTAGE_API_TOKEN", saved.t], ["MONTAGE_API_TOKENS", saved.ts], ["MONTAGE_RATE_LIMIT_PER_MIN", saved.r]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  const req = (method: string, p: string, token: string) => new NextRequest(`http://localhost:3000${p}`, { method, headers: { host: "localhost:3000", authorization: `Bearer ${token}` } });

  it("viewer can read but not write; editor cannot manage extensions; admin can", () => {
    expect(middleware(req("GET", "/api/budget", VIEWER)).status).toBe(200);
    expect(middleware(req("POST", "/api/export", VIEWER)).status).toBe(403);
    expect(middleware(req("POST", "/api/export", EDITOR)).status).toBe(200);
    expect(middleware(req("POST", "/api/extensions/skills/x", EDITOR)).status).toBe(403);
    expect(middleware(req("POST", "/api/extensions/skills/x", ADMIN)).status).toBe(200);
  });
  it("429 after the per-token limit", () => {
    process.env.MONTAGE_RATE_LIMIT_PER_MIN = "2";
    const s = [1, 2, 3].map(() => middleware(req("GET", "/api/budget", VIEWER)).status);
    expect(s).toEqual([200, 200, 429]);
    expect(middleware(req("GET", "/api/budget", ADMIN)).status).toBe(200); // مفتاح آخر
  });
});
