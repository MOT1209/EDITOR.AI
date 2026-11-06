import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, rmSync } from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { POST as skillsPost } from "@/app/api/skills/route";
import { POST as scenesPost } from "@/app/api/ai/scenes/route";
import { hasFfmpeg, UPLOAD_DIR } from "@/lib/server/ffmpeg-export";
import { skillProvenance } from "@/lib/skills/provenance";
import { buildSkillManager } from "@/lib/skills";

// T-22: التحليل الحقيقي (ffmpeg) يصل مهارات HTTP عبر sourceRef بدل الاستدلال العشوائي.
const ID = "22222222-3333-4444-8555-666666666666";
const REF = `upload:${ID}`;
const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", headers: { host: "localhost", "content-type": "application/json" }, body: JSON.stringify(body) });

describe.skipIf(!hasFfmpeg())("skills + sourceRef ⇒ تحليل حقيقي", () => {
  beforeAll(() => {
    mkdirSync(UPLOAD_DIR, { recursive: true });
    copyFileSync(path.join(process.cwd(), "test_assets", "test_video.mp4"), path.join(UPLOAD_DIR, `${ID}.mp4`));
  });
  afterAll(() => rmSync(path.join(UPLOAD_DIR, `${ID}.mp4`), { force: true }));

  it("مهارة المشاهد بـ sourceRef ⇒ real-analysis ومشاهد تغطي المدة الحقيقية", async () => {
    const res = await skillsPost(post("/api/skills", { mode: "skill", skill: "SceneDetectionSkill", document: { duration: 30 }, sourceRef: REF }));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.provenance).toBe("real-analysis");
    expect(d.simulated).toBe(false);
    const scenes = d.result.output.scenes as { start: number; end: number }[];
    expect(scenes.length).toBeGreaterThanOrEqual(1);
    expect(scenes[0].start).toBe(0);
    expect(scenes[scenes.length - 1].end).toBeGreaterThan(25);
  });

  it("مهارة الصمت بـ sourceRef ⇒ real-analysis (فترات من silencedetect، قد تكون فارغة)", async () => {
    const d = await (await skillsPost(post("/api/skills", { mode: "skill", skill: "SilenceDetectionSkill", document: { duration: 30 }, sourceRef: REF }))).json();
    expect(d.provenance).toBe("real-analysis");
    expect(Array.isArray(d.result.output.silences)).toBe(true);
  });

  it("بلا sourceRef ⇒ simulated كما كان (لا ادّعاء تحليل)", async () => {
    const d = await (await skillsPost(post("/api/skills", { mode: "skill", skill: "SceneDetectionSkill", document: { duration: 30 } }))).json();
    expect(d.provenance).toBe("simulated");
    expect(d.simulated).toBe(true);
  });

  it("workflow بـ sourceRef: خطوات الصمت/المشاهد ليست ضمن simulatedSteps", async () => {
    const d = await (await skillsPost(post("/api/skills", { mode: "workflow", workflow: "default", document: { duration: 30 }, sourceRef: REF }))).json();
    expect(d.simulatedSteps).not.toContain("SceneDetectionSkill");
    expect(d.simulatedSteps).not.toContain("SilenceDetectionSkill");
  });

  it("sourceRef غير صالح ⇒ 400 (لا مسار قرص ولا تجاهل صامت)", async () => {
    for (const bad of ["/etc/passwd", "upload:../../x", "upload:00000000-0000-4000-8000-000000000000"]) {
      expect((await skillsPost(post("/api/skills", { mode: "skill", skill: "SceneDetectionSkill", sourceRef: bad }))).status).toBe(400);
    }
  });

  it("/api/ai/scenes بـ sourceRef ⇒ ffmpeg حقيقي بلا simulated، وبدونه بديل تقديري موسوم", async () => {
    const real = await (await scenesPost(post("/api/ai/scenes", { duration: 30, sourceRef: REF }))).json();
    expect(real.simulated).toBeUndefined();
    expect(real.method).toBe("ffmpeg-scene-detect");
    expect(real.scenes[0].start).toBe(0);
    const fake = await (await scenesPost(post("/api/ai/scenes", { duration: 30 }))).json();
    expect(fake.simulated).toBe(true);
    expect((await scenesPost(post("/api/ai/scenes", { duration: 30, sourceRef: "/etc/passwd" }))).status).toBe(400);
  });
});

describe("HighlightDetectionSkill: البديل العشوائي يُوسم simulated لا computed", () => {
  it("بلا مشاهد ذات درجات ⇒ heuristic ⇒ simulated", async () => {
    const m = buildSkillManager();
    const doc = { duration: 30 };
    const res = await m.runSkill("HighlightDetectionSkill", doc, m.createContext(doc));
    expect(skillProvenance("HighlightDetectionSkill", res.logs)).toBe("simulated");
  });
  it("مشاهد بدرجات ≥ العتبة ⇒ computed (حساب حتمي على المدخلات)", async () => {
    const m = buildSkillManager();
    const doc = { duration: 30, scenes: [{ start: 0, end: 10, score: 0.9 }, { start: 10, end: 20, score: 0.8 }] };
    const res = await m.runSkill("HighlightDetectionSkill", doc, m.createContext(doc));
    expect(skillProvenance("HighlightDetectionSkill", res.logs)).toBe("computed");
  });
});
