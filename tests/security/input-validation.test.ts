import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/server/request";
import { subtitlesBody, musicSyncBody, framesBody, ttsBody, translateBody, reframeBody } from "@/lib/server/schemas";
import { POST as subtitles } from "@/app/api/ai/subtitles/route";
import { POST as musicSync } from "@/app/api/ai/music-sync/route";
import { POST as probe } from "@/app/api/ffmpeg/probe/route";
import { safeUploadExt } from "@/lib/server/uploads";

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", headers: { host: "localhost", "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("DoS-bounded request schemas", () => {
  it("rejects absurd durations that previously drove unbounded server loops", () => {
    expect(subtitlesBody.safeParse({ duration: 1e9 }).success).toBe(false);
    expect(musicSyncBody.safeParse({ bpm: 0.0001, duration: 1e9 }).success).toBe(false);
    expect(musicSyncBody.safeParse({ bpm: 1e9, duration: 86400 }).success).toBe(false);
    expect(subtitlesBody.safeParse({ duration: -5 }).success).toBe(false);
    expect(subtitlesBody.safeParse({ duration: "30" }).success).toBe(false);
  });
  it("bounds arrays and strings", () => {
    expect(framesBody.safeParse({ frames: Array(13).fill("a") }).success).toBe(false);
    expect(framesBody.safeParse({ frames: [123] }).success).toBe(false);
    expect(ttsBody.safeParse({ text: "x".repeat(5001) }).success).toBe(false);
    expect(ttsBody.safeParse({ text: "ok", speed: 99 }).success).toBe(false);
    expect(translateBody.safeParse({ texts: Array(501).fill("a") }).success).toBe(false);
    expect(reframeBody.safeParse({ targetAspect: "; rm -rf" }).success).toBe(false);
  });
  it("applies defaults for valid minimal bodies (no behaviour regression)", () => {
    expect(subtitlesBody.parse({})).toEqual({ duration: 30, lang: "ar" });
    expect(framesBody.parse({}).frames).toEqual([]);
    expect(translateBody.parse({}).texts).toEqual([]);
  });
});

describe("routes reject bad input with 4xx instead of 500/CPU burn", () => {
  it("/api/ai/subtitles: duration 1e9 → 400 (before: millions of cues)", async () => {
    const r = await subtitles(post("/api/ai/subtitles", { duration: 1e9 }));
    expect(r.status).toBe(400);
  });
  it("/api/ai/subtitles: valid request still works", async () => {
    const r = await subtitles(post("/api/ai/subtitles", { duration: 12 }));
    expect(r.status).toBe(200);
  });
  it("/api/ai/music-sync: absurd bpm → 400; valid → 200", async () => {
    expect((await musicSync(post("/api/ai/music-sync", { bpm: 1e9, duration: 80000 }))).status).toBe(400);
    expect((await musicSync(post("/api/ai/music-sync", { bpm: 120, duration: 10 }))).status).toBe(200);
  });
  it("malformed JSON → 400; oversized declared body → 413", async () => {
    const bad = await parseJsonBody(post("/x", "{not json"), z.object({}));
    expect(bad.ok === false && bad.response.status).toBe(400);
    const big = await parseJsonBody(post("/x", "{}", { "content-length": "99999999" }), z.object({}), { maxBytes: 1000 });
    expect(big.ok === false && big.response.status).toBe(413);
  });
});

describe("upload hardening", () => {
  it("/api/ffmpeg/probe rejects oversized Content-Length before reading the body (413)", async () => {
    const req = new NextRequest("http://localhost/api/ffmpeg/probe", { method: "POST", headers: { host: "localhost", "content-length": String(50 * 1024 ** 3), "content-type": "multipart/form-data; boundary=x" }, body: "x" });
    expect((await probe(req)).status).toBe(413);
  });
  it("upload extension is allow-listed (attacker-chosen extensions are never kept)", () => {
    expect(safeUploadExt("evil.sh")).toBe(".mp4");
    expect(safeUploadExt("x.php.jpg")).toBe(".mp4");
    expect(safeUploadExt("a.MOV")).toBe(".mov");
    expect(safeUploadExt("..\\..\\x")).toBe(".mp4");
  });
});

describe("T-07: remaining JSON routes validated", () => {
  it("silence / skills / assets-import reject malformed bodies with 400 (not 500)", async () => {
    const { POST: sil } = await import("@/app/api/ai/silence/route");
    const { POST: sk } = await import("@/app/api/skills/route");
    const { POST: imp } = await import("@/app/api/assets/import/route");
    expect((await sil(post("/x", { duration: "abc" }))).status).toBe(400);
    expect((await sk(post("/x", { mode: "rm -rf", skill: 5 }))).status).toBe(400);
    expect((await sk(post("/x", { mode: "skill", skill: "X", document: { duration: 1e12 } }))).status).toBe(400);
    expect((await imp(post("/x", { imageUrl: 42 }))).status).toBe(400);
    expect((await imp(post("/x", "{bad"))).status).toBe(400);
  });
});

describe("review fixes: thumbnail / assets-check / agents-export bodies", () => {
  it("reject malformed bodies with 400; valid thumbnail still works", async () => {
    const { POST: th } = await import("@/app/api/thumbnail/route");
    const { POST: ck } = await import("@/app/api/assets/check/route");
    const { POST: ex } = await import("@/app/api/agents/export/route");
    expect((await th(post("/x", { title: "x".repeat(5000) }))).status).toBe(400);
    expect((await th(post("/x", { title: 5, aspect: "weird" }))).status).toBe(400);
    const ok = await th(post("/x", { title: "<script>alert(1)</script>", aspect: "9:16" }));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(Buffer.from(body.svg.split(",")[1], "base64").toString()).not.toContain("<script>"); // الهروب سليم
    expect((await ck(post("/x", { refs: Array(300).fill("upload:x") }))).status).toBe(400);
    expect((await ex(post("/x", { jobId: 7 }))).status).toBe(400);
  });
});
