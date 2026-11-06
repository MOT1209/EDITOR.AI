import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as exportPost } from "@/app/api/export/route";
import { PUT as projectPut } from "@/app/api/projects/[id]/route";
import { EXPORT_MAX_JSON_BYTES } from "@/lib/server/schemas";

const req = (url: string, method: string, body: string, headers: Record<string, string> = {}) =>
  new NextRequest(url, { method, headers: { host: "localhost", "content-type": "application/json", ...headers }, body });

describe("حدود أجسام JSON (export/projects)", () => {
  it("export: جسم أكبر من الحد ⇒ 413 قبل أي معالجة", async () => {
    const res = await exportPost(req("http://localhost/api/export", "POST", "{}", { "content-length": String(EXPORT_MAX_JSON_BYTES + 1) }));
    expect(res.status).toBe(413);
    const big = JSON.stringify({ project: { pad: "x".repeat(EXPORT_MAX_JSON_BYTES) } });
    expect((await exportPost(req("http://localhost/api/export", "POST", big))).status).toBe(413);
  });

  it("export: أنواع حقول خاطئة ⇒ 400 (لا تحويل صامت)", async () => {
    for (const bad of [{ colorGrading: "1" }, { colorGrading: 5 }, { videoStabilize: "yes" }, { sources: "nope" }, { preview: { start: "a", end: 1 } }]) {
      const res = await exportPost(req("http://localhost/api/export", "POST", JSON.stringify({ sourceRef: "upload:x", ...bad })));
      expect(res.status).toBe(400);
    }
    expect((await exportPost(req("http://localhost/api/export", "POST", "not json"))).status).toBe(400);
  });

  it("projects PUT: جسم ضخم ⇒ 413، وJSON غير صالح ⇒ 400", async () => {
    const ctx = { params: Promise.resolve({ id: "p1" }) };
    const big = JSON.stringify({ project: { pad: "x".repeat(EXPORT_MAX_JSON_BYTES) } });
    expect((await projectPut(req("http://localhost/api/projects/p1", "PUT", big), ctx)).status).toBe(413);
    expect((await projectPut(req("http://localhost/api/projects/p1", "PUT", "{oops"), ctx)).status).toBe(400);
  });
});
