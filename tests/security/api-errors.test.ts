import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// T-27 + «لا مسار قرص في أي استجابة»: فشل داخلي برسالة تحوي مسار قرص لا يصل العميل، والاستجابة JSON متسقة.
vi.mock("@/lib/engine/store", async (orig) => {
  const real = await orig<typeof import("@/lib/engine/store")>();
  return {
    ...real,
    listProjects: vi.fn(async () => {
      throw new Error("EACCES: permission denied, scandir '/home/user/EDITOR.AI/.montage_ai/workspace/projects'");
    }),
    getProject: vi.fn(async () => {
      throw new Error("ENOENT: no such file '/home/user/EDITOR.AI/.montage_ai/workspace/projects/p1/project.json'");
    }),
  };
});

const req = (url: string, init: Record<string, unknown> = {}) =>
  new NextRequest(`http://localhost${url}`, { ...init, headers: { host: "localhost", ...((init.headers as Record<string, string>) ?? {}) } } as ConstructorParameters<typeof NextRequest>[1]);

describe("أخطاء المسارات موحّدة وبلا مسارات قرص", () => {
  it("GET /api/projects عند فشل داخلي: 500 JSON + projects:[] بلا مسار، ولا حقل workspace", async () => {
    const { GET } = await import("@/app/api/projects/route");
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.projects).toEqual([]);
    expect(body.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("/home/user");
    expect("workspace" in body).toBe(false);
  });

  it("GET /api/projects/[id] وPUT: خطأ غير متوقع ⇒ 500 منقّح (لا ENOENT بمسار)", async () => {
    const { GET } = await import("@/app/api/projects/[id]/route");
    const res = await GET(req("/api/projects/p1"), { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("/home/user");
  });

  it("GET /api/projects/[id]/media/[assetId] ⇒ لا 404 بنص خام بل JSON منقّح", async () => {
    const { GET } = await import("@/app/api/projects/[id]/media/[assetId]/route");
    const res = await GET(req("/x"), { params: Promise.resolve({ id: "p1", assetId: "a1" }) });
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(JSON.stringify(await res.json())).not.toContain("/home/user");
  });

  it("مسارات مغلَّفة بـ withRoute تعمل عادياً (jobs/budget) وتعيد JSON", async () => {
    const { GET: jobs } = await import("@/app/api/jobs/route");
    const { GET: budget } = await import("@/app/api/budget/route");
    expect((await jobs(req("/api/jobs"))).status).toBe(200);
    expect(await (await jobs(req("/api/jobs"))).json()).toHaveProperty("jobs");
    expect(await (await budget(req("/api/budget"))).json()).toHaveProperty("capUsd");
  });
});
