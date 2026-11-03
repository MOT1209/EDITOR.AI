import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { spawnSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "fs";
import path from "path";
import { defaultProject } from "@/lib/project";
import type { ProjectState, VideoClip } from "@/lib/types";
import { EXPORT_DIR, UPLOAD_DIR, hasFfmpeg, readJobStatus } from "@/lib/server/ffmpeg-export";
import { jobsStore } from "@/lib/server/jobs-store";
import { POST as exportPost, DELETE as exportDelete } from "@/app/api/export/route";
import { POST as retryPost } from "@/app/api/export/retry/[id]/route";
import { GET as statusGet } from "@/app/api/export/status/[id]/route";

// إعادة محاولة التصدير الفاشل/الملغى من طلبه المحفوظ (مهمة جديدة من الصفر).
const FF = hasFfmpeg();
const MAIN = "eeeeeeee-0000-4000-8000-000000000001";
const created: string[] = [];
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const retry = (id: string) => retryPost(new NextRequest(`http://localhost/api/export/retry/${id}`, { method: "POST", headers: { host: "localhost" } }), ctx(id));
const status = (id: string) => statusGet(new NextRequest(`http://localhost/api/export/status/${id}`, { headers: { host: "localhost" } }), ctx(id));

const project = (): ProjectState => ({
  ...defaultProject("retry"), duration: 6, resolution: "720p", fps: 30,
  assets: [{ id: "main", type: "video", name: "m", url: "x", duration: 30 }],
  clips: [{ id: "c1", assetId: "main", trackId: "t_video", start: 0, duration: 4, inPoint: 0, outPoint: 4, effects: [], volume: 1, speed: 1, zoom: 1, panX: 0, panY: 0, smartZoom: false, colorFilter: "none" } as VideoClip],
});
const body = () => ({ sourceRef: `upload:${MAIN}`, project: project() });

beforeAll(() => {
  mkdirSync(UPLOAD_DIR, { recursive: true });
  copyFileSync(path.join(process.cwd(), "test_assets", "test_video.mp4"), path.join(UPLOAD_DIR, `${MAIN}.mp4`));
});
afterAll(() => {
  rmSync(path.join(UPLOAD_DIR, `${MAIN}.mp4`), { force: true });
  for (const f of created) rmSync(f, { force: true });
});

async function waitFor(id: string, want: string, tries = 300) {
  for (let i = 0; i < tries; i++) {
    const st = await readJobStatus(id);
    if (st?.status === want) return st;
    if (st && ["failed", "completed", "cancelled"].includes(st.status) && st.status !== want) throw new Error(`${st.status}: ${st.message}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timeout");
}

describe("حفظ الطلب في مخزن المهام", () => {
  it("يُحفظ ويُسترجع، لا يظهر في get/list، ويُمسح عند الاكتمال", () => {
    const j = jobsStore.create("export", "x", { sourceRef: "upload:a", secretish: "kept" });
    expect(jobsStore.getRequest(j.id)).toEqual({ sourceRef: "upload:a", secretish: "kept" });
    expect(JSON.stringify(jobsStore.get(j.id))).not.toContain("secretish");
    expect(JSON.stringify(jobsStore.list())).not.toContain("secretish");
    jobsStore.complete(j.id, {});
    expect(jobsStore.getRequest(j.id)).toBeUndefined();
    expect(jobsStore.getRequest("job_0_0")).toBeUndefined();
  });
});

describe("POST /api/export/retry/[id] — حالات الرفض", () => {
  it("معرّف سيئ 400، مجهول 404، جارية/ناجحة 409، فاشلة بلا طلب محفوظ 404", async () => {
    expect((await retry("../x")).status).toBe(400);
    expect((await retry("job_1_1")).status).toBe(404);
    const running = jobsStore.create("export", "x", body());
    expect((await retry(running.id)).status).toBe(409);
    jobsStore.complete(running.id, {});
    expect((await retry(running.id)).status).toBe(409);
    const noReq = jobsStore.create("export", "x");
    jobsStore.fail(noReq.id, "انقطعت");
    expect((await retry(noReq.id)).status).toBe(404);
    const other = jobsStore.create("ai", "x", body());
    jobsStore.fail(other.id, "x");
    expect((await retry(other.id)).status).toBe(404); // ليست مهمة تصدير
  });
});

describe.runIf(FF)("إعادة محاولة حقيقية", () => {
  it("تصدير يُلغى ⇒ status.retryable ⇒ retry ينشئ مهمة جديدة تنتج ملفاً صالحاً (ffprobe)", async () => {
    const res = await exportPost(new NextRequest("http://localhost/api/export", { method: "POST", headers: { host: "localhost", "content-type": "application/json" }, body: JSON.stringify(body()) }));
    expect(res.status).toBe(200);
    const first = (await res.json()).job.id as string;
    created.push(path.join(EXPORT_DIR, `${first}.json`));
    const del = await exportDelete(new NextRequest(`http://localhost/api/export?id=${first}`, { method: "DELETE", headers: { host: "localhost" } }));
    expect(del.status).toBe(200);
    await waitFor(first, "cancelled");

    const st = await (await status(first)).json();
    expect(st.status).toBe("cancelled");
    expect(st.retryable).toBe(true);
    expect(JSON.stringify(st)).not.toContain("sourceRef"); // الطلب نفسه لا يُكشف للعميل

    const r = await retry(first);
    expect(r.status).toBe(200);
    const second = (await r.json()).job.id as string;
    expect(second).not.toBe(first);
    await waitFor(second, "completed");
    const file = path.join(EXPORT_DIR, `${second}.${project().format}`);
    created.push(file, path.join(EXPORT_DIR, `${second}.json`), path.join(EXPORT_DIR, `${first}.mp4`));
    expect(existsSync(file)).toBe(true);
    const dur = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf-8" }).stdout);
    expect(dur).toBeGreaterThan(3.5);
    // المهمة الناجحة لا طلب محفوظاً لها ولا تُعاد
    expect(jobsStore.getRequest(second)).toBeUndefined();
    expect((await retry(second)).status).toBe(409);
  }, 120_000);

  it("طلب محفوظ بمرجع حُذف (تنظيف) ⇒ رفض واضح لا انهيار", async () => {
    const j = jobsStore.create("export", "x", { sourceRef: "upload:00000000-0000-4000-8000-000000000000", project: project() });
    jobsStore.fail(j.id, "انقطعت");
    const r = await retry(j.id);
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe("INVALID_INPUT");
  });
});
