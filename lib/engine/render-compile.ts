// ====================================================================
// مُصرِّف خطة الرندر → وسائط ffmpeg (دالة نقية، بلا تشغيل).
// الدلالات الموثّقة في docs/RENDERING.md. أي رقم هنا آتٍ من RenderPlan المتحقَّق
// (لا نصوص حرة من العميل) فلا حقن في filter_complex.
// ====================================================================
import { buildAss } from "./ass";
import { COLOR_FILTER_FFMPEG, FORMAT_CODEC, QUALITY_CRF, buildEffectChain } from "./render-presets";
import type { AudioLayer, RenderPlan, SourceMap, VideoLayer } from "./render-plan";

export interface CompileOptions {
  outputPath: string;
  format: string;
  quality: string;
  encoderOverride?: { preset: string; crf: number };
  useNvenc?: boolean;
  videoStabilize?: boolean;
  /** فلتر eq جاهز من مستوى التصحيح العام (colorGradingFilter). */
  gradingFilter?: string | null;
}

export interface CompiledPlan {
  args: string[];
  filterComplex: string;
  ass: string | null;
  assFilename: string | null;
  totalDuration: number;
  width: number;
  height: number;
  segmentCount: number;
  inputs: string[];
}

const n = (x: number, d = 4) => String(Number(x.toFixed(d)));
const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);

/** سلسلة atempo ضمن [0.5, 2] لأي سرعة. */
export function atempoChain(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  while (s > 2.0001) { out.push("atempo=2"); s /= 2; }
  while (s < 0.4999) { out.push("atempo=0.5"); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-4) out.push(`atempo=${n(s, 5)}`);
  return out;
}

function slideOffset(type: string, W: number, H: number): { ax: "x" | "y"; sign: 1 | -1; size: number } | null {
  switch (type) {
    case "slide-left": return { ax: "x", sign: 1, size: W };   // يدخل من اليمين
    case "slide-right": return { ax: "x", sign: -1, size: W }; // يدخل من اليسار
    case "slide-up": return { ax: "y", sign: 1, size: H };     // يدخل من الأسفل
    case "slide-down": return { ax: "y", sign: -1, size: H };  // يدخل من الأعلى
    default: return null;
  }
}

function videoLayerChain(l: VideoLayer, plan: RenderPlan, inputIdx: number): { chain: string; overlayX: string; overlayY: string; hasAlphaAnim: boolean } {
  const { width: W, height: H, fps } = plan;
  const bw = even(W * l.scale);
  const bh = even(H * l.scale);
  const f: string[] = [];
  if (l.kind === "video") {
    f.push(`trim=start=${n(l.inPoint)}:end=${n(l.inPoint + l.duration * l.speed)}`);
    f.push(`setpts=(PTS-STARTPTS)/${n(l.speed, 5)}`);
  } else {
    f.push("setpts=PTS-STARTPTS", `trim=duration=${n(l.duration)}`);
  }
  f.push(`fps=${fps}`);
  if (l.crop) {
    const { left, top, right, bottom } = l.crop;
    const wFrac = Math.max(0.05, 1 - left - right);
    const hFrac = Math.max(0.05, 1 - top - bottom);
    f.push(`crop=iw*${n(wFrac)}:ih*${n(hFrac)}:iw*${n(left)}:ih*${n(top)}`);
  }
  // تغطية الصندوق (cover) ثم قصّ — نفس دلالة object-fit: cover في المعاينة.
  f.push(`scale=${bw}:${bh}:force_original_aspect_ratio=increase`, `crop=${bw}:${bh}`);
  if (l.zoom > 1.0001 || Math.abs(l.panX) > 1e-4 || Math.abs(l.panY) > 1e-4) {
    const z = Math.max(1, l.zoom);
    f.push(
      `scale=iw*${n(z)}:ih*${n(z)}`,
      `crop=${bw}:${bh}:x='min(max((iw-ow)/2+(${n(l.panX)})*iw,0),iw-ow)':y='min(max((ih-oh)/2+(${n(l.panY)})*ih,0),ih-oh)'`
    );
  }
  f.push("setsar=1");
  const preset = COLOR_FILTER_FFMPEG[l.colorFilter || "none"] || "";
  if (preset) f.push(preset);
  if (l.color) {
    const b = l.color.brightness ?? 0;
    const c = l.color.contrast ?? 1;
    const s = l.color.saturation ?? 1;
    if (b !== 0 || c !== 1 || s !== 1) f.push(`eq=brightness=${n(b)}:contrast=${n(c)}:saturation=${n(s)}`);
  }
  for (const e of buildEffectChain(l.effects, l.duration, bw, bh)) f.push(e);
  if (l.holdTail > 0) f.push(`tpad=stop_mode=clone:stop_duration=${n(l.holdTail)}`);

  const trans = l.transitionIn;
  const slide = trans ? slideOffset(trans.type, W, H) : null;
  const dissolve = trans?.type === "dissolve";
  const needsAlpha = l.rotation !== 0 || l.opacity < 1 || l.fadeIn > 0 || l.fadeOut > 0 || dissolve;
  if (needsAlpha) f.push("format=rgba");
  if (l.rotation !== 0) {
    const rad = n((l.rotation * Math.PI) / 180, 6);
    f.push(`rotate=a=${rad}:ow=rotw(${rad}):oh=roth(${rad}):c=black@0`);
  }
  if (l.opacity < 1) f.push(`colorchannelmixer=aa=${n(l.opacity)}`);
  const total = l.duration + l.holdTail;
  if (l.fadeIn > 0) f.push(`fade=t=in:st=0:d=${n(Math.min(l.fadeIn, l.duration))}:alpha=1`);
  if (dissolve && trans) f.push(`fade=t=in:st=0:d=${n(trans.duration)}:alpha=1`);
  if (l.fadeOut > 0) f.push(`fade=t=out:st=${n(Math.max(0, l.duration - l.fadeOut))}:d=${n(Math.min(l.fadeOut, l.duration))}:alpha=1`);
  f.push(`setpts=PTS-STARTPTS+${n(l.start)}/TB`);
  void total;

  // موضع الطبقة: مركز + إزاحة نسبية؛ الانزلاق يضيف إزاحة متحركة بالزمن.
  const baseX = `(W-w)/2+(${n(l.posX)})*${W}`;
  const baseY = `(H-h)/2+(${n(l.posY)})*${H}`;
  let overlayX = baseX;
  let overlayY = baseY;
  if (slide && trans) {
    const p = `(1-min(1,max(0,(t-${n(l.start)})/${n(trans.duration)})))`;
    const off = `${slide.sign}*${slide.size}*${p}`;
    if (slide.ax === "x") overlayX = `${baseX}+${off}`;
    else overlayY = `${baseY}+${off}`;
  }
  const chain = `[${inputIdx}:v]${f.join(",")}`;
  return { chain, overlayX, overlayY, hasAlphaAnim: needsAlpha };
}

function audioChain(a: AudioLayer, inputIdx: number): string {
  const f: string[] = [
    `atrim=start=${n(a.inPoint)}:end=${n(a.inPoint + a.duration * a.speed)}`,
    "asetpts=PTS-STARTPTS",
    ...atempoChain(a.speed),
  ];
  if (a.volume !== 1) f.push(`volume=${n(a.volume)}`);
  if (a.fadeIn > 0) f.push(`afade=t=in:st=0:d=${n(Math.min(a.fadeIn, a.duration))}`);
  if (a.fadeOut > 0) f.push(`afade=t=out:st=${n(Math.max(0, a.duration - a.fadeOut))}:d=${n(Math.min(a.fadeOut, a.duration))}`);
  f.push("aformat=sample_rates=48000:channel_layouts=stereo");
  const ms = Math.max(0, Math.round(a.start * 1000));
  if (ms > 0) f.push(`adelay=${ms}|${ms}`);
  return `[${inputIdx}:a]${f.join(",")}`;
}

export function compileRenderPlan(plan: RenderPlan, sources: SourceMap, o: CompileOptions): CompiledPlan {
  if (!plan.ok) throw new Error(`خطة الرندر غير صالحة: ${plan.issues.filter((i) => i.severity === "error").map((i) => i.message).join("؛ ")}`);
  const { width: W, height: H, fps, duration: T } = plan;
  const parts: string[] = [];
  const inputArgs: string[] = [];
  const inputIndex = new Map<string, number>();
  const inputPaths: string[] = [];
  const addInput = (key: string): number => {
    const have = inputIndex.get(key);
    if (have !== undefined) return have;
    const src = sources[key];
    const idx = inputPaths.length;
    inputPaths.push(src.path);
    if (src.kind === "image") inputArgs.push("-loop", "1", "-framerate", String(fps), "-t", n(T + 1, 3), "-i", src.path);
    else inputArgs.push("-i", src.path);
    inputIndex.set(key, idx);
    return idx;
  };

  // ---- الفيديو: لوحة سوداء ثم طبقات بترتيب المسارات ----
  parts.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${n(T, 3)},format=yuv420p[base]`);
  let last = "base";
  plan.layers.forEach((l, i) => {
    const idx = addInput(l.sourceKey);
    const built = videoLayerChain(l, plan, idx);
    parts.push(`${built.chain}[L${i}]`);
    const end = l.start + l.duration + l.holdTail;
    const out = `O${i}`;
    parts.push(
      `[${last}][L${i}]overlay=x='${built.overlayX}':y='${built.overlayY}':eval=frame:enable='between(t,${n(l.start)},${n(end)})':eof_action=pass:format=auto[${out}]`
    );
    last = out;
  });

  const finalOps: string[] = [`fps=${fps}`];
  if (o.videoStabilize) finalOps.push("deshake=rx=16:ry=16:edge=mirror");
  if (o.gradingFilter) finalOps.push(o.gradingFilter);
  const hasText = plan.subtitles.length > 0 || plan.overlays.length > 0;
  const assFilename = hasText ? "subs.ass" : null;
  if (assFilename) finalOps.push(`subtitles=${assFilename}`);
  finalOps.push("format=yuv420p");
  parts.push(`[${last}]${finalOps.join(",")}[vout]`);

  // ---- الصوت: ناقلان (voice/music) + خفض اختياري + مزج + تطبيع ----
  const voice: string[] = [];
  const music: string[] = [];
  plan.audio.forEach((a, i) => {
    const idx = addInput(a.sourceKey);
    parts.push(`${audioChain(a, idx)}[A${i}]`);
    (a.bus === "voice" ? voice : music).push(`[A${i}]`);
  });
  const bus = (labels: string[], name: string): string | null => {
    if (labels.length === 0) return null;
    parts.push(`${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0:dropout_transition=0[${name}]`);
    return name;
  };
  const vbus = bus(voice, "vbus");
  let mbus = bus(music, "mbus");
  const mixInputs: string[] = [];
  if (vbus) {
    if (mbus && plan.mix.ducking.enabled) {
      // الصوت البشري يتحكّم (sidechain) بضاغط الموسيقى: تنخفض أثناء الكلام وتعود بعده.
      const ratio = Math.min(20, Math.max(2, plan.mix.ducking.amountDb / 1.5));
      // الحقن الجانبي يُمدَّد بصمت إلى طول التايملاين: sidechaincompress ينتهي بأقصر مدخليه.
      parts.push(`[${vbus}]asplit=2[vsc0][vmix]`);
      parts.push(`[vsc0]apad=whole_dur=${n(T, 3)}[vsc]`);
      parts.push(`[${mbus}][vsc]sidechaincompress=threshold=0.02:ratio=${n(ratio, 2)}:attack=40:release=500:makeup=1[mduck]`);
      mixInputs.push("[vmix]", "[mduck]");
      mbus = null;
    } else {
      mixInputs.push(`[${vbus}]`);
    }
  }
  if (mbus) mixInputs.push(`[${mbus}]`);
  // قاعدة صمت بطول التايملاين: تضمن مساراً صوتياً دائماً بالمدة الصحيحة.
  parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${n(T, 3)}[asil]`);
  mixInputs.push("[asil]");
  const tail = [`atrim=duration=${n(T, 3)}`];
  if (plan.mix.normalize && plan.audio.length > 0) {
    tail.push(`loudnorm=I=${n(plan.mix.targetLufs, 1)}:TP=-1.5:LRA=11`, "aresample=48000");
  }
  tail.push("aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo");
  parts.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=longest:normalize=0:dropout_transition=0,${tail.join(",")}[aout]`);

  const filterComplex = parts.join(";");
  const { crf, preset } = o.encoderOverride ?? QUALITY_CRF[o.quality] ?? QUALITY_CRF.standard;
  const codec = FORMAT_CODEC[o.format] || FORMAT_CODEC.mp4;
  const args = [
    "-y",
    ...inputArgs,
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", "[aout]",
    "-t", n(T, 3),
    "-r", String(fps),
    ...(o.useNvenc
      ? ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", String(crf)]
      : [
          "-c:v", codec.video,
          "-crf", String(codec.video === "libvpx-vp9" ? crf * 2 : crf),
          ...(codec.video !== "libvpx-vp9" ? ["-preset", preset] : ["-b:v", "0"]),
        ]),
    "-c:a", codec.audio,
    "-b:a", "192k",
    ...codec.extraArgs,
    "-progress", "pipe:1",
    "-nostats",
    o.outputPath,
  ];
  return {
    args,
    filterComplex,
    ass: hasText ? buildAss(plan.subtitles, plan.overlays, W, H) : null,
    assFilename,
    totalDuration: T,
    width: W,
    height: H,
    segmentCount: plan.layers.length,
    inputs: inputPaths,
  };
}
