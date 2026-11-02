import { describe, expect, it } from "vitest";
import { promises as fsp } from "fs";
import { importRemoteImage, isAllowedImportUrl, sniffImageExt } from "@/lib/server/assets";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function fakeFetch(routes: Record<string, () => Response>) {
  const seen: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    const r = routes[url];
    if (!r) throw new Error(`unexpected fetch ${url}`);
    return r();
  }) as typeof fetch;
  return { impl, seen };
}

describe("استيراد صورة بعيدة (SSRF/حجم/نوع)", () => {
  it("يقبل https على pexels فقط", () => {
    expect(isAllowedImportUrl("https://images.pexels.com/a.jpg")).toBe(true);
    expect(isAllowedImportUrl("http://images.pexels.com/a.jpg")).toBe(false);
    expect(isAllowedImportUrl("https://pexels.com.evil.io/a.jpg")).toBe(false);
    expect(isAllowedImportUrl("https://user:pw@images.pexels.com/a.jpg")).toBe(false);
    expect(isAllowedImportUrl("https://169.254.169.254/latest")).toBe(false);
  });

  it("يرفض تحويلاً إلى مضيف خارج القائمة دون طلبه", async () => {
    const { impl, seen } = fakeFetch({
      "https://images.pexels.com/r.jpg": () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1:3000/api/budget" } }),
    });
    await expect(importRemoteImage("https://images.pexels.com/r.jpg", { fetchImpl: impl })).rejects.toThrow("غير مسموح");
    expect(seen).toEqual(["https://images.pexels.com/r.jpg"]);
  });

  it("يرفض ملفاً يتجاوز السقف ويرفض ما ليس صورة", async () => {
    const big = fakeFetch({ "https://images.pexels.com/b.jpg": () => new Response(new Uint8Array(2048)) });
    await expect(importRemoteImage("https://images.pexels.com/b.jpg", { fetchImpl: big.impl, maxBytes: 1024 })).rejects.toThrow("الحد");
    const html = fakeFetch({ "https://images.pexels.com/h.jpg": () => new Response("<html></html>", { headers: { "content-type": "image/jpeg" } }) });
    await expect(importRemoteImage("https://images.pexels.com/h.jpg", { fetchImpl: html.impl })).rejects.toThrow("ليس صورة");
  });

  it("يتبع تحويلاً داخل القائمة ويحدد الامتداد من التوقيع", async () => {
    const { impl } = fakeFetch({
      "https://images.pexels.com/x.jpg": () => new Response(null, { status: 301, headers: { location: "/y" } }),
      "https://images.pexels.com/y": () => new Response(PNG, { headers: { "content-type": "image/jpeg" } }),
    });
    const r = await importRemoteImage("https://images.pexels.com/x.jpg", { fetchImpl: impl });
    expect(r.path.endsWith(".png")).toBe(true);
    expect(sniffImageExt(PNG)).toBe(".png");
    await fsp.rm(r.path, { force: true });
  });
});
