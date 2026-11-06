import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { EngineError } from "@/lib/engine/errors";
import { routeError, sanitizeErrorMessage, withRoute } from "@/lib/server/with-route";

describe("sanitizeErrorMessage: لا مسارات قرص في رسائل الخطأ", () => {
  it("يزيل مسارات POSIX وWindows ويُبقي النص العربي والروابط والأرقام", () => {
    expect(sanitizeErrorMessage("ENOENT: no such file or directory, open '/home/user/EDITOR.AI/.montage_ai/uploads/a.mp4'")).toBe(
      "ENOENT: no such file or directory, open '[مسار]'"
    );
    expect(sanitizeErrorMessage("فشل قراءة C:\\Users\\me\\videos\\clip.mp4 الآن")).toBe("فشل قراءة [مسار] الآن");
    expect(sanitizeErrorMessage("Error opening input file /tmp/montage_ceo_1.mp3: Invalid data")).toContain("[مسار]");
    // نصوص عادية لا تُشوَّه
    for (const ok of ["إزالة الصمت/التوقفات", "نسبة 1/2 من الملفات", "التاريخ 2026/11/03", "https://api.example.com/v1/audio فشل", "الصور/الفيديو"]) {
      expect(sanitizeErrorMessage(ok)).toBe(ok);
    }
  });
  it("يقصّ الطول ويدمج المسافات", () => {
    expect(sanitizeErrorMessage("a\n\n  b", 10)).toBe("a b");
    expect(sanitizeErrorMessage("x".repeat(500), 50)).toHaveLength(50);
  });
});

describe("routeError / withRoute", () => {
  it("EngineError ⇒ رسالته ورمزه وحالته (مع تنقية المسارات من الرسالة)", async () => {
    const r = routeError("t", new EngineError("NOT_FOUND", "المشروع غير موجود: /var/data/p1/project.json", "جرّب list_projects"));
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body).toMatchObject({ code: "NOT_FOUND", hint: "جرّب list_projects" });
    expect(body.error).not.toContain("/var/data");
    expect((await routeError("t", new EngineError("INVALID_INPUT", "x")).json()).code).toBe("INVALID_INPUT");
    expect(routeError("t", new EngineError("LIMIT_EXCEEDED", "x")).status).toBe(413);
  });

  it("خطأ غير متوقع ⇒ 500 INTERNAL برسالة منقّحة بلا مسار ولا stack", async () => {
    const e = new Error("ENOENT: no such file '/home/user/.montage_ai/exports/job_1.mp4'");
    const r = routeError("t", e);
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.code).toBe("INTERNAL");
    expect(body.error).toMatch(/^خطأ غير متوقع: /);
    expect(JSON.stringify(body)).not.toContain("/home/user");
    expect(JSON.stringify(body)).not.toMatch(/at .*\(.*:\d+:\d+\)/); // لا stack
    expect((await routeError("t", "نص").json()).error).toContain("نص"); // قيمة غير Error
  });

  it("withRoute: يمرّر الاستجابة العادية، ويحوّل الاستثناء إلى JSON متسق، ويمرّر وسائط المسار الديناميكي", async () => {
    const ok = withRoute("t", async (_req, ctx: { params: Promise<{ id: string }> }) => Response.json({ id: (await ctx.params).id }));
    const req = new NextRequest("http://localhost/x");
    expect(await (await ok(req, { params: Promise.resolve({ id: "a1" }) })).json()).toEqual({ id: "a1" });
    const bad = withRoute("t", () => {
      throw new Error("boom at /srv/app/secret.txt");
    });
    const r = await bad(req);
    expect(r.status).toBe(500);
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(JSON.stringify(await r.json())).not.toContain("/srv/app");
  });
});
