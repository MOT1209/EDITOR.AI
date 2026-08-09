"""مخطط EDL الموحّد (Edit Decision List) — العقد المشترك بين جميع الوكلاء.

التصميم:
- حقول Python بأسلوب snake_case، بينما تُسلسَل JSON بحقول camelCase مطابقة
  لمخطط TypeScript في ``lib/agents/types.ts`` — أي خطة EDL ناتجة عن هذه الحزمة
  يمكن استهلاكها مباشرة من محرر Next.js والعكس (توافق ثنائي الاتجاه).
- مخطط فائق (superset) يحمل المتطلبات المميزة للفيديو العمودي القصير:
  * ``captions[].words`` — توقيتات كلمة-بكلمة لقيادة الترجمات المتحركة (Hormozi).
  * ``segments[].crop`` — أحداث قص/زوم (تتبع وجه لاحقاً) للتحويل 16:9 ← 9:16.
  * ``segments[].b_roll`` + ``b_roll[]`` — اقتراحات B-Roll بكلمات مفتاحية وأصول جاهزة (Pexels).
  * ``render`` — تلميحات رندر (NVENC/CUDA) دون إلزام أي محرّك: ``auto`` يعني
    أن وكيل الرندر يكتشف بنفسه توفر GPU ويتدهور إلى libx264 تلقائياً.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

logger = logging.getLogger(__name__)


class EdlBase(BaseModel):
    """أساس كل نماذج EDL: camelCase في JSON، قبول الاسمين، تجاهل الحقول الإضافية
    (لمرونة مخرجات LLM دون كسر التحقق)."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
    )


# --------------------------------------------------------------------------
# قيم مطابقة حرفياً لمخطط TypeScript (lib/agents/types.ts)
# --------------------------------------------------------------------------

class ColorFilterId(str, Enum):
    NONE = "none"
    CINEMATIC = "cinematic"
    WARM = "warm"
    COOL = "cool"
    VHS = "vhs"
    BW = "bw"
    VIVID = "vivid"
    DREAMY = "dreamy"


class MusicMood(str, Enum):
    INSPIRING = "ملهم"
    RELAXING = "مريح"
    HAPPY = "سعيد"
    TENSE = "متوتر"
    PROFESSIONAL = "احترافي"
    DREAMY = "حالم"
    POWERFUL = "قوي"
    WARM = "دافئ"


class CaptionStyle(str, Enum):
    DEFAULT = "default"
    BOLD = "bold"
    HIGHLIGHT = "highlight"
    KARAOKE = "karaoke"


class OverlayPosition(str, Enum):
    TOP = "top"
    CENTER = "center"
    BOTTOM = "bottom"


class AspectRatio(str, Enum):
    LANDSCAPE = "16:9"
    PORTRAIT = "9:16"
    SQUARE = "1:1"


class BrollProvider(str, Enum):
    PEXELS = "pexels"
    UNSPLASH = "unsplash"
    NONE = "none"


class EncoderId(str, Enum):
    AUTO = "auto"
    NVENC = "h264_nvenc"
    X264 = "libx264"
    VP9 = "libvpx-vp9"


class QualityPreset(str, Enum):
    DRAFT = "draft"
    STANDARD = "standard"
    HIGH = "high"
    ULTRA = "ultra"


# --------------------------------------------------------------------------
# نماذج داعمة
# --------------------------------------------------------------------------

class WordTiming(EdlBase):
    """كلمة واحدة بتوقيت مطلق (ثوانٍ) — الوحدة الأساسية للترجمات المتحركة."""

    word: str
    start: float
    end: float
    index: int = 0  # الترتيب العالمي للكلمة في التفريغ

    @field_validator("end")
    @classmethod
    def _end_ge_start(cls, v: float, info: Any) -> float:
        start = info.data.get("start")
        if start is not None and v < start:
            return float(start)
        return v


class CaptionLine(EdlBase):
    """سطر ترجمة كامل مع توقيتات كلماته (يقود إبراز كلمة-بكلمة عند الرندر)."""

    text: str
    start: float
    end: float
    words: List[WordTiming] = Field(default_factory=list)
    style: CaptionStyle = CaptionStyle.HIGHLIGHT
    position: OverlayPosition = OverlayPosition.BOTTOM
    speaker: Optional[str] = None  # تسمية المتحدث (من تمييز المتحدثين) — لتلوين الترجمة

    @field_validator("end")
    @classmethod
    def _end_ge_start(cls, v: float, info: Any) -> float:
        start = info.data.get("start")
        if start is not None and v < start:
            return float(start)
        return v


class CropZoomEvent(EdlBase):
    """حدث قص/زوم ضمن مقطع — مصدره تتبع وجه (analyst) أو قرار المخرج.

    الإحداثيات نسبية (0..1): center_x=0.5 يعني منتصف العرض الأصلي.
    zoom=1.0 يبقي الإطار كاملاً؛ zoom>1 يقرّب (يُستخدم للتحويل 9:16).
    """

    start: float = 0.0  # يتوارث حدود المقطع عند التطبيع إن تُرك صفراً
    end: float = 0.0
    center_x: float = 0.5
    center_y: float = 0.42  # افتراضي: وجه المتحدث أعلى المنتصف قليلاً
    zoom: float = 1.0
    ease: str = "ease_in_out"  # متسامح: يقبل easeInOutQuad ثم يُوحَّد
    source: str = "default"  # متسامح: "source" → default

    @field_validator("ease")
    @classmethod
    def _normalize_ease(cls, v: str) -> str:
        table = {
            "linear": "linear",
            "easein": "linear",
            "easeout": "ease_out",
            "easeoutquad": "ease_out",
            "easeinout": "ease_in_out",
            "easeinoutquad": "ease_in_out",
            "easeinquad": "linear",
        }
        return table.get(str(v).lower().replace("_", "").replace("-", ""), "ease_in_out")

    @field_validator("source")
    @classmethod
    def _normalize_source(cls, v: str) -> str:
        normalized = str(v).lower().replace("-", "_")
        if normalized not in ("face_track", "llm", "default"):
            return "default"
        return normalized

    @field_validator("center_x", "center_y")
    @classmethod
    def _clamp_center(cls, v: float) -> float:
        return max(0.0, min(1.0, v))

    @field_validator("zoom")
    @classmethod
    def _min_zoom(cls, v: float) -> float:
        return max(1.0, v)


class BrollSuggestion(EdlBase):
    """اقتراح B-Roll: المخرج يحدد الكلمات المفتاحية والفترة؛ الأصل يُجلب لاحقاً
    (Pexels/Unsplash) ولا يُشترط وجوده في المخطط حتى يعمل المسار بلا إنترنت."""

    id: str = ""  # يُملأ تلقائياً عند التطبيع (broll_<n>)
    keywords: List[str] = Field(default_factory=list)
    provider: BrollProvider = BrollProvider.PEXELS
    asset_id: Optional[str] = None
    asset_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    start: float = 0.0
    end: float = 0.0
    duration: float = 3.0  # طول اللقطة المطلوب
    reason: str = ""  # سبب الجلب (قطع الملل / توضيح المفهوم...)


class PlanSegment(EdlBase):
    """مقطع خطة القص — يطابق PlanSegment في TypeScript مع إضافات الجيل الجديد."""

    start: float
    end: float
    keep: bool
    speed: float = 1.0
    volume: float = 1.0
    reason: str = ""
    color_filter: ColorFilterId = ColorFilterId.NONE
    crop: Optional[CropZoomEvent] = None
    b_roll: Optional[BrollSuggestion] = None

    @field_validator("speed")
    @classmethod
    def _clamp_speed(cls, v: float) -> float:
        return max(0.25, min(4.0, v))

    @field_validator("volume")
    @classmethod
    def _clamp_volume(cls, v: float) -> float:
        return max(0.0, min(2.0, v))


class PlanOverlay(EdlBase):
    """نص توضيحي فوق الفيديو (توافق مع PlanOverlay في TypeScript)."""

    text: str
    start: float
    end: float
    position: OverlayPosition = OverlayPosition.TOP


class VideoStyle(EdlBase):
    """الأسلوب البصري والصوتي للخطة (يطابق style في DirectorPlan)."""

    color_filter: ColorFilterId = ColorFilterId.NONE
    music_mood: MusicMood = MusicMood.INSPIRING
    captions: bool = True
    caption_style: CaptionStyle = CaptionStyle.HIGHLIGHT
    music_volume: float = 0.5

    @field_validator("music_volume")
    @classmethod
    def _clamp(cls, v: float) -> float:
        return max(0.0, min(1.0, v))


class RenderHints(EdlBase):
    """تلميحات الرندر — اقتراحات فقط لا قيود؛ وكيل الرندر يقرر المسار النهائي
    (يرصد NVENC/CUDA بنفسه ويتدهور إلى معالج عند الغياب)."""

    encoder: EncoderId = EncoderId.AUTO
    quality: QualityPreset = QualityPreset.STANDARD
    target_aspect: Optional[AspectRatio] = None  # None = نفس المصدر
    fps: int = 30
    audio_bitrate: str = "192k"
    audio_target_lufs: float = -16.0  # معيار السوشال ميديا
    crf: Optional[int] = None  # None = حسب الجودة
    preset: Optional[str] = None  # None = حسب المحوّل


class EdlSource(EdlBase):
    """بيانات الفيديو المصدر (مخرج وكيل المحلل)."""

    path: str
    duration: float
    width: int = 0
    height: int = 0
    fps: float = 30.0
    aspect: AspectRatio = AspectRatio.LANDSCAPE
    has_audio: bool = True


class SilenceSpan(EdlBase):
    """فترة صمت مكتشفة (>= 0.3 ثانية بحسب متطلبات المحلل)."""

    start: float
    end: float


class SpeakerSegment(EdlBase):
    """مقطع متحدث (تمييز المتحدثين — محلل لاحق)."""

    start: float
    end: float
    label: str = "speaker_0"
    confidence: float = 0.0


class FaceTrack(EdlBase):
    """مسار وجه متحدث عبر الزمن — يغذي CropZoomEvent للقص الذكي 9:16."""

    start: float
    end: float
    center_x: float = 0.5
    center_y: float = 0.42
    size: float = 0.3  # حجم الوجه نسبةً لعرض الإطار


class SceneInfo(EdlBase):
    """مشهد بصري مكتشف (تحليل لقطات — يوفر اقتراح Highlights)."""

    start: float
    end: float
    score: float = 0.5
    description: Optional[str] = None


class HighlightInfo(EdlBase):
    """لحظة مميزة (Hook) يقترحها المحلل/المخرج."""

    start: float
    end: float
    reason: str = ""


class QualityInfo(EdlBase):
    """جودة بصريّة مُقدّرة 0..1."""

    brightness: float = 0.6
    contrast: float = 0.6
    saturation: float = 0.6
    sharpness: float = 0.6


class AnalystReport(EdlBase):
    """مُخرَج وكيل المحلل (Data & Emotion Analyst) — المدخل الأساسي للمخرج."""

    source_path: str
    duration: float
    width: int = 0
    height: int = 0
    fps: float = 30.0
    has_audio: bool = True
    transcript: str = ""
    words: List[WordTiming] = Field(default_factory=list)
    silences: List[SilenceSpan] = Field(default_factory=list)
    speakers: List[SpeakerSegment] = Field(default_factory=list)
    face_tracks: List[FaceTrack] = Field(default_factory=list)
    scenes: List[SceneInfo] = Field(default_factory=list)
    highlights: List[HighlightInfo] = Field(default_factory=list)
    quality: QualityInfo = Field(default_factory=QualityInfo)
    warnings: List[str] = Field(default_factory=list)


class RenderPlan(EdlBase):
    """مُخرَج وكيل الرندر: أوامر ffmpeg قابلة للتنفيذ + قرار المحوّل + نتيجة الرندر."""

    output_path: str
    encoder: EncoderId = EncoderId.AUTO
    quality: QualityPreset = QualityPreset.STANDARD
    command: List[str] = Field(default_factory=list)  # وسائط ffmpeg كاملة
    filter_complex: str = ""
    estimated_duration: float = 0.0
    notes: List[str] = Field(default_factory=list)
    # حقول نتيجة الرندر الفعلي (يملؤها ``RenderAgent.render``)
    rendered: bool = False
    render_error: Optional[str] = None
    output_bytes: Optional[int] = None
    render_seconds: float = 0.0


# --------------------------------------------------------------------------
# الخطة الرئيسية
# --------------------------------------------------------------------------

class EdlPlan(EdlBase):
    """خطة المونتاج الكاملة (مخطط EDL) — العقد الذي يتعامل معه جميع الوكلاء.

    حقول إضافية فوق DirectorPlan في TypeScript: ``source``، ``captions`` (كلمة-بكلمة)،
    ``b_roll``، ``render``، ``metadata`` — مع بقاء الحقول الأصلية متطابقة تماماً.
    """

    version: str = "1.0"
    title: str = "خطة المونتاج"
    description: str = ""
    tags: List[str] = Field(default_factory=list)
    summary: str = ""
    source: EdlSource
    style: VideoStyle = Field(default_factory=VideoStyle)
    segments: List[PlanSegment] = Field(default_factory=list)
    text_overlays: List[PlanOverlay] = Field(default_factory=list)
    captions: List[CaptionLine] = Field(default_factory=list)
    b_roll: List[BrollSuggestion] = Field(default_factory=list)
    render: RenderHints = Field(default_factory=RenderHints)
    metadata: Dict[str, Any] = Field(default_factory=dict)


# --------------------------------------------------------------------------
# فحص وتطبيع الخطة (يستخدمهما المخرج ومديرة الجودة)
# --------------------------------------------------------------------------

@dataclass
class PlanValidation:
    """نتيجة بوابة الجودة على خطة EDL."""

    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def merge(self, other: "PlanValidation") -> "PlanValidation":
        return PlanValidation(
            errors=self.errors + other.errors,
            warnings=self.warnings + other.warnings,
        )


def validate_plan(plan: EdlPlan) -> PlanValidation:
    """بوابة الجودة على الخطة: أخطاء قاتلة تمنع المسار + تحذيرات إرشادية."""
    errors: List[str] = []
    warnings: List[str] = []
    dur = plan.source.duration if plan.source else 0.0

    if not plan.segments:
        errors.append("الخطة بلا مقاطع (segments فارغ)")
        return PlanValidation(errors, warnings)

    keeps = [s for s in plan.segments if s.keep]
    if not keeps:
        errors.append("الخطة لا تحتوي أي مقطع إبقاء (keep=true) — الناتج سيكون فارغاً")

    for s in plan.segments:
        if s.end - s.start < 0.05:
            errors.append(f"مقطع صفري/معكوس: [{s.start:.2f} → {s.end:.2f}]")
        if dur > 0 and (s.start < -0.001 or s.end > dur + 0.001):
            errors.append(f"مقطع خارج حدود المصدر: [{s.start:.2f} → {s.end:.2f}] vs مدة {dur:.2f}")

    ordered = sorted(plan.segments, key=lambda s: s.start)
    for prev, nxt in zip(ordered, ordered[1:]):
        if nxt.start < prev.end - 1e-6:
            errors.append(f"تداخل مقاطع عند {nxt.start:.2f}s")

    if dur > 0:
        covered = _covered_seconds(ordered, dur)
        if covered < dur * 0.95:
            warnings.append(f"تغطية الخطة {covered:.1f}s من {dur:.1f}s — توجد فجوات تُسد تلقائياً")

    if plan.style.captions and not plan.captions:
        warnings.append("الترجمات مفعّلة لكن لا توجد أسطر ترجمة (لا كلمات في التفريغ؟)")
    for line in plan.captions:
        if not line.words:
            warnings.append(f"سطر ترجمة بلا توقيتات كلمات: «{line.text[:24]}»")
    for broll in plan.b_roll:
        if not broll.asset_url and not broll.asset_id:
            warnings.append(f"اقتراح B-Roll بلا أصل مُجلب بعد: {','.join(broll.keywords[:3])}")

    return PlanValidation(errors, warnings)


def _covered_seconds(segments: List[PlanSegment], duration: float) -> float:
    """مجموع أطوال اتحاد المقاطع ضمن [0, duration]."""
    total = 0.0
    cursor = 0.0
    for s in segments:
        start = max(s.start, 0.0)
        end = min(s.end, duration)
        if end <= cursor:
            continue
        total += end - max(start, cursor)
        cursor = end
    return total


def normalize_plan(
    raw: Union[str, Dict[str, Any], EdlPlan],
    source: EdlSource,
    *,
    max_segments: int = 60,
) -> EdlPlan:
    """يطبّع خطة (من LLM أو قواعد) إلى مخطط صارم قابل للتشغيل:

    - اقتطاع الحدود لمدة المصدر، إسقاط المقاطع الصفرية، ترتيبها،
    - دمج التداخلات (الإبقاء يسيطر)،
    - سد الفجوات بمقاطع CUT لتغطية 0..duration كاملة (مثل تطبيع Next.js)،
    - فرض سقف عدد المقاطع (MAX_SEGMENTS=60).
    """
    if isinstance(raw, EdlPlan):
        plan = raw
    elif isinstance(raw, str):
        plan = EdlPlan.model_validate_json(raw)
    else:
        plan = EdlPlan.model_validate(raw)

    plan.source = source
    dur = max(source.duration, 0.0)

    for s in plan.segments:
        s.start = max(0.0, min(s.start, dur))
        s.end = max(0.0, min(s.end, dur))
    plan.segments = [s for s in plan.segments if s.end - s.start >= 0.05]
    plan.segments.sort(key=lambda s: s.start)

    # دمج التداخل: مقطع الإبقاء يسيطر؛ مقطع القطع يُقص إلى ما بعد الإبقاء.
    merged: List[PlanSegment] = []
    for s in plan.segments:
        if merged and s.start < merged[-1].end - 1e-6:
            prev = merged[-1]
            if prev.keep and not s.keep:
                continue  # قطع داخل فترة إبقاء → تجاهل
            if not prev.keep and s.keep:
                prev.end = max(prev.end, s.end)
                prev.reason = prev.reason or s.reason
                continue
            if prev.keep and s.keep:
                prev.end = max(prev.end, s.end)
                prev.reason = prev.reason or s.reason
                continue
            prev.end = max(prev.end, s.end)  # قصّان متتاليان
            continue
        merged.append(s)
    plan.segments = merged

    # سد الفجوات بمقاطع CUT لتغطية 0..duration.
    filled: List[PlanSegment] = []
    cursor = 0.0
    for s in plan.segments:
        if s.start > cursor + 0.05:
            filled.append(
                PlanSegment(start=cursor, end=s.start, keep=False, speed=1.0, reason="فجوة مكتملة تلقائياً")
            )
        filled.append(s)
        cursor = max(cursor, s.end)
    if dur - cursor > 0.05:
        filled.append(
            PlanSegment(start=cursor, end=dur, keep=False, speed=1.0, reason="نهاية مكتملة تلقائياً")
        )
    plan.segments = filled

    # ملء تلقائي: crop يتوارث حدود المقطع، ومقترحات b_roll بلا معرف تأخذ اسماً ثابتاً.
    for i, s in enumerate(plan.segments):
        if s.crop is not None and s.crop.start == 0.0 and s.crop.end == 0.0:
            s.crop.start = s.start
            s.crop.end = s.end
        if s.b_roll is not None and not s.b_roll.id:
            s.b_roll.id = f"broll_{i + 1}"
    for i, b in enumerate(plan.b_roll):
        if not b.id:
            b.id = f"broll_{i + 1}"

    # سقف عدد المقاطع: دمج مقاطع الإبقاء المتجاورة أولاً، ثم حذف أصغر مقاطع القطع.
    if len(plan.segments) > max_segments:
        plan.segments = _compact_segments(plan.segments, max_segments)

    return plan


def _compact_segments(segments: List[PlanSegment], max_segments: int) -> List[PlanSegment]:
    """يضغط المقاطع تحت السقف مع الحفاظ على أطول محتوى ممكن."""
    out = segments[:]
    # 1) دمج مقاطع الإبقاء المتجاورة
    changed = True
    while len(out) > max_segments and changed:
        changed = False
        merged: List[PlanSegment] = []
        i = 0
        while i < len(out):
            if (
                i + 1 < len(out)
                and out[i].keep
                and out[i + 1].keep
            ):
                a, b = out[i], out[i + 1]
                a.end = max(a.end, b.end)
                a.reason = a.reason or b.reason
                merged.append(a)
                i += 2
                changed = True
            else:
                merged.append(out[i])
                i += 1
        out = merged
    # 2) حذف أصغر مقاطع القطع حتى نصل للسقف
    cuts = [s for s in out if not s.keep]
    if len(out) > max_segments:
        cuts.sort(key=lambda s: s.end - s.start)
        drop = {id(s) for s in cuts[: len(out) - max_segments]}
        out = [s for s in out if id(s) not in drop]
    return out


def edl_to_json(plan: EdlPlan) -> str:
    """تسلسل camelCase مطابق لعقد TypeScript (جاهز للحفظ أو الإرسال لطبقة Next.js)."""
    return plan.model_dump_json(by_alias=True, exclude_none=True)
