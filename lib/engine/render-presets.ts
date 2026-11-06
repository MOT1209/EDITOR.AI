// ثوابت التصدير المشتركة بين المسار القديم والمركِّب متعدد المسارات.
import type { ProjectAspect } from "@/lib/types";

const RESOLUTION_SIZES: Record<string, Record<ProjectAspect, [number, number]>> = {
  "720p": { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [720, 720], "4:5": [720, 900] },
  "1080p": { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] },
  "4k": { "16:9": [3840, 2160], "9:16": [2160, 3840], "1:1": [2160, 2160], "4:5": [2160, 2700] },
};

export function resolveOutputSize(resolution: string, aspect: ProjectAspect): [number, number] {
  return RESOLUTION_SIZES[resolution]?.[aspect] || RESOLUTION_SIZES["1080p"]["16:9"];
}

export const QUALITY_CRF: Record<string, { crf: number; preset: string }> = {
  draft: { crf: 32, preset: "veryfast" },
  standard: { crf: 26, preset: "fast" },
  high: { crf: 20, preset: "medium" },
  ultra: { crf: 16, preset: "slow" },
};

// Rough approximations of the editor's CSS preview filters (components/editor/Editor.tsx
// COLOR_FILTERS), expressed as ffmpeg filter chains. Not pixel-identical to the CSS
// preview — good enough for a first real export, refine later if needed.
export const COLOR_FILTER_FFMPEG: Record<string, string> = {
  none: "",
  cinematic: "eq=contrast=1.1:saturation=1.15:brightness=-0.03",
  warm: "eq=saturation=1.25:gamma_r=1.05:gamma_b=0.95",
  cool: "eq=saturation=0.9:brightness=0.03,hue=h=12",
  vhs: "eq=contrast=1.2:saturation=0.85,hue=h=5",
  bw: "hue=s=0",
  vivid: "eq=saturation=1.6:contrast=1.1",
  dreamy: "eq=brightness=0.08:saturation=1.15,gblur=sigma=1.2",
};

// Maps EFFECTS_LIBRARY ids (lib/mockAi.ts) to real per-segment ffmpeg filter
// chains, given the segment's duration (seconds) and output canvas size.
// fade/zoom/color/glitch/shake are high-fidelity; light-leak is a stylized
// brightness-pulse approximation (documented — still a real, dynamic, visible
// effect, just not a literal light-leak texture since that needs a second
// blended input source, which is future work).
export const EFFECT_FFMPEG: Record<string, (dur: number, w: number, h: number) => string | null> = {
  fx_fade: (dur) =>
    dur > 1
      ? `fade=t=in:st=0:d=0.5,fade=t=out:st=${Math.max(0.5, dur - 0.5).toFixed(3)}:d=0.5`
      : null,
  fx_zoom_punch: (_dur, w, h) => `zoompan=z='min(1+0.0025*on,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}`,
  fx_kenburns: (_dur, w, h) => `zoompan=z='min(1+0.0006*on,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}`,
  fx_zoom_blur: (_dur, w, h) => `zoompan=z='min(1+0.0015*on,1.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h},gblur=sigma=1.5`,
  fx_shake: () => "crop=iw-24:ih-24:x='12+8*sin(2*PI*t*5)':y='12+6*cos(2*PI*t*7)'",
  fx_glitch: () => "rgbashift=rh=6:bv=-6:edge=smear",
  fx_light_leak: () => "eq=eval=frame:brightness='0.06*sin(2*PI*t*0.4)':saturation=1.1",
  fx_warm: () => COLOR_FILTER_FFMPEG.warm,
  fx_cinematic: () => COLOR_FILTER_FFMPEG.cinematic,
  fx_vhs: () => COLOR_FILTER_FFMPEG.vhs,
  fx_cool: () => COLOR_FILTER_FFMPEG.cool,
  // fx_slide_l is handled structurally in buildFilterComplex (xfade between
  // segments), not as a per-segment filter — it has no entry here.
};

export function buildEffectChain(effectIds: string[], dur: number, w: number, h: number): string[] {
  const chain: string[] = [];
  for (const id of effectIds) {
    const build = EFFECT_FFMPEG[id];
    if (!build) continue;
    const filter = build(dur, w, h);
    if (filter) chain.push(filter);
  }
  return chain;
}

export const FORMAT_CODEC: Record<string, { video: string; audio: string; extraArgs: string[] }> = {
  mp4: { video: "libx264", audio: "aac", extraArgs: ["-pix_fmt", "yuv420p", "-movflags", "+faststart"] },
  mov: { video: "libx264", audio: "aac", extraArgs: ["-pix_fmt", "yuv420p"] },
  mkv: { video: "libx264", audio: "aac", extraArgs: ["-pix_fmt", "yuv420p"] },
  webm: { video: "libvpx-vp9", audio: "libopus", extraArgs: [] },
};

// Speed changes beyond this range would need chained atempo filters; clamp for v1.
export function clampSpeed(speed: number): number {
  return Math.min(2, Math.max(0.5, speed || 1));
}

