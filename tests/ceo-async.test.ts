import { afterAll, describe, expect, it } from "vitest";
import { readFileSync, rmSync } from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/agents/ceo/route";
import { hasFfmpeg, UPLOAD_DIR } from "@/lib/server/ffmpeg-export";

// M5: مسار CEO كان يشغّل ffmpeg بـ spawnSync (يجمّد الخادم كله). الآن runProcess غير متزامن ومصلَّب.
describe.skipIf(!hasFfmpeg())("CEO: ffmpeg غير متزامن", () => {
  let uploaded: string | null = null;
  afterAll(() => {
    if (uploaded) for (const ext of [".mp4", ".mov", ".webm", ".mkv"]) rmSync(path.join(UPLOAD_DIR, `${uploaded}${ext}`), { force: true });
  });

  it("لا يجمّد حلقة الأحداث ويعيد خطة بمدة حقيقية بلا مفتاح", async () => {
    const saved = { k: process.env.OPENCODE_API_KEY };
    delete process.env.OPENCODE_API_KEY;
    try {
      const form = new FormData();
      const bytes = readFileSync(path.join(process.cwd(), "test_assets", "test_video.mp4"));
      form.append("file", new File([bytes], "test_video.mp4", { type: "video/mp4" }));
      form.append("request", "اختبار");
      let ticks = 0;
      const timer = setInterval(() => ticks++, 5);
      const res = await POST(new NextRequest("http://localhost/api/agents/ceo", { method: "POST", headers: { host: "localhost" }, body: form }));
      clearInterval(timer);
      expect(res.status).toBe(200);
      const data = await res.json();
      uploaded = String(data.sourceRef || "").replace(/^upload:/, "") || null;
      expect(data.transcriptSimulated).toBe(true);
      expect(Array.isArray(data.silences)).toBe(true);
      expect(data.plan).toBeTruthy();
      // قِيس: الشيفرة القديمة ≈5 (المؤقتات تتوقف أثناء ffmpeg)، الجديدة ≈70+.
      expect(ticks).toBeGreaterThan(20);
    } finally {
      if (saved.k !== undefined) process.env.OPENCODE_API_KEY = saved.k;
    }
  }, 120_000);
});
