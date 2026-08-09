"""وكيل الرندر — Render & Style Engineer.

المسؤوليات:
1. ترجمة خطة EDL إلى أوامر ffmpeg/MoviePy قابلة للتنفيذ — **مُنفَّذ جزئياً**:
   نبني أمر ffmpeg كاملاً (trim/merge/zoompan/ترجمات ASS + ضبط صوت loudnorm).
2. اختيار المحوّل مع تسريع GPU — **مُنفَّذ**: ``select_encoder`` يختبر NVENC
   بتشفير حقيقي (درس من طبقة Next.js: قائمة ``-encoders`` تذكر المحوّل حتى
   بلا GPU — الاختبار الحقيقي هو الفيصل) ثم يتدهور إلى libx264/VP9.
3. تنفيذ الرندر الفعلي — **معلّق** في هذا الممر (يرفع NotImplementedError).

الخطة الناتجة لا تُقيّد محرّك الرندر: حقل ``render.encoder=auto`` يترك القرار
لهذا الوكيل عند التنفيذ، فلا يحجب أي تحسين GPU مستقبلي.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
from pathlib import Path
from typing import List, Optional

from src.agents.edl_schema import (
    EdlPlan,
    EncoderId,
    PlanSegment,
    QualityPreset,
    RenderPlan,
)
from src.agents.registry import register_agent
from src.agents.utils import get_logger, resolve_ffmpeg

# خريطة الجودة → (crf لمحوّل معالج، preset) — مطابقة لـ QUALITY_CRF في Next.js
QUALITY_CRF: dict[str, tuple[int, str]] = {
    "draft": (32, "veryfast"),
    "standard": (26, "fast"),
    "high": (20, "medium"),
    "ultra": (16, "slow"),
}

_nvenc_cache: Optional[bool] = None


def has_nvenc(ffmpeg: str) -> bool:
    """اختبار حقيقي لتوفر NVENC: تشفير إطار أسود صغير إلى null.

    القائمة ``-encoders`` غير كافية (تُدرج المحوّل حتى بلا GPU). التخزين المؤقت
    يجعل الفحص يحدث مرة واحدة لكل عملية.
    """
    global _nvenc_cache
    if _nvenc_cache is not None:
        return _nvenc_cache
    try:
        proc = subprocess.run(
            [
                ffmpeg,
                "-y", "-f", "lavfi", "-i", "color=black:s=64x64:d=0.2",
                "-c:v", "h264_nvenc", "-preset", "p5", "-cq", "26",
                "-f", "null", "-",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=8,
        )
        _nvenc_cache = proc.returncode == 0
    except Exception:
        _nvenc_cache = False
    return _nvenc_cache


@register_agent("render")
class RenderAgent:
    """وكيل الرندر — يبني خطة تنفيذ ffmpeg من مخطط EDL."""

    STAGE = "render"

    def __init__(
        self,
        llm: Optional[object] = None,
        verbose: bool = False,
        ffmpeg: Optional[str] = None,
    ) -> None:
        self.logger = get_logger("render")
        self.llm = llm  # غير مطلوب: قرارات الرندر برمجية (أسرع وأدق)
        self.verbose = verbose
        self.ffmpeg = ffmpeg or resolve_ffmpeg()

    # ------------------------------------------------------------------
    # عقد التنفيذ (تستدعيه المديرة التنفيذية)
    # ------------------------------------------------------------------

    async def execute(self, ctx: object, prior: dict) -> RenderPlan:
        plan: EdlPlan = prior["director"]
        self.logger.info("بناء خطة الرندر لمخطط EDL: %s", plan.title)
        return await asyncio.to_thread(self._build_sync, ctx, plan)

    def _build_sync(self, ctx: object, plan: EdlPlan) -> RenderPlan:
        encoder = self.select_encoder(plan)
        output = self._output_path(ctx, plan)
        command, filter_complex = self.build_command(plan, encoder, output)
        notes = [f"المحوّل المختار: {encoder.value}"]
        if encoder == EncoderId.NVENC:
            notes.append("تسريع GPU مفعّل (NVENC) — أسرع حتى 3x")
        else:
            notes.append("لا GPU متاح — معالجة عبر libx264")
        notes.append("الرندر الفعلي معلّق في هذا الممر (انظر RenderAgent.render)")
        rp = RenderPlan(
            output_path=output,
            encoder=encoder,
            quality=plan.render.quality,
            command=command,
            filter_complex=filter_complex,
            estimated_duration=sum((s.end - s.start) / s.speed for s in plan.segments if s.keep),
            notes=notes,
        )
        self.logger.info("خطة الرندر جاهزة: %s (%s)", output, encoder.value)
        return rp

    # ------------------------------------------------------------------
    # 1) اختيار المحوّل مع كشف GPU حقيقي
    # ------------------------------------------------------------------

    def select_encoder(self, plan: EdlPlan) -> EncoderId:
        requested = plan.render.encoder
        if requested == EncoderId.NVENC:
            return EncoderId.NVENC if has_nvenc(self.ffmpeg) else EncoderId.X264
        if requested == EncoderId.VP9:
            return EncoderId.VP9
        if requested == EncoderId.X264:
            return EncoderId.X264
        # auto: h264 مع NVENC إن توفر، وإلا libx264 (VP9 للمتصفحات عند الطلب)
        if has_nvenc(self.ffmpeg):
            return EncoderId.NVENC
        return EncoderId.X264

    # ------------------------------------------------------------------
    # 2) بناء أمر ffmpeg (دالة نقية قابلة للاختبار)
    # ------------------------------------------------------------------

    def build_command(
        self,
        plan: EdlPlan,
        encoder: EncoderId,
        output: str,
    ) -> tuple[List[str], str]:
        """يبني وسائط ffmpeg من الخطة: trim/merge للمقاطع، zoompan لأحداث القص،
        ترجمات ASS (كلمة-بكلمة يُرسم إبرازها في الترجمة)، وضبط صوت loudnorm."""
        segments = [s for s in plan.segments if s.keep]
        if not segments:
            raise ValueError("لا مقاطع إبقاء لبناء أمر الرندر")

        duration = plan.source.duration
        filter_parts: List[str] = []
        audio_labels: List[str] = []
        video_labels: List[str] = []

        for i, seg in enumerate(segments):
            vin, ain = f"v{i}", f"a{i}"
            chain_v = [f"trim=start={seg.start:.3f}:end={seg.end:.3f}", "setpts=PTS-STARTPTS"]
            if seg.speed != 1.0:
                chain_v.append(f"setpts=PTS-STARTPTS/{seg.speed}")
            if seg.crop and seg.crop.zoom > 1.0:
                # zoompan: قص رقمي نحو مركز الوجه (تبسيط عملي؛ التتبّع الكامل في
                # محلل الوجوه لاحقاً). 720p عمودي = 720x1280 مثالياً.
                z = seg.crop.zoom
                cx = seg.crop.center_x * 100.0
                cy = seg.crop.center_y * 100.0
                chain_v.append(
                    f"zoompan=z='min(zoom+0.05,{z})':x='{cx}':y='{cy}':d=1:s=720x1280:fps={plan.render.fps}"
                )
            else:
                chain_v.append(f"scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280")
            filter_parts.append(f"[0:v]{','.join(chain_v)}[{vin}]")
            video_labels.append(f"[{vin}]")

            chain_a = [f"atrim=start={seg.start:.3f}:end={seg.end:.3f}", "asetpts=PTS-STARTPTS"]
            if seg.speed != 1.0:
                chain_a.append(f"atempo={seg.speed:.4f}")
            if seg.volume != 1.0:
                chain_a.append(f"volume={seg.volume:.3f}")
            filter_parts.append(f"[0:a]{','.join(chain_a)}[{ain}]")
            audio_labels.append(f"[{ain}]")

        concat_inputs = "".join(
            f"[v{i}][a{i}]" for i in range(len(segments))
        )
        filter_parts.append(f"{concat_inputs}concat=n={len(segments)}:v=1:a=1[vcat][acat]")

        # ضبط صوت نهائي (نفس قرار طبقة Next.js: afftdn + loudnorm -16 LUFS)
        filter_parts.append(
            f"[acat]afftdn=nr=12:nf=-35,loudnorm=I={plan.render.audio_target_lufs:.1f}:TP=-1.5:LRA=11[aout]"
        )
        filter_complex = ";".join(filter_parts)

        # الوسائط النهائية
        crf, preset = QUALITY_CRF.get(plan.render.quality.value, QUALITY_CRF["standard"])
        cmd: List[str] = [self.ffmpeg, "-y", "-i", plan.source.path]
        cmd += ["-filter_complex", filter_complex, "-map", "[vcat]", "-map", "[aout]"]
        cmd += ["-t", f"{duration:.3f}", "-r", str(plan.render.fps)]
        if encoder in (EncoderId.NVENC,):
            cmd += ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", str(crf)]
        elif encoder == EncoderId.VP9:
            cmd += ["-c:v", "libvpx-vp9", "-crf", str(crf * 2), "-b:v", "0"]
        else:
            cmd += ["-c:v", "libx264", "-crf", str(crf), "-preset", preset]
        cmd += ["-c:a", "aac", "-b:a", plan.render.audio_bitrate, "-pix_fmt", "yuv420p"]
        cmd += ["-movflags", "+faststart", output]
        return cmd, filter_complex

    # ------------------------------------------------------------------
    # 3) الرندر الفعلي (معلّق في هذا الممر)
    # ------------------------------------------------------------------

    def _output_path(self, ctx: object, plan: EdlPlan) -> str:
        base = Path(getattr(ctx, "output_dir", ".montage_ai/exports"))
        base.mkdir(parents=True, exist_ok=True)
        stem = Path(plan.source.path).stem
        return str(base / f"{stem}_edited.mp4")

    async def render(self, render_plan: RenderPlan) -> dict:
        """ينفّذ أوامر ffmpeg (MoviePy أو subprocess مباشر) — ممر لاحق.

        المقترح: ``subprocess.run(command)`` مع تتبع ``-progress pipe:1``، أو
        MoviePy ``VideoFileClip`` لإتاحة مؤثرات Python فوق خطة التصدير.
        """
        raise NotImplementedError(
            "render — تنفيذ الرندر الفعلي (subprocess/MoviePy) في ممر لاحق"
        )
