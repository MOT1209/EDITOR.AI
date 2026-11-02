import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { API_CSP, buildPageCsp, makeNonce } from "@/lib/server/csp";

const page = (path = "/") => middleware(new NextRequest(`http://localhost:3000${path}`, { headers: { host: "localhost:3000" } }));
const scriptSrc = (csp: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) || "";

describe("CSP بـ nonce (T-11)", () => {
  it("سياسة الإنتاج: nonce + strict-dynamic، بلا unsafe-inline ولا unsafe-eval ولا مصادر خارجية للسكربتات", () => {
    const csp = buildPageCsp("abc123==", false);
    const s = scriptSrc(csp);
    expect(s).toBe("script-src 'self' 'nonce-abc123==' 'strict-dynamic'");
    for (const d of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "connect-src 'self' blob: https://huggingface.co"]) {
      expect(csp).toContain(d);
    }
    expect(scriptSrc(buildPageCsp("x", true))).toContain("'unsafe-eval'"); // التطوير فقط
  });

  it("كل صفحة تحمل nonce جديداً في الاستجابة ويُمرَّر لـ Next عبر ترويسة الطلب", () => {
    const a = page("/").headers.get("content-security-policy") || "";
    const b = page("/shorts").headers.get("content-security-policy") || "";
    const na = /'nonce-([^']+)'/.exec(a)?.[1];
    const nb = /'nonce-([^']+)'/.exec(b)?.[1];
    expect(na).toBeTruthy();
    expect(na).not.toBe(nb);
    expect(scriptSrc(a)).not.toContain("unsafe-inline");
    // NextResponse.next({request:{headers}}) يكتب ترويسات الطلب المعدَّلة كـ x-middleware-request-*
    expect(page("/").headers.get("x-middleware-request-x-nonce")).toBeTruthy();
  });

  it("مسارات /api تأخذ default-src 'none' وتبقى تحت المصادقة", () => {
    const saved = process.env.MONTAGE_API_TOKEN;
    process.env.MONTAGE_API_TOKEN = "z".repeat(24);
    try {
      const res = middleware(new NextRequest("http://localhost:3000/api/budget", { headers: { host: "localhost:3000" } }));
      expect(res.status).toBe(401);
      expect(res.headers.get("content-security-policy")).toBe(API_CSP);
    } finally {
      if (saved === undefined) delete process.env.MONTAGE_API_TOKEN; else process.env.MONTAGE_API_TOKEN = saved;
    }
  });

  it("nonce عشوائي بطول كافٍ", () => {
    const n = makeNonce();
    expect(atob(n).length).toBe(16);
    expect(makeNonce()).not.toBe(n);
  });
});
