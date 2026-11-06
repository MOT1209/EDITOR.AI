import { describe, expect, it } from "vitest";
import { runProcess } from "@/lib/engine/process";

// إلغاء/مهلة يجب ألا يعلّقا المستدعي حتى لو بقي حفيد يحمل أنبوب stdout (يمنع حدث close) — كما قد يحدث مع ffmpeg داخل عزل.
describe("runProcess: قتل لا يعلّق المستدعي", () => {
  it("المهلة تُرفض سريعاً رغم حفيد يحمل stdout", async () => {
    const t0 = Date.now();
    await expect(runProcess("sh", ["-c", "sleep 23 & wait"], { timeoutMs: 300 })).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(Date.now() - t0).toBeLessThan(8000);
  }, 30_000);

  it("الإلغاء يُرفض سريعاً رغم حفيد يحمل stdout", async () => {
    const ac = new AbortController();
    const t0 = Date.now();
    const p = runProcess("sh", ["-c", "sleep 24 & wait"], { timeoutMs: 60_000, signal: ac.signal });
    setTimeout(() => ac.abort(), 200);
    await expect(p).rejects.toMatchObject({ code: "CANCELLED" });
    expect(Date.now() - t0).toBeLessThan(8000);
  }, 30_000);
});
