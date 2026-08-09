# -*- coding: utf-8 -*-
"""وكيل مهندس الصوت (Audio Engineer) — خطة الصوت والموسيقى للخطة المعتمدة.

الدور:
- يحوّل قرارات المخرج الصوتية (``plan.style.music_mood`` / ``music_volume``)
  إلى ``AudioPlan`` قابلة للرندر: مواصفات مسار الموسيقى (BPM/طاقة/أنواع)،
  أحداث Ducking (خفض الموسيقى تحت الكلام تلقائياً)، مؤثرات صوتية عند
  انتقالات القص، ومستوى ضبط الصوت (LUFS) — دون إلزام أي محرّك.
- مصدر الكلام للـ Ducking: كلمات Whisper من المحلل (``report.words``) إن
  وُجدت، أو نطاقات أسطر الترجمة (``plan.captions``) كبديل أنيق.
- ``music_path``: إذا وفّر التطبيق ملف موسيقى محلي، يتضخم أمر الرندر بإدخال
  موسيقى + sidechain compress (راجع ``RenderAgent._enrich_with_music``)؛
  بلا ملف تبقى الخطة مواصفة (تدهور أنيق — لا يتوقف المسار).

التدهور الأنيق: الحسابات كلها محلية حتمية — لا crewai ولا LLM ولا إنترنت.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import List, Optional

from pydantic import Field

from src.agents.edl_schema import (
    AnalystReport,
    EdlBase,
    EdlPlan,
    MusicMood,
    OverlayPosition,
)
from src.agents.registry import register_agent
from src.agents.utils import get_logger

# تسامح فجوة الكلام عند تجميع النطاقات (ثوانٍ)
SPEECH_GAP_TOLERANCE = 0.5
# أقصى مدة لنطاق كلام واحد قبل التقسيم (ثوانٍ)
MAX_SPEECH_SPAN = 20.0
# مقدار خفض الموسيقى الافتراضي تحت الكلام (dB)
DEFAULT_DUCK_DB = 6.0


class MusicTrackSpec(EdlBase):
    """مواصفة مسار الموسيقى — من يبحث/يولّد الموسيقى يلتزم بها.

    ``path`` يُملأ عند توفر ملف محلي فيتضخم أمر الرندر فعلياً (sidechain ducking).
    """

    mood: MusicMood = MusicMood.POWERFUL
    bpm: int = 128
    energy: float = 0.7
    genres: List[str] = Field(default_factory=list)
    path: Optional[str] = None
    volume: float = 0.5


class DuckingEvent(EdlBase):
    """نافذة خفض الموسيقى تحت الكلام — تُترجم لاحقاً إلى sidechain/volume automation."""

    start: float
    end: float
    duck_db: float = DEFAULT_DUCK_DB
    attack_ms: int = 120
    release_ms: int = 350


class SoundFxSuggestion(EdlBase):
    """مؤثر صوتي مقترح عند نقطة معينة (انتقال قص، Hook...)."""

    kind: str
    start: float
    end: float
    reason: str = ""


class AudioPlan(EdlBase):
    """مُخرَج وكيل الصوت — يُحفظ في ``pipeline/<job>/audio.json``."""

    music: MusicTrackSpec = Field(default_factory=MusicTrackSpec)
    ducking: List[DuckingEvent] = Field(default_factory=list)
    fx: List[SoundFxSuggestion] = Field(default_factory=list)
    loudness_lufs: float = -16.0
    voice_boost_db: float = 2.0
    music_path: Optional[str] = None
    notes: List[str] = Field(default_factory=list)


# ملفات تعريف المزاج: (BPM, الطاقة 0..1, الأنواع الموسيقية)
_MOOD_PROFILE: dict[str, tuple[int, float, list[str]]] = {
    MusicMood.POWERFUL.value: (128, 0.85, ["epic", "trap", "edm"]),
    MusicMood.INSPIRING.value: (120, 0.7, ["cinematic", "ambient", "piano"]),
    MusicMood.HAPPY.value: (124, 0.75, ["pop", "ukulele", "upbeat"]),
    MusicMood.RELAXING.value: (90, 0.35, ["lo-fi", "ambient", "soft"]),
    MusicMood.PROFESSIONAL.value: (100, 0.5, ["corporate", "minimal", "tech"]),
    MusicMood.DREAMY.value: (100, 0.45, ["synthwave", "chill", "dream"]),
    MusicMood.TENSE.value: (140, 0.9, ["dark", "percussion", "drum"]),
    MusicMood.WARM.value: (105, 0.55, ["acoustic", "folk", "warm"]),
}


@register_agent("audio")
class AudioAgent:
    """مهندس الصوت — يبني خطة الموسيقى والـ Ducking والمؤثرات من خطة EDL."""

    STAGE = "audio"

    def __init__(self, llm: Optional[object] = None, verbose: bool = False) -> None:
        self.logger = get_logger("audio")
        self.llm = llm
        self.verbose = verbose

    async def execute(self, ctx: object, prior: dict) -> AudioPlan:
        """يستخرج خطة الصوت من خطة EDL المعتمدة (لا LLM — حسابات حتمية)."""
        plan: EdlPlan = prior.get("director")
        if plan is None:
            raise ValueError("مهندس الصوت يحتاج خطة EDL في prior['director']")
        report: Optional[AnalystReport] = prior.get("analyst") or None
        self.logger.info(
            "بناء خطة الصوت لـ «%s» (مزاج: %s)",
            plan.title, plan.style.music_mood.value,
        )
        result = await asyncio.to_thread(self._build_sync, ctx, plan, report)
        self.logger.info(
            "الصوت جاهز: %d نطاق Ducking | %d مؤثر | موسيقى %d BPM",
            len(result.ducking), len(result.fx), result.music.bpm,
        )
        return result

    def _build_sync(self, ctx: object, plan: EdlPlan, report: Optional[AnalystReport]) -> AudioPlan:
        mood = plan.style.music_mood
        bpm, energy, genres = _MOOD_PROFILE.get(
            mood.value if isinstance(mood, MusicMood) else str(mood),
            (120, 0.6, ["ambient"]),
        )
        music = MusicTrackSpec(
            mood=mood if isinstance(mood, MusicMood) else MusicMood.POWERFUL,
            bpm=bpm,
            energy=energy,
            genres=genres,
            volume=max(0.0, min(1.0, plan.style.music_volume or 0.5)),
        )

        speech_spans = self._speech_spans(plan, report)
        ducking = [DuckingEvent(start=s, end=e) for s, e in speech_spans]

        fx: List[SoundFxSuggestion] = []
        keeps = [s for s in plan.segments if s.keep]
        for prev, nxt in zip(keeps, keeps[1:]):
            if nxt.start - prev.end < 0.05:
                fx.append(SoundFxSuggestion(
                    kind="whoosh",
                    start=nxt.start,
                    end=nxt.start + 0.35,
                    reason="انتقال قص سريع — whoosh خفيف",
                ))
        if report is not None:
            for h in report.highlights[:5]:
                fx.append(SoundFxSuggestion(
                    kind="riser",
                    start=max(0.0, h.start - 0.5),
                    end=h.start + 0.3,
                    reason=f"لحظة مميزة ({h.reason[:40]}) — riser قبلها",
                ))

        music_path = self._find_local_music(ctx, plan)
        if music_path:
            music.path = music_path
        loudness = plan.render.audio_target_lufs if plan.render else -16.0

        notes: List[str] = [
            f"موسيقى {music.bpm} BPM (طاقة {music.energy:.0%}) — مزاج «{music.mood.value}»",
            f"{len(ducking)} نافذة Ducking (خفض {DEFAULT_DUCK_DB}dB تحت الكلام)",
            f"الضبط النهائي {loudness:.0f} LUFS (معيار السوشال ميديا)",
        ]
        if music_path:
            notes.append(f"مسار موسيقى محلي سيُدمج عند الرندر: {music_path}")
        else:
            notes.append("لا ملف موسيقى محلي — الخطة مواصفة تُستهلك عند توفر مصدر")

        return AudioPlan(
            music=music,
            ducking=ducking,
            fx=fx,
            loudness_lufs=loudness,
            voice_boost_db=2.0 if (report is None or report.has_audio) else 0.0,
            music_path=music_path,
            notes=notes,
        )

    def _speech_spans(self, plan: EdlPlan, report: Optional[AnalystReport]) -> List[tuple[float, float]]:
        """نطاقات الكلام (بداية، نهاية) لتوجيه الـ Ducking — تجميع كلمات متقاربة.

        أولوية: ``report.words`` (كلمة-بكلمة من Whisper)، ثم نطاقات الترجمة.
        """
        spans: List[tuple[float, float]] = []
        if report is not None and report.words:
            words = sorted((w for w in report.words if w.end > w.start), key=lambda w: w.start)
            if words:
                cur_s, cur_e = words[0].start, words[0].end
                for w in words[1:]:
                    if w.start - cur_e <= SPEECH_GAP_TOLERANCE and cur_e - cur_s < MAX_SPEECH_SPAN:
                        cur_e = max(cur_e, w.end)
                    else:
                        spans.append((cur_s, cur_e))
                        cur_s, cur_e = w.start, w.end
                spans.append((cur_s, cur_e))
                return spans
        # بديل أنيق: نطاقات أسطر الترجمة
        for line in plan.captions:
            if line.end > line.start:
                spans.append((line.start, line.end))
        return self._merge_spans(spans)

    def _merge_spans(self, spans: List[tuple[float, float]]) -> List[tuple[float, float]]:
        """يدمج النطاقات المتقاربة (الفجوة <= التسامح) للحصول على كتل كلام مستمرة."""
        if not spans:
            return []
        ordered = sorted(spans, key=lambda t: t[0])
        merged: List[tuple[float, float]] = [ordered[0]]
        for s, e in ordered[1:]:
            ps, pe = merged[-1]
            if s <= pe + SPEECH_GAP_TOLERANCE:
                merged[-1] = (ps, max(pe, e))
            else:
                merged.append((s, e))
        return merged

    def _find_local_music(self, ctx: object, plan: EdlPlan) -> Optional[str]:
        """يبحث عن ملف موسيقى محلي في مجلدات المشروع (اختياري — None افتراضياً).

        الأعراف: ``<output_dir>/../music/`` ثم ``.montage_ai/music/`` إن وُجدت.
        لا يُفشل المسار عند الغياب — الخطة تبقى مواصفة.
        """
        output_dir = Path(getattr(ctx, "output_dir", ".montage_ai/exports"))
        candidates = [
            output_dir.parent / "music" / "track.mp3",
            output_dir.parent / "music" / "track.m4a",
            Path(".montage_ai/music/track.mp3"),
            Path(".montage_ai/music/track.m4a"),
        ]
        for candidate in candidates:
            if candidate.exists():
                return str(candidate)
        return None
