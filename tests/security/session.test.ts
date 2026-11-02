import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "@/app/api/session/route";
import { middleware } from "@/middleware";
import { _resetRateLimit } from "@/lib/server/auth-roles";

const TOKEN = "s".repeat(24);
const url = "http://localhost:3000/api/session";
const H = { host: "localhost:3000", "content-type": "application/json" };
const post = (token: string, ip = "1.1.1.1") =>
  POST(new NextRequest(url, { method: "POST", headers: { ...H, "x-forwarded-for": ip }, body: JSON.stringify({ token }) }));

describe("جلسة HttpOnly بدل localStorage (M3)", () => {
  const saved = process.env.MONTAGE_API_TOKEN;
  beforeEach(() => {
    process.env.MONTAGE_API_TOKEN = TOKEN;
    _resetRateLimit();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.MONTAGE_API_TOKEN; else process.env.MONTAGE_API_TOKEN = saved;
    _resetRateLimit();
  });

  it("رمز صحيح ⇒ كوكي HttpOnly + SameSite=Strict، والرمز لا يعود في الجسم", async () => {
    const res = await post(TOKEN);
    expect(res.status).toBe(200);
    const c = res.headers.get("set-cookie") || "";
    expect(c).toMatch(/^montage_token=/);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(JSON.stringify(await res.json())).not.toContain(TOKEN);
  });

  it("رمز خاطئ ⇒ 401 بلا كوكي", async () => {
    const res = await post("x".repeat(24));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("حد المحاولات ⇒ 429", async () => {
    for (let i = 0; i < 10; i++) await post("y".repeat(24), "9.9.9.9");
    expect((await post(TOKEN, "9.9.9.9")).status).toBe(429);
  });

  it("الكوكي يمرّ middleware، و/api/session متاح بلا رمز، والأصل الأجنبي مرفوض", () => {
    const api = (path: string, headers: Record<string, string> = {}) =>
      middleware(new NextRequest(`http://localhost:3000${path}`, { headers: { host: "localhost:3000", ...headers } }));
    expect(api("/api/budget").status).toBe(401);
    expect(api("/api/budget", { cookie: `montage_token=${TOKEN}` }).status).toBe(200);
    expect(api("/api/session").status).toBe(200);
    expect(api("/api/session", { origin: "https://evil.example" }).status).toBe(403);
  });

  it("GET يعكس الحالة، وDELETE يمسح الكوكي", async () => {
    const anon = await (await GET(new NextRequest(url, { headers: H }))).json();
    expect(anon).toEqual({ required: true, authenticated: false, role: null });
    const authed = await (await GET(new NextRequest(url, { headers: { ...H, cookie: `montage_token=${TOKEN}` } }))).json();
    expect(authed).toMatchObject({ required: true, authenticated: true, role: "admin" });
    const del = await DELETE(new NextRequest(url, { method: "DELETE", headers: H }));
    expect(del.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
