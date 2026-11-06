# -*- coding: utf-8 -*-
"""اختبارات سقف normalize_plan (60 مقطعاً) — إصلاح A14: دمج مجاورة + حقن source.

يغطي:
1) مدخل مصنوع من مقاطع مجاورة (61 قطعة متتابعة) → يجب أن ينتهي إلى ≤ 60
   مقطعاً مع تغطية كاملة للـ [0, duration] دون فجوات (دمج قبل الحذف).
2) كثرة الإبقاء (>60 إبقاء) → القرار الحصري في الكود: دمج متجاورات الإبقاء
   دون حذفه (الحفاظ على المحتوى)، وبناءً عليه تبقى التغطية كاملة.
3) التناوب المتعاقب 80 (keep/cut) → نفس سلوك السقف القائم (fallback: إسقاط
   أصغر القطع) ليمرّ اختبار A1 دون تعديل.
4) مسار النص (str): حقن source عند غيابه ثم مسار التصدير/الاستيراد.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # src/
sys.path.insert(0, str(ROOT.parent))  # جذر المشروع (لـ src.agents)

sys.stdout.reconfigure(encoding="utf-8")

from src.agents.edl_schema import (  # noqa: E402
    EdlPlan,
    EdlSource,
    edl_to_json,
    normalize_plan,
)


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


# ── 1) مدخل مجاورة (قِطع متتابعة) → ≤ 60 + تغطية كاملة ────────────────────
def test_cap_adjacent_cuts_merge_full_coverage_under_limit():
    """61 قطعة قصّ متتابعة (جميعها keep=False، مجاورة) → الدمج يجعل العدد ≤ 60
    والتغطية الكاملة تبقى؛ فالإسقاط الأصلي كان سيُسقط قطعة فجوة غير مكملة."""
    duration = 61.0
    segments = [
        {"start": float(i), "end": float(i + 1), "keep": False}
        for i in range(61)
    ]
    plan = normalize_plan({"duration": duration, "segments": segments}, _src(duration))
    assert len(plan.segments) <= 60, f"السقف: {len(plan.segments)} مقطعاً"
    _full_coverage(plan, duration)


# ── 2) كثرة الإبقاء (>60 إبقاء) → الدمج بدل الحذف ────────────────────────
def test_cap_adjacent_keeps_merge_under_limit_full_coverage():
    """61 إبقاء متجاورين يغطون مساحة المصدر → يُدمج إلى إبقاء واحد ممتد دون
    يُدمج المتجاور للإبقاء دون حذف (قرار الكود الحصري: الدمج قبل الحذف)."""
    duration = 30.5
    segments = [
        {"start": float(i * 0.5), "end": float((i + 1) * 0.5), "keep": True}
        for i in range(61)
    ]
    plan = normalize_plan({"duration": duration, "segments": segments}, _src(duration))
    assert len(plan.segments) <= 60, f"السقف: {len(plan.segments)} مقطعاً"
    _full_coverage(plan, duration)
    keeps = [s for s in plan.segments if s.keep]
    assert len(keeps) == 31, _tuples(plan)
    assert keeps[0].start == 0.0 and keeps[-1].end == duration


# ── 3) التناوب المتعاقب 80 → fallback مطابق لسلوك السقف القائم ──────────────
def test_cap_alternating_80_fallback_yields_60():
    """التناوب المتعاقب (keep/cut) 80 → لا أزواج مجاورة تتوفر، لذا fallback
    (إسقاط أصغر القطع) مطابق لسلوك السقف القائم — اختبار A1 دون تعديل."""
    duration = 80.0
    segments = [
        {"start": float(i), "end": float(i + 1), "keep": i % 2 == 0}
        for i in range(80)
    ]
    plan = normalize_plan({"duration": duration, "segments": segments}, _src(duration))
    assert len(plan.segments) == 60, f"السقف: {len(plan.segments)} مقطعاً"
    keeps = [s for s in plan.segments if s.keep]
    assert len(keeps) == 40, "يجب أن تنجو كل 40 مقطع إبقاء"


# ── 4) مسار النص (str) — حقن source + مسار التصدير ────────────────────────
def test_str_path_missing_source_gets_injected():
    """مسار النص (str) بلا source → حقن المصدر المُخصّص ثم تحقق ناجح."""
    payload = json.dumps({
        "duration": 30,
        "segments": [{"start": 0, "end": 10, "keep": True}],
    })
    plan = normalize_plan(payload, _src())
    assert isinstance(plan, EdlPlan)
    assert plan.source.path == "x.mp4"
    assert plan.source.duration == 30.0


def test_str_path_with_source_uses_live_instance():
    """مسار النص (str) مع source موجود → يُستبدل بالنسخة الحية (المرجعية)."""
    payload = json.dumps({
        "duration": 30,
        "source": {"path": "real.mp4", "duration": 30.0, "hasAudio": True},
        "segments": [{"start": 0, "end": 10, "keep": True}],
    })
    src = _src()
    plan = normalize_plan(payload, src)
    assert plan.source is src
    assert plan.source.path == "x.mp4"
    assert plan.source.has_audio is True


def test_str_path_round_trip_via_edl_to_json():
    """مسار النص ثم مسار التصدير: الخطة المُطبَّعة من JSON نصي تُسلسَل عبر
    ``edl_to_json`` وتُسترجع بصحة (مع المصدر المُحقن)."""
    payload = json.dumps({
        "duration": 30,
        "segments": [{"start": 0, "end": 10, "keep": True}],
    })
    plan = normalize_plan(payload, _src())
    restored = EdlPlan.model_validate_json(edl_to_json(plan))
    assert isinstance(restored, EdlPlan)
    assert len(restored.segments) == 2  # keep + auto cut
    assert restored.source.path == "x.mp4"
    assert restored.source.duration == 30.0


if __name__ == "__main__":
    import inspect

    fns = [o for _, o in sorted(inspect.getmembers(sys.modules[__name__]))
           if o.__class__.__name__ == "function" and o.__name__.startswith("test_")]
    for fn in fns:
        fn()
        print(f"✓ {fn.__name__}")
    print("\n🎉 normalize_plan cap: 6/6 ناجحة")
