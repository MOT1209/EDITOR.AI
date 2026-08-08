import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

export class ExportOptimizationSkill extends BaseSkill {
  readonly name = "ExportOptimizationSkill";
  readonly description = "تحسين إعدادات التصدير حسب المنصة المستهدفة.";
  readonly category: SkillCategory = "export";
  readonly inputSpec = { platform: "string", aspect: "string" };
  readonly outputSpec = { exportSettings: "{ platform, resolution, fps, bitrate, codec, format }" };
  protected readonly defaultConfig = { platform: "tiktok" };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const platform = (input.platform as string) || this.cfg("platform", "tiktok");
    const aspect = (input.aspect as string) || "9:16";

    const presets: Record<string, { resolution: string; fps: number; bitrate: string }> = {
      tiktok: { resolution: "1080x1920", fps: 30, bitrate: "8M" },
      instagram: { resolution: "1080x1920", fps: 30, bitrate: "8M" },
      youtube: { resolution: "1920x1080", fps: 60, bitrate: "16M" },
      youtube_shorts: { resolution: "1080x1920", fps: 30, bitrate: "10M" },
      twitter: { resolution: "1280x720", fps: 30, bitrate: "6M" },
    };
    const p = presets[platform] ?? presets.tiktok;
    const exportSettings = {
      platform,
      aspect,
      resolution: p.resolution,
      fps: p.fps,
      bitrate: p.bitrate,
      codec: "h264",
      audioCodec: "aac",
      format: "mp4",
    };
    this.log("info", `إعدادات تصدير لـ ${platform} (${p.resolution})`);
    return { exportSettings };
  }
}
