"""وكيل الرندر — Render & Style Engineer.

المسؤوليات:
1. ترجمة خطة EDL إلى أوامر ffmpeg قابلة للتنفيذ — **مُنفَّذة بالكامل**:
   trim/merge + zoompan (قص رقمي 9:16) + فلاتر لونية + ترجمات ASS محروقة
   (كلمة-بكلمة بأسلوب karaoke) + ضبط صوت (afftdn + loudnorm).
2. اختيار المحوّل مع تسريع GPU — **مُنفَّذ**: ``select_encoder`` يختبر NVENC
   بتشفير حقيقي (درس من طبقة Next.js: قائمة ``-encoders`` تذكر المحوّل حتى
   بلا GPU — الاختبار الحقيقي هو الفيصل) ثم يتدهور إلى libx264/VP9.
3. تنفيذ الرندر الفعلي — **مُنفَّذ**: ``render()`` يشغّل أمر ffmpeg عبر
   subprocess مع تتبع التقدم (``-progress pipe:1``) ويحدّث حقول النتيجة
   (rendered/render_error/output_bytes/render_seconds) لتراها بوابة
   ``validate_render`` ثم المديرة التنفيذية.

الخطة لا تُقيّد محرّك الرندر: حقل ``render.encoder=auto`` يترك القرار لهذا
الوكيل عند التنفيذ، فلا يحجب أي تحسين GPU مستقبلي.
"""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
import time
from pathlib import Path
from typing import List, Optional

from src.agents.edl_schema import (
    AspectRatio,
    ColorFilterId,
    EdlPlan,
    EncoderId,
    PlanSegment,
    QualityPreset,
    RenderPlan,
)
from src.agents.registry import register_agent
from src.agents.subtitles import build_ass
from src.agents.utils import get_logger, resolve_ffmpeg

# خريطة الجودة → (crf لمحوّل معالج، preset) — مطابقة لـ QUALITY_CRF في Next.js
QUALITY_CRF: dict[str, tuple[int, str]] = {
    "draft": (32, "veryfast"),
    "standard": (26, "fast"),
    "high": (20, "medium"),
    "ultra": (16, "slow"),
}

# فلاتر لونية مطابقة لجدول Next.js (ليس مطابقاً بكسلاً لمعاينة CSS — كافٍ لأول رندر حقيقي)
COLOR_FILTER_FFMPEG: dict[str, str] = {
    "none": "",
    "cinematic": "eq=contrast=1.1:saturation=1.15:brightness=-0.03",
    "warm": "eq=saturation=1.25:gamma_r=1.05:gamma_b=0.95",
    "cool": "eq=saturation=0.9:brightness=0.03,hue=h=12",
    "vhs": "eq=contrast=1.2:saturation=0.85,hue=h=5",
    "bw": "hue=s=0",
    "vivid": "eq=saturation=1.6:contrast=1.1",
    "dreamy": "eq=brightness=0.08:saturation=1.15,gblur=sigma=1.2",
}

ASS_FILENAME = "captions.ass"  # بجوار المخرَج، يُمرَّر لـ subtitles بالاسم المجرّد (عرف Windows)

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


def output_size(aspect: Optional[AspectRatio]) -> tuple[int, int]:
    """أبعاد اللوحة القماشية حسب نسبة المخرَج (افتراضي عمودي 720x1280)."""
    if aspect == AspectRatio.LANDSCAPE:
        return 1280, 720
    if aspect == AspectRatio.SQUARE:
        return 720, 720
    return 720, 1280  # PORTRAIT أو غير محدد


@register_agent("render")
class RenderAgent:
    """وكيل الرندر — يبني خطة تنفيذ ffmpeg من مخطط EDL ثم ينفّذها فعلياً."""

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
        rp = await asyncio.to_thread(self._build_sync, ctx, plan)
        # الرندر الفعلي (نفس الممر): تنفيذ الأمر ثم تحديث حقول النتيجة
        await self.render(rp)
        return rp

    def _build_sync(self, ctx: object, plan: EdlPlan) -> RenderPlan:
        encoder = self.select_encoder(plan)
        output = self._output_path(ctx, plan)
        command, filter_complex, ass_written = self.build_command(plan, encoder, output)
        notes = [f"المحوّل المختار: {encoder.value}"]
        if encoder == EncoderId.NVENC:
            notes.append("تسريع GPU مفعّل (NVENC) — أسرع حتى 3x")
        else:
            notes.append("لا GPU متاح — معالجة عبر libx264")
        if ass_written:
            notes.append(f"ترجمات محروقة في الفيديو: {ASS_FILENAME}")
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
    ) -> tuple[List[str], str, bool]:
        """يبني وسائط ffmpeg من الخطة: trim/merge للمقاطع، zoompan لأحداث القص،
        فلاتر لونية، ترجمات ASS محروقة (كلمة-بكلمة بأسلوب karaoke)، وضبط صوت
        loudnorm. يعيد (الأمر، filter_complex، هل كُتب ملف ASS)."""
        segments = [s for s in plan.segments if s.keep]
        if not segments:
            raise ValueError("لا مقاطع إبقاء لبناء أمر الرندر")

        out_w, out_h = output_size(plan.render.target_aspect)
        has_audio = bool(plan.source.has_audio)
        filter_parts: List[str] = []
        video_labels: List[str] = []
        audio_labels: List[str] = []

        for i, seg in enumerate(segments):
            vin, ain = f"v{i}", f"a{i}"
            chain_v = [f"trim=start={seg.start:.3f}:end={seg.end:.3f}", "setpts=PTS-STARTPTS"]
            if seg.speed != 1.0:
                chain_v.append(f"setpts=PTS-STARTPTS/{seg.speed}")
            if seg.crop and seg.crop.zoom > 1.0:
                # zoompan: قص رقمي نحو مركز الوجه (إحداثيات نسبية × iw/ih — يعمل
                # مع أي دخل). التتبّع الكامل للوجه يملأ center_x/center_y لاحقاً.
                z = seg.crop.zoom
                cx, cy = seg.crop.center_x, seg.crop.center_y
                chain_v.append(
                    f"zoompan=z='min(zoom+0.05,{z})':"
                    f"x='({cx}*iw)-(iw/zoom/2)':y='({cy}*ih)-(ih/zoom/2)':"
                    f"d=1:s={out_w}x{out_h}:fps={plan.render.fps}"
                )
            else:
                chain_v.append(
                    f"scale={out_w}:{out_h}:force_original_aspect_ratio=increase,crop={out_w}:{out_h}"
                )
            color_chain = COLOR_FILTER_FFMPEG.get(seg.color_filter.value, "")
            if color_chain:
                chain_v.append(color_chain)
            filter_parts.append(f"[0:v]{','.join(chain_v)}[{vin}]")
            video_labels.append(f"[{vin}]")

            if has_audio:
                chain_a = [f"atrim=start={seg.start:.3f}:end={seg.end:.3f}", "asetpts=PTS-STARTPTS"]
                if seg.speed != 1.0:
                    chain_a.append(f"atempo={seg.speed:.4f}")
                if seg.volume != 1.0:
                    chain_a.append(f"volume={seg.volume:.3f}")
                filter_parts.append(f"[0:a]{','.join(chain_a)}[{ain}]")
                audio_labels.append(f"[{ain}]")

        # ترجمات ASS محروقة: تُكتب بجوار المخرَج وتُمرَّر بالاسم المجرّد فقط
        # (مرشح subtitles يفشل مع نقطتين في مسار Windows — نُشغّل ffmpeg بـ cwd).
        ass_path: Optional[str] = None
        if plan.style.captions and (plan.captions or plan.text_overlays):
            ass_path = str(Path(output).parent / ASS_FILENAME)
            try:
                Path(ass_path).write_text(
                    build_ass(plan, out_w, out_h), encoding="utf-8"
                )
            except OSError:
                ass_path = None  # لا توقف الرندر لملف ترجمة

        # الدمج: مع الصوت concat v+a، وبدونه v فقط
        if has_audio:
            concat_inputs = "".join(f"[v{i}][a{i}]" for i in range(len(segments)))
            filter_parts.append(f"{concat_inputs}concat=n={len(segments)}:v=1:a=1[vcat][acat]")
            filter_parts.append(
                f"[acat]afftdn=nr=12:nf=-35,loudnorm=I={plan.render.audio_target_lufs:.1f}:TP=-1.5:LRA=11[aout]"
            )
            audio_map = "[aout]"
        else:
            concat_inputs = "".join(f"[v{i}]" for i in range(len(segments)))
            filter_parts.append(f"{concat_inputs}concat=n={len(segments)}:v=1:a=0[vcat]")
            audio_map = None

        if ass_path:
            filter_parts.append(f"[vcat]subtitles={ASS_FILENAME}[vsub]")
            video_map = "[vsub]"
        else:
            video_map = "[vcat]"
        filter_complex = ";".join(filter_parts)

        # الوسائط النهائية
        crf, preset = QUALITY_CRF.get(plan.render.quality.value, QUALITY_CRF["standard"])
        cmd: List[str] = [self.ffmpeg, "-y", "-i", plan.source.path]
        cmd += ["-filter_complex", filter_complex, "-map", video_map]
        if audio_map:
            cmd += ["-map", audio_map]
        cmd += ["-r", str(plan.render.fps)]
        if encoder in (EncoderId.NVENC,):
            cmd += ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", str(crf)]
        elif encoder == EncoderId.VP9:
            cmd += ["-c:v", "libvpx-vp9", "-crf", str(crf * 2), "-b:v", "0"]
        else:
            cmd += ["-c:v", "libx264", "-crf", str(crf), "-preset", preset]
        if audio_map:
            cmd += ["-c:a", "aac", "-b:a", plan.render.audio_bitrate]
        cmd += ["-pix_fmt", "yuv420p", "-movflags", "+faststart", output]
        return cmd, filter_complex, bool(ass_path)

    # ------------------------------------------------------------------
    # 3) الرندر الفعلي (subprocess مع تتبع التقدم)
    # ------------------------------------------------------------------

    def _output_path(self, ctx: object, plan: EdlPlan) -> str:
        base = Path(getattr(ctx, "output_dir", ".montage_ai/exports"))
        base.mkdir(parents=True, exist_ok=True)
        return str(base / "final.mp4")

    async def render(self, render_plan: RenderPlan) -> RenderPlan:
        """ينفّذ أمر ffmpeg الفعلي (subprocess مع ``-progress pipe:1``) ويحدّث
        حقول النتيجة: rendered / render_error / output_bytes / render_seconds."""
        await asyncio.to_thread(self._render_sync, render_plan)
        return render_plan

    def _render_sync(self, rp: RenderPlan) -> None:
        if not rp.command:
            rp.render_error = "أمر ffmpeg فارغ — لا شيء يُنفَّذ"
            return
        # المدخل (-i) والمخرج يتحولان لمسارات مطلقة: نُشغِّل ffmpeg بـ cwd = مجلد
        # المخرَج حتى يجد مرشح subtitles ملف الترجمة بالاسم المجرّد (عرف Windows)،
        # والمسارات النسبية في الخطة تنكسر مع تغيير cwd — الإطلاق يحل المشكلة.
        output = os.path.abspath(rp.output_path)
        cmd: List[str] = []
        for i, part in enumerate(list(rp.command)):
            if part == "-i" and i + 1 < len(rp.command):
                cmd.append(part)
                cmd.append(os.path.abspath(rp.command[i + 1]))
            elif part == rp.output_path:
                cmd.append(output)
            else:
                cmd.append(part)
        # إدراج تتبع التقدم قبل مسار المخرج النهائي
        cmd = cmd[:-1] + ["-progress", "pipe:1", "-nostats", output]
        rp.output_path = output
        cwd = os.path.dirname(output) or "."
        timeout = max(300, int(rp.estimated_duration * 15) + 180)
        started = time.monotonic()
        tail: List[str] = []
        proc: Optional[subprocess.Popen] = None
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            last_pct = -1
            assert proc.stdout is not None
            for line in proc.stdout:
                tail.append(line.rstrip())
                if len(tail) > 40:
                    tail.pop(0)
                m = re.match(r"out_time_ms=(\d+)", line.strip())
                if m:
                    out_ms = int(m.group(1)) / 1e6
                    if rp.estimated_duration > 0:
                        pct = int(out_ms / rp.estimated_duration * 100)
                        if pct != last_pct and pct >= 0 and pct % 10 == 0:
                            last_pct = pct
                            self.logger.info(
                                "الرندر %d%% (%.0fs من %.0fs)",
                                pct, out_ms, rp.estimated_duration,
                            )
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            if proc is not None:
                proc.kill()
            rp.render_error = f"انتهت مهلة الرندر ({timeout}s)"
            self.logger.error("الرندر تجاوز المهلة (%ss)", timeout)
            return
        except Exception as exc:  # noqa: BLE001 — أي فشل تشغيل يُبلَّغ للبوابة
            if proc is not None:
                proc.kill()
            rp.render_error = f"{type(exc).__name__}: {exc}"
            self.logger.error("فشل تشغيل الرندر: %s", exc)
            return

        rp.render_seconds = round(time.monotonic() - started, 2)
        if proc is not None and proc.returncode == 0 and os.path.exists(rp.output_path):
            rp.rendered = True
            rp.output_bytes = os.path.getsize(rp.output_path)
            self.logger.info(
                "الرندر اكتمل: %s (%.1fMB في %.1fs)",
                rp.output_path, rp.output_bytes / 1e6, rp.render_seconds,
            )
        else:
            detail = "\n".join(tail[-8:])
            rp.render_error = (
                f"فشل ffmpeg (رمز {proc.returncode if proc else '?'}): {detail[:400]}"
            )
            self.logger.error("الرندر فشل: %s", rp.render_error)
