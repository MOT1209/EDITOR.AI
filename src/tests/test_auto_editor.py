# -*- coding: utf-8 -*-
"""اختبار تكامل auto-editor (المرحلة ب) — يعمل مع pytest أو مستقلاً.

يغطي:
1) قراءة v3: _fps + _clips_source_ranges + _inactive_spans (بلا ثنائية).
2) طبقات الجلوسة: _tiers_from_ranges (قص/عادي/سريع) + تدهور بلا auto-editor.
3) detect_motion_spans / detect_black_spans مع v3 مصنّع (ثنائية مقلَّدة).
4) edl_to_cut_ranges: بناء وسيط --cut بالإطارات.
5) preview_stats: إحصائيات القص الحتمية.
6) تكامل المخرج: _apply_loudness_tiers يضبط speed=FAST_SPEED على الصاخب.
"""
import sys
from types import SimpleNamespace
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # src/
sys.path.insert(0, str(ROOT.parent))  # جذر المشروع (لـ src.agents)

sys.stdout.reconfigure(encoding="utf-8")

import pytest  # noqa: E402

from src.agents import auto_editor_utils as ae  # noqa: E402
from src.agents.director_agent import DirectorAgent  # noqa: E402
from src.agents.edl_schema import EdlPlan, EdlSource, PlanSegment, SilenceSpan  # noqa: E402


def _v3(fps_num: int = 30, fps_den: int = 1) -> dict:
    """جدول زمني v3 مصنّع: يحتفظ بـ [0-2s] و [4-6s] ويقـصّ [2-4s]."""
    return {
        "timebase": f"{fps_num}/{fps_den}",
        "v": [
            [
                {"offset": 0, "dur": fps_num * 2, "effects": []},
                {"offset": fps_num * 4, "dur": fps_num * 2, "effects": ["speed:1.3"]},
            ]
        ],
        "a": [[]],
    }


def _plan() -> EdlPlan:
    return EdlPlan(
        source=EdlSource(path="x.mp4", duration=10.0, fps=30),
        segments=[
            PlanSegment(start=0.0, end=2.0, keep=True),
            PlanSegment(start=2.0, end=4.0, keep=False),
            PlanSegment(start=4.0, end=6.0, keep=True),
            PlanSegment(start=6.0, end=10.0, keep=False),
        ],
    )


# ── 1) قراءة v3 ─────────────────────────────────────────────────────────
def test_fps_from_timebase():
    assert ae._fps({"timebase": "30000/1001"}) == pytest.approx(29.97, abs=0.01)
    assert ae._fps({"timebase": "30/1"}) == 30.0
    assert ae._fps({}) == 30.0  # قيمة افتراضية


def test_clips_source_ranges():
    ranges = ae._clips_source_ranges(_v3())
    assert ranges == [
        (0.0, 2.0, None),
        (4.0, 6.0, 1.3),
    ], ranges


def test_inactive_spans():
    spans = ae._inactive_spans(ae._clips_source_ranges(_v3()), duration=8.0, min_duration=0.1)
    assert spans == [(2.0, 4.0), (6.0, 8.0)], spans


# ── 2) طبقات الجلوسة ────────────────────────────────────────────────────
def test_tiers_from_ranges():
    tiers = ae._tiers_from_ranges(ae._clips_source_ranges(_v3()), duration=8.0, min_duration=0.1)
    kinds = {t.tier for t in tiers}
    assert kinds == {"normal", "fast", "cut"}, tiers
    by = {t.tier: (t.start, t.end) for t in tiers}
    assert by["fast"] == (4.0, 6.0)
    assert by["normal"] == (0.0, 2.0)


def test_loudness_tiers_degrades_gracefully(monkeypatch):
    monkeypatch.setattr(ae, "_export_v3", lambda *a, **k: None)
    monkeypatch.setattr(ae, "_fallback_tiers", lambda *a, **k: [])
    assert ae.loudness_tiers("missing.mp4", duration=5.0) == []


def test_fallback_tiers_iterates_silence_spans(monkeypatch):
    """انحدار: تكرار SilenceSpan كنموذج Pydantic يعطي أزواج (اسم، قيمة) —
    كان يكسر _fallback_tiers عبر مقارنة float مع tuple."""
    spans = [SilenceSpan(start=0.0, end=2.0), SilenceSpan(start=5.0, end=6.0)]
    monkeypatch.setattr(ae, "_ffmpeg_silence_spans", lambda *a, **k: spans)
    tiers = ae._fallback_tiers("x.mp4", duration=10.0, min_duration=0.3)
    assert tiers, "يجب أن تُنتج طبقات"
    assert all(isinstance(t.start, float) and t.end >= t.start for t in tiers)
    assert any(t.tier == "cut" for t in tiers)


# ── 3) فحوصات الحركة والسواد (ثنائية مقلَّدة) ──────────────────────────
def test_detect_motion_spans_from_v3(monkeypatch):
    monkeypatch.setattr(ae, "_export_v3", lambda *a, **k: _v3())
    spans = ae.detect_motion_spans("x.mp4", duration=8.0, min_duration=0.1)
    assert spans == [
        SilenceSpan(start=2.0, end=4.0),
        SilenceSpan(start=6.0, end=8.0),
    ]


def test_detect_black_spans_from_v3(monkeypatch):
    monkeypatch.setattr(ae, "_export_v3", lambda *a, **k: _v3())
    spans = ae.detect_black_spans("x.mp4", duration=8.0, min_duration=0.1)
    assert len(spans) == 2


def test_detect_motion_spans_falls_back_to_ffmpeg(monkeypatch):
    monkeypatch.setattr(ae, "_export_v3", lambda *a, **k: None)
    monkeypatch.setattr(ae, "_ffmpeg_freeze_spans", lambda *a, **k: [SilenceSpan(start=1.0, end=1.5)])
    assert ae.detect_motion_spans("x.mp4") == [SilenceSpan(start=1.0, end=1.5)]


# ── 4) edl_to_cut_ranges ────────────────────────────────────────────────
def test_edl_to_cut_ranges():
    assert ae.edl_to_cut_ranges(_plan()) == "60,120 180,300"


def test_edl_to_cut_ranges_ntsc_fps():
    plan = EdlPlan(
        source=EdlSource(path="x.mp4", duration=10.0, fps=29.97),
        segments=[PlanSegment(start=1.0, end=2.0, keep=False)],
    )
    assert ae.edl_to_cut_ranges(plan) == "30,60"


# ── 5) preview_stats ────────────────────────────────────────────────────
def test_preview_stats():
    stats = ae.preview_stats(_plan())
    assert stats["keptSeconds"] == pytest.approx(4.0)
    assert stats["cutSeconds"] == pytest.approx(6.0)
    assert stats["totalSeconds"] == pytest.approx(10.0)
    assert stats["keptPercent"] == pytest.approx(40.0)
    assert stats["clipCount"] == 2


def test_preview_stats_empty_plan():
    empty = EdlPlan(source=EdlSource(path="x.mp4", duration=0.0), segments=[])
    stats = ae.preview_stats(empty)
    assert stats["keptPercent"] == 0.0


# ── 6) تكامل المخرج: طبقات الجلوسة ─────────────────────────────────────
def test_director_applies_loudness_tiers(monkeypatch):
    report = SimpleNamespace(duration=8.0)
    ctx = SimpleNamespace(source_path="x.mp4")
    from src.agents.auto_editor_utils import TierSpan

    monkeypatch.setattr(
        "src.agents.director_agent.loudness_tiers",
        lambda *a, **k: [
            TierSpan(start=0.0, end=2.0, tier="normal"),
            TierSpan(start=4.0, end=6.0, tier="fast"),
        ],
    )
    segments = [
        PlanSegment(start=0.0, end=2.0, keep=True),
        PlanSegment(start=2.0, end=4.0, keep=False),
        PlanSegment(start=4.0, end=6.0, keep=True),
    ]
    d = DirectorAgent()
    assert d._apply_loudness_tiers(ctx, report, segments) is True
    assert segments[0].speed in (None, 1.0)
    assert segments[2].speed == ae.FAST_SPEED


def test_director_loudness_tiers_graceful(monkeypatch):
    report = SimpleNamespace(duration=8.0)
    ctx = SimpleNamespace(source_path="x.mp4")
    monkeypatch.setattr("src.agents.director_agent.loudness_tiers", lambda *a, **k: [])
    segments = [PlanSegment(start=0.0, end=8.0, keep=True)]
    d = DirectorAgent()
    assert d._apply_loudness_tiers(ctx, report, segments) is False
    assert (segments[0].speed or 1.0) == 1.0


if __name__ == "__main__":
    # تشغيل مستقل: python src/tests/test_auto_editor.py (يتخطى أدوات monkeypatch)
    import inspect

    fns = [o for _, o in sorted(inspect.getmembers(sys.modules[__name__]))
           if o.__class__.__name__ == "function" and o.__name__.startswith("test_")]
    for fn in fns:
        if "monkeypatch" in inspect.signature(fn).parameters:
            continue
        fn()
        print(f"✓ {fn.__name__}")
    print("\n🎉 auto-editor: اختبارات بلا ثنائية ناجحة")