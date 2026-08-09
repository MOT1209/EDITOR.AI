"""وكيل المحلل — Data & Emotion Analyst.

المسؤوليات (العقد الكامل — يُنفَّذ بالكامل في ممر لاحق):
1. التفريغ الصوتي Whisper مع توقيتات كلمة-بكلمة (word-level timestamps).
2. تمييز المتحدثين (Speaker Diarization — e.g. pyannote).
3. خريطة الصمت (silences > 0.3s) — **منفّذ الآن** عبر ffmpeg silencedetect.
4. تتبع الوجه (MediaPipe) لتغذية أحداث CropZoomEvent للقص الذكي 9:16.
5. فحص بيانات المصدر (المدة/الدقة/fps) — **منفّذ الآن** عبر ffmpeg -i.

التنفيذ في هذا الممر: الخطوات 3 و5 حقيقية وقابلة للتشغيل، بينما 1 و2 و4
معلّقة برفع NotImplementedError تُلتقط داخلياً كتحذيرات في التقرير حتى لا
يتعطل المسار — والمخرجات تمر عبر بوابة ``validate_analyst`` في validation.py.
"""
from __future__ import annotations

import asyncio
import re
import subprocess
from typing import List, Optional

from src.agents.edl_schema import (
    AnalystReport,
    FaceTrack,
    QualityInfo,
    SilenceSpan,
    SpeakerSegment,
    WordTiming,
)
from src.agents.registry import register_agent
from src.agents.utils import get_logger, resolve_ffmpeg

MIN_SILENCE_SECONDS = 0.3  # متطلب: silences > 0.3s
SILENCE_NOISE_DB = -25  # نفس عتبة طبقة Next.js


@register_agent("analyst")
class AnalystAgent:
    """محلل البيانات والانفعالات — واجهة موحّدة تنفّذها المديرة التنفيذية."""

    STAGE = "analyst"

    def __init__(
        self,
        llm: Optional[object] = None,
        verbose: bool = False,
        ffmpeg: Optional[str] = None,
    ) -> None:
        self.logger = get_logger("analyst")
        self.llm = llm  # يُستخدم لاحقاً لتحليل الانفعالات واللقطات (غير مطلوب الآن)
        self.verbose = verbose
        self.ffmpeg = ffmpeg or resolve_ffmpeg()

    # ------------------------------------------------------------------
    # عقد التنفيذ (تستدعيه المديرة التنفيذية)
    # ------------------------------------------------------------------

    async def execute(self, ctx: object, prior: dict) -> AnalystReport:
        """ينفّذ تحليل المصدر بشكل متزامن في مؤشر ترابط (I/O كثيف عبر subprocess)."""
        self.logger.info("تحليل المصدر: %s", ctx.source_path)
        return await asyncio.to_thread(self._analyze_sync, ctx)

    # ------------------------------------------------------------------
    # التنفيذ
    # ------------------------------------------------------------------

    def _analyze_sync(self, ctx: object) -> AnalystReport:
        warnings: List[str] = []
        meta = self._probe_source(ctx.source_path)
        silences = self._detect_silences(ctx.source_path)

        words: List[WordTiming] = []
        transcript = ""
        if getattr(ctx, "demo", False):
            # وضع تجريبي: كلمات مصنّعة للتحقق من الترجمات المتحركة بلا Whisper.
            words = _demo_words(meta["duration"])
            transcript = " ".join(w.word for w in words)
            warnings.append("وضع تجريبي (--demo): كلمات مصنّعة بدل Whisper")
        else:
            try:
                words, transcript = self.transcribe_word_level(ctx.source_path, ctx.language)
            except NotImplementedError as exc:
                warnings.append(f"التفريغ النصي معلّق: {exc}")

        speakers: List[SpeakerSegment] = []
        try:
            speakers = self.identify_speakers(ctx.source_path)
        except NotImplementedError as exc:
            warnings.append(f"تمييز المتحدثين معلّق: {exc}")

        face_tracks: List[FaceTrack] = []
        try:
            face_tracks = self.track_faces(ctx.source_path)
        except NotImplementedError as exc:
            warnings.append(f"تتبع الوجه معلّق: {exc}")

        report = AnalystReport(
            source_path=ctx.source_path,
            duration=meta["duration"],
            width=meta["width"],
            height=meta["height"],
            fps=meta["fps"],
            has_audio=meta["has_audio"],
            transcript=transcript,
            words=words,
            silences=silences,
            speakers=speakers,
            face_tracks=face_tracks,
            quality=QualityInfo(),  # تقدير لاحق عبر تحليل اللقطات
            warnings=warnings,
        )
        self.logger.info(
            "التقرير جاهز: مدة %.1fs، صمت %d فترة، كلمات %d، تحذيرات %d",
            report.duration,
            len(report.silences),
            len(report.words),
            len(report.warnings),
        )
        return report

    # ------------------------------------------------------------------
    # نقطة التوسعة 1: التفريغ النصي Whisper (كلمة-بكلمة)
    # ------------------------------------------------------------------

    def transcribe_word_level(self, source_path: str, language: str = "ar") -> tuple[list[WordTiming], str]:
        """يفرّغ الصوت عبر Whisper مع توقيتات كلمات.

        التنفيذ المقترح (ممر لاحق): ``faster-whisper`` أو Groq
        ``whisper-large-v3-turbo`` (نفس WHISPER_MODEL في تهيئة المشروع) ثم
        تحويل ``segments[].words[]`` إلى ``WordTiming``.
        """
        raise NotImplementedError("transcribe_word_level — ربط Whisper (faster-whisper أو Groq) في ممر لاحق")

    # ------------------------------------------------------------------
    # نقطة التوسعة 2: تمييز المتحدثين
    # ------------------------------------------------------------------

    def identify_speakers(self, source_path: str) -> list[SpeakerSegment]:
        """يفصل المتحدثين (Diarization) — pyannote.audio مقترح."""
        raise NotImplementedError("identify_speakers — ربط Diarization (pyannote) في ممر لاحق")

    # ------------------------------------------------------------------
    # نقطة التوسعة 3: تتبع الوجه (MediaPipe) — يغذي CropZoomEvent
    # ------------------------------------------------------------------

    def track_faces(self, source_path: str) -> list[FaceTrack]:
        """يتتبع وجه المتحدث على الزمن لإنتاج ``FaceTrack`` يستهلكه المخرج
        كأحداث قص/زوم للتحويل 16:9 ← 9:16. MediaPipe Face Mesh مقترح."""
        raise NotImplementedError("track_faces — ربط MediaPipe/OpenCV في ممر لاحق")

    # ------------------------------------------------------------------
    # أدوات ffmpeg (منفّذة)
    # ------------------------------------------------------------------

    def _probe_source(self, path: str) -> dict:
        """يستخرج المدة/الدقة/fps من مخرجات ``ffmpeg -i`` (سريع، بلا ffprobe)."""
        try:
            proc = subprocess.run(
                [self.ffmpeg, "-hide_banner", "-i", path],
                capture_output=True,
                text=True,
                timeout=30,
            )
        except FileNotFoundError as exc:
            raise RuntimeError(f"ffmpeg غير موجود: {self.ffmpeg}") from exc
        info = proc.stderr or ""

        duration = 0.0
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", info)
        if m:
            duration = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))

        width = height = 0
        m = re.search(r"(\d{2,4})x(\d{2,4})", info)
        if m:
            width, height = int(m.group(1)), int(m.group(2))

        fps = 30.0
        m = re.search(r"(\d+(?:\.\d+)?)\s*fps", info)
        if m:
            fps = float(m.group(1))

        return {
            "duration": duration,
            "width": width,
            "height": height,
            "fps": fps,
            "has_audio": "Audio:" in info,
        }

    def _detect_silences(self, path: str) -> List[SilenceSpan]:
        """يكتشف فترات الصمت (> 0.3s) عبر silencedetect — نفس عتبة طبقة Next.js."""
        try:
            proc = subprocess.run(
                [
                    self.ffmpeg,
                    "-hide_banner",
                    "-i", path,
                    "-af", f"silencedetect=noise={SILENCE_NOISE_DB}dB:d={MIN_SILENCE_SECONDS}",
                    "-f", "null", "-",
                ],
                capture_output=True,
                text=True,
                timeout=300,
            )
        except subprocess.TimeoutExpired:
            self.logger.warning("انتهت مهلة كشف الصمت (فيديو طويل؟) — سيعالج بدون خريطة صمت")
            return []
        out = proc.stderr or ""
        starts = [float(x) for x in re.findall(r"silence_start:\s*([\d.]+)", out)]
        ends = [float(x) for x in re.findall(r"silence_end:\s*([\d.]+)", out)]
        spans = []
        for i, s in enumerate(starts):
            e = ends[i] if i < len(ends) else s + MIN_SILENCE_SECONDS
            if e - s >= MIN_SILENCE_SECONDS:
                spans.append(SilenceSpan(start=s, end=e))
        return spans


def _demo_words(duration: float) -> List[WordTiming]:
    """كلمات عربية تجريبية موزعة على مدة الفيديو — لتشغيل الترجمات بلا Whisper."""
    text = "مرحبا بكم في محرر المونتاج الذكي — قص الصمت تلقائيا وإضافة الترجمات"
    words = text.split()
    step = duration / max(len(words), 1)
    return [
        WordTiming(word=w, start=i * step, end=(i + 1) * step, index=i)
        for i, w in enumerate(words)
    ]
