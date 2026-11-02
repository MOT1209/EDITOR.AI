import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "@/middleware";
import { STREAMING_API_ROUTES } from "@/lib/server/api-guard";

// كل مسار /api إما يمرّ بـ middleware (حارس + مصادقة)، أو مُدرج في STREAMING_API_ROUTES ويستدعي
// guardApiRequest بنفسه. يمنع مستقبلاً مساراً مكشوفاً بلا مصادقة.
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? routeFiles(p) : n === "route.ts" ? [p] : [];
  });
}
const apiRoot = path.join(process.cwd(), "app", "api");
const routes = routeFiles(apiRoot).map((f) => ({
  file: f,
  url: "/api/" + path.relative(apiRoot, path.dirname(f)).split(path.sep).map((s) => s.replace(/^\[(.+)\]$/, "x_1")).join("/"),
}));

describe("تغطية حارس /api", () => {
  it("كل مسار: إما middleware يطابقه، أو مستثنى ويستدعي guardApiRequest في كل معالج", () => {
    expect(routes.length).toBeGreaterThan(20);
    for (const r of routes) {
      const viaMiddleware = unstable_doesMiddlewareMatch({ config, url: r.url });
      const streaming = (STREAMING_API_ROUTES as readonly string[]).includes(r.url);
      expect({ url: r.url, covered: viaMiddleware !== streaming }).toEqual({ url: r.url, covered: true });
      if (streaming) {
        const src = readFileSync(r.file, "utf-8");
        const handlers = (src.match(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g) || []).length;
        const guards = (src.match(/const denied = guardApiRequest\(req\);\s*\n\s*if \(denied\) return denied;/g) || []).length;
        expect({ url: r.url, guards }).toEqual({ url: r.url, guards: handlers });
      }
    }
  });

  it("مسارات الرفع المستثناة ترفض بلا رمز، وترفض الأصل الأجنبي", async () => {
    const saved = process.env.MONTAGE_API_TOKEN;
    process.env.MONTAGE_API_TOKEN = "q".repeat(24);
    try {
      for (const url of STREAMING_API_ROUTES) {
        const mod = await import(/* @vite-ignore */ path.join(process.cwd(), "app", url, "route.ts"));
        const anon = await mod.POST(new NextRequest(`http://localhost:3000${url}`, { method: "POST", headers: { host: "localhost:3000" }, body: "x" }));
        expect({ url, status: anon.status }).toEqual({ url, status: 401 });
        const foreign = await mod.POST(new NextRequest(`http://localhost:3000${url}`, { method: "POST", headers: { host: "localhost:3000", origin: "https://evil.example", authorization: `Bearer ${"q".repeat(24)}` }, body: "x" }));
        expect({ url, status: foreign.status }).toEqual({ url, status: 403 });
      }
    } finally {
      if (saved === undefined) delete process.env.MONTAGE_API_TOKEN; else process.env.MONTAGE_API_TOKEN = saved;
    }
  });
});

