import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { _resetApprovals } from "@/lib/server/approvals";
import { POST, DELETE } from "@/app/api/extensions/[kind]/[id]/route";
import { POST as createPost } from "@/app/api/extensions/route";

// مخزن الإضافات يقرأ جذره من MONTAGE_WORKSPACE؛ نعزله في مجلد مؤقت.
let ws = "";
const prev = process.env.MONTAGE_WORKSPACE;
beforeAll(() => { ws = mkdtempSync(path.join(os.tmpdir(), "montage-ext-")); process.env.MONTAGE_WORKSPACE = ws; });
afterAll(() => { rmSync(ws, { recursive: true, force: true }); if (prev === undefined) delete process.env.MONTAGE_WORKSPACE; else process.env.MONTAGE_WORKSPACE = prev; });

const ctx = (id: string) => ({ params: Promise.resolve({ kind: "skills", id }) });
const req = (method: string, body: unknown) =>
  new NextRequest("http://localhost/api/extensions/skills/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "examples", "extensions", "viral-scan.skill.json"), "utf-8"));
const PERMS: string[] = pkg.manifest.permissions;

describe("T-05: grant/delete need a server-registered approval", () => {
  it("round trip: blind confirm is refused; request_approval → confirmed grant works once; delete likewise", async () => {
    _resetApprovals();
    const created = await createPost(new NextRequest("http://localhost/api/extensions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "import", kind: "skill", package: pkg }),
    }));
    if (created.status >= 300) {
      // شكل الحزمة قد يختلف؛ لا نخفي الفشل: نعرضه.
      throw new Error(`تعذّر إنشاء إضافة الاختبار: ${created.status} ${await created.text()}`);
    }
    const id = pkg.manifest.id as string;

    // 1) confirmed:true أعمى بلا طلب موافقة سابق ⇒ 403
    let r = await POST(req("POST", { action: "grant", permissions: PERMS, confirmed: true }), ctx(id));
    // الطلب الأعمى سجّل معلّقاً بحد ذاته؛ نمسحه لنختبر المسار الأعمى الحقيقي
    expect(r.status).toBe(403);
    _resetApprovals();
    r = await DELETE(req("DELETE", { confirm: true }), ctx(id));
    expect(r.status).toBe(403);
    _resetApprovals();

    // 2) request_approval ثم grant مؤكَّد ⇒ نجاح مرة واحدة
    expect((await POST(req("POST", { action: "request_approval", for: "grant" }), ctx(id))).status).toBe(200);
    expect((await POST(req("POST", { action: "grant", permissions: PERMS, confirmed: true }), ctx(id))).status).toBe(200);
    expect((await POST(req("POST", { action: "grant", permissions: PERMS, confirmed: true }), ctx(id))).status).toBe(403); // استُهلكت

    // 3) سحب الصلاحيات (قائمة فارغة) لا يتطلب موافقة
    expect((await POST(req("POST", { action: "grant", permissions: [] }), ctx(id))).status).toBe(200);

    // 4) request for غير معروف ⇒ 400
    expect((await POST(req("POST", { action: "request_approval", for: "x" }), ctx(id))).status).toBe(400);

    // 5) حذف: طلب ثم تأكيد
    expect((await POST(req("POST", { action: "request_approval", for: "delete" }), ctx(id))).status).toBe(200);
    expect((await DELETE(req("DELETE", { confirm: true }), ctx(id))).status).toBe(200);
  });
});
