# -*- coding: utf-8 -*-
"""اختبارات normalize_plan في edl_schema — إصلاح H-1 (القِبَ ينتصر) + حقن source.

يغطي:
1) تداخل قصٍّ متبوق بإبقاء: يجب ألا يبتلع القص الـkeep بل يتقلَّص نهايته (H-1).
2) حقن source قبل التحقق حتى لا ترتفع خطة بلا حقل source بخطأ تحقق.
3) الحفاظ على السلوك غير المتعلَّم: متجاورات بلا تداخل، الدمج المتشابه،
   السقف 60، حدود 0.05 — كلها كما كانت من قبل.
4) حارس عام: أي مخرجات تغطي [0, duration] كاملة بلا فجوات ولا تراكب.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # src/
sys.path.insert(0, str(ROOT.parent))  # جذر المشروع (لـ src.agents)

sys.stdout.reconfigure(encoding="utf-8")

import pytest  # noqa: E402

from src.agents.edl_schema import EdlPlan, EdlSource, normalize_plan  # noqa: E402


def _src(duration: float = 30.0) -> EdlSource:
    """مصدر افتراضي 30 ثانية لجميع الاختبارات."""
    return EdlSource(path="x.mp4", duration=duration)


def _tuples(plan: EdlPlan) -> list:
    """عرض المخرج كأزواج (بداية، نهاية، إبقاء) مُقرَّبة للقراءة."""
    return [(round(s.start, 3), round(s.end, 3), s.keep) for s in plan.segments]


def _full_coverage(plan: EdlPlan, duration: float = 30.0) -> None:
    """حارس عام: المقاطع مرتبة، متلاصقة، وتغطي [0, duration] بلا فجوات/تراكب."""
    cursor = 0.0
    for s in plan.segments:
        assert s.start >= cursor - 1e-6, f"تراكب عند {s.start}"
        assert s.start - cursor <= 0.05 + 1e-6, f"فجوة [{cursor} → {s.start}]"
        assert s.end > s.start, "مقطع صفر/معكوس"
        cursor = s.end
    assert cursor >= duration - 1e-6, f"التغطية وقفت عند {cursor} من {duration}"


# ── الحالتان المرجعيتان لـ H-1 (regression) ─────────────────────────────
def test_regression_h1_a_overlapcut_then_keep_wins():
    """الحالة (أ): قص [5..10] ثم إبقاء متقاطع [8..14] — القص يتقلَّص إلى [5..8]
    والقِبَ ينتصر في التقاطع [8..10] (كان يُمدَّد حتى 14 ويبتلع محتوىً حقيقياً).

    ملاحظة: (0,5) فجوة سُدَّت تلقائياً و(5,8) هو القص المُقلَّص — قطعتان
    متجاورتان من نوع واحد تبقى قطعتين (الدمج الحالي يتطلب تداخلاً لا مجاورة).
    """
    plan = normalize_plan(
        {"duration": 30, "segments": [
            {"start": 5, "end": 10, "keep": False},
            {"start": 8, "end": 14, "keep": True},
        ]},
        _src(),
    )
    assert _tuples(plan) == [
        (0.0, 5.0, False), (5.0, 8.0, False),
        (8.0, 14.0, True), (14.0, 30.0, False),
    ], _tuples(plan)
    _full_coverage(plan)


def test_regression_h1_b_nested_keep_in_full_cut():
    """الحالة (ب): قص كامل [0..30] تكسره إبقاء [5..10] — كان يُبتلع كلياً
    (خطة بلا أي محتوى). المطلوب: (0,5)قص، (5,10)إبقاء، (10,30)قص."""
    plan = normalize_plan(
        {"duration": 30, "segments": [
            {"start": 0, "end": 30, "keep": False},
            {"start": 5, "end": 10, "keep": True},
        ]},
        _src(),
    )
    assert _tuples(plan) == [
        (0.0, 5.0, False), (5.0, 10.0, True), (10.0, 30.0, False),
    ], _tuples(plan)
    _full_coverage(plan)


def test_regression_h1_reversed_order_case_a():
    """نسخة معكوسة (مرتبة هبوطاً) للحالة (أ): الفرز الداخلي حسب البداية
    يعيد النتيجة نفسها أياً كان ترتيب الورود في المدخل."""
    plan = normalize_plan(
        {"duration": 30, "segments": [
            {"start": 8, "end": 14, "keep": True},
            {"start": 5, "end": 10, "keep": False},
        ]},
        _src(),
    )
    assert _tuples(plan) == [
        (0.0, 5.0, False), (5.0, 8.0, False),
        (8.0, 14.0, True), (14.0, 30.0, False),
    ], _tuples(plan)


def test_regression_h1_reversed_order_case_b():
    """نسخة معكوسة (مرتبة هبوطاً) للحالة (ب): النتيجة مطابقة للحالة الأصلية."""
    plan = normalize_plan(
        {"duration": 30, "segments": [
            {"start": 5, "end": 10, "keep": True},
            {"start": 0, "end": 30, "keep": False},
        ]},
        _src(),
    )
    assert _tuples(plan) == [
        (0.0, 5.0, False), (5.0, 10.0, True), (10.0, 30.0, False),
    ], _tuples(plan)


# ── الاتجاه المعاكس لـ H-1: إبقاء أولاً ثم قص متقاطع ────────────────────
def test_h1_reverse_direction_keep_then_overlapping_cut():
    """إبقاء [0..10] ثم قص متقاطع [8..14]: الإبقاء لا يتأثر إطلاقاً (keep
    يسيطر)، والفترة [10..30] تُسد قصاً تلقائياً كما في الكود من قبل."""
    plan = normalize_plan(
        {"duration": 30, "segments": [
            {"start": 0, "end": 10, "keep": True},
            {"start": 8, "end": 14, "keep": False},
        ]},
        _src(),
    )
    assert _tuples(plan) == [(0.0, 10.0, True), (10.0, 30.0, False)], _tuples(plan)
    _full_coverage(plan)


def test_adjacent_no_overlap_preserved():
    """متجاوران بلا تداخل تبقى قطعتين منفصلتين (نهاية القص = بداية اللاحق)."""
    plan = normalize_plan(
        {"duration": 30, "segments": [
            {"start": 0, "end": 5, "keep": False},
            {"start": 5, "end": 10, "keep": True},
        ]},
        _src(),
    )
    assert _tuples(plan) == [
        (0.0, 5.0, False), (5.0, 10.0, True), (10.0, 30.0, False),
    ], _tuples(plan)


def test_overlapping_keeps_merge_into_single_keep():
    """إبقائان متداخلان → مقطع إبقاء واحد ممتد (الدمج القديم بلا تغيير)."""
    plan = normalize_plan(
        {"duration": 30, "segments": [
            {"start": 0, "end": 10, "keep": True},
            {"start": 8, "end": 14, "keep": True},
        ]},
        _src(),
    )
    assert _tuples(plan) == [(0.0, 14.0, True), (14.0, 30.0, False)], _tuples(plan)


def test_overlapping_cuts_merge_into_single_cut():
    """قصّان متداخلان → مقطع قص واحد ممتد (سلوك قصّان متتاليان القديم)."""
    plan = normalize_plan(
        {"duration": 30, "segments": [
            {"start": 0, "end": 10, "keep": False},
            {"start": 8, "end": 14, "keep": False},
        ]},
        _src(),
    )
    assert _tuples(plan) == [(0.0, 14.0, False), (14.0, 30.0, False)], _tuples(plan)


def test_equal_start_cut_popped_for_keep():
    """قص يبدأ حيث يبدأ الإبقاء (نفس النقطة) انعدم تطبُعاً بعد التقليم →
    يُزاله pop وتحل الإبقاء محله دون فجوة أو تراكب."""
    plan = normalize_plan(
        {"duration": 30, "segments": [
            {"start": 5, "end": 10, "keep": False},
            {"start": 5, "end": 14, "keep": True},
        ]},
        _src(),
    )
    assert _tuples(plan) == [
        (0.0, 5.0, False), (5.0, 14.0, True), (14.0, 30.0, False),
    ], _tuples(plan)
    _full_coverage(plan)


# ── حقن source (مهمة 2) ─────────────────────────────────────────────────
def test_missing_source_does_not_raise():
    """خطة dict بلا حقل source لا ترفع خطأ — يُحقن قبل التحقق بثقة تامة."""
    plan = normalize_plan(
        {"duration": 30, "segments": [{"start": 0, "end": 10, "keep": True}]},
        _src(),
    )
    assert isinstance(plan, EdlPlan)
    assert plan.source.path == "x.mp4"
    assert plan.source.duration == 30.0


def test_injected_source_is_our_reference_instance():
    """المصدر المتعامل معه بعد التحقق هو نسخة الوظيفة (القيمة الحية) — حارس نهائي."""
    src = _src()
    plan = normalize_plan(
        {"duration": 30, "segments": [{"start": 0, "end": 10, "keep": True}]},
        src,
    )
    assert plan.source is src


# ── camelCase (خريطة العقدة الفعلية في EdlPlan) ─────────────────────────
def test_camel_case_input_validates_as_live_model():
    """الإدخال بحقول camelCase حقيقية (hasAudio/textOverlays/bRoll/render) يمر
    عبر التحقق ويُخرج نموذجاً حياً بحقول snake_case مطابقة."""
    plan = normalize_plan(
        {
            "version": "1.0",
            "source": {"path": "real.mp4", "duration": 30.0, "hasAudio": True},
            "segments": [
                {"start": 2, "end": 8, "keep": True, "colorFilter": "warm",
                 "bRoll": {"id": "b1", "keywords": ["sunset"], "start": 2.0, "end": 5.0}},
            ],
            "textOverlays": [{"text": "مرحبا", "start": 1.0, "end": 3.0, "position": "top"}],
            "bRoll": [{"keywords": ["city"], "duration": 3.0}],
            "render": {"encoder": "h264_nvenc", "fps": 30},
        },
        _src(),
    )
    assert isinstance(plan, EdlPlan)
    # المصدر النهائي هو نسخة الوظيفة: سطر إعادة الإسناد بعد التحقق يبقى حارساً
    # (حقن raw.source يسمح بالتحقق فقط، ثم تُستبدل النسخة بالمرجعية عمداً).
    assert plan.source.path == "x.mp4"
    assert plan.source.has_audio is True
    assert plan.text_overlays[0].text == "مرحبا"
    # إصلاح فهرسة (مراجعة المدير): segments[0] هو سدّ الفجوة الاصطناعي [0..2]
    # بلا فلتر (none افتراضياً) — الحقول المضروبة تنتمي للقطعة الأصلية [2..8]
    # التي ينضبط موقعها حسب keep المتطابقة بدايتها.
    keep_seg = next(s for s in plan.segments if s.keep and s.start == 2)
    assert keep_seg.color_filter.value == "warm"
    assert keep_seg.b_roll is not None
    assert plan.render.encoder.value == "h264_nvenc"


# ── سقف 60 مقطعاً (سلوك قبل وبعد التعديل متطابق) ────────────────────────
def test_max_segments_cap_60():
    """80 مقطعاً متعاقباً (alternate إبقاء/قص) → السقف يجبر الخطة إلى 60 مع
    بقاء كل 40 مقطع إبقاء وإسقاط أصغر 20 قصاً فقط (تظهر فجوات بعد الضغط —
    سلوك _compact_segments الأصلي بلا تغيير، فلا يُشترط تغطية كاملة هنا)."""
    duration = 80.0
    segments = [
        {"start": float(i), "end": float(i + 1), "keep": i % 2 == 0}
        for i in range(80)
    ]
    plan = normalize_plan(
        {"duration": duration, "segments": segments}, _src(duration),
    )
    assert len(plan.segments) == 60, f"السقف: {len(plan.segments)} مقطعاً"
    keeps = [s for s in plan.segments if s.keep]
    assert len(keeps) == 40, "يجب أن تنجو كل 40 مقطع إبقاء"
    assert all(s.end > s.start for s in plan.segments)
    # مرتبة وكلا محتواها موجب، مع أن حذف القصّات ترك فجوات عمداً (سلوك أصلي).
    assert all(a.end <= b.start for a, b in zip(plan.segments, plan.segments[1:]))


# ── حدود منقرصة: نطاقات عديمة طول (< 0.05s) ────────────────────────────
def test_zero_length_keep_dropped():
    """إبقاء بطول منعدم [5..5.001] يُسقطه المطبع (طوله < 0.05) — تسد المساحات بقصّ تلقائي يغطي كلياً."""
    plan = normalize_plan(
        {"duration": 30, "segments": [{"start": 5, "end": 5.001, "keep": True}]},
        _src(),
    )
    assert _tuples(plan) == [(0.0, 30.0, False)], _tuples(plan)


def test_zero_length_cut_inside_keep_dropped():
    """قصّ منقرض [5..5.001] داخل إبقاء → إسقاط صامت والإبقاء يبقى سليماً."""
    plan = normalize_plan(
        {"duration": 30, "segments": [
            {"start": 0, "end": 10, "keep": True},
            {"start": 5, "end": 5.001, "keep": False},
        ]},
        _src(),
    )
    assert _tuples(plan) == [(0.0, 10.0, True), (10.0, 30.0, False)], _tuples(plan)


def test_tiny_but_above_threshold_survives():
    """قطعة قصيرة لكن فوق عتبة 0.05s تنجو من الفلتر ويُسد ما حولها قصاً.

    حذر float: 5.05 - 5 يعطي 0.0499... فنستخدم 5.1 (طول ~0.1 > 0.05 بوضوح)."""
    plan = normalize_plan(
        {"duration": 30, "segments": [{"start": 5, "end": 5.1, "keep": True}]},
        _src(),
    )
    assert _tuples(plan) == [
        (0.0, 5.0, False), (5.0, 5.1, True), (5.1, 30.0, False),
    ], _tuples(plan)


# ── حارس شامل: حالات متنوعة معًا لا تكسر التغطية ───────────────────────
def test_mixed_gauntlet_full_coverage():
    """خطة مختلطة الحالات: قصّ كامل + إبقاء داخله + قصّ صغير + إبقاء لاحق."""
    plan = normalize_plan(
        {"duration": 30, "segments": [
            {"start": 0, "end": 30, "keep": False},   # قص كامل (الحالة ب)
            {"start": 5, "end": 10, "keep": True},    # إبقاء داخل القص
            {"start": 12, "end": 13, "keep": False},  # قص صغير في فجوة
            {"start": 20, "end": 24, "keep": True},   # إبقاء لاحق
        ]},
        _src(),
    )
    _full_coverage(plan)
    keeps = [(round(s.start, 3), round(s.end, 3)) for s in plan.segments if s.keep]
    assert (5.0, 10.0) in keeps, keeps
    assert (20.0, 24.0) in keeps, keeps


if __name__ == "__main__":
    # تشغيل مستقل: python src/tests/test_normalize_plan.py
    import inspect

    fns = [o for _, o in sorted(inspect.getmembers(sys.modules[__name__]))
           if o.__class__.__name__ == "function" and o.__name__.startswith("test_")]
    for fn in fns:
        fn()
        print(f"✓ {fn.__name__}")
    print("\n🎉 normalize_plan: H-1 + حقن source ناجحة")
