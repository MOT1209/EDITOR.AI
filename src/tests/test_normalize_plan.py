# -*- coding: utf-8 -*-
"""اختبارات تطبيع خطة EDL: الإبقاء يسيطر على القطع المتداخل (إصلاح B-1 في تقرير الفحص)."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT.parent))

from src.agents.edl_schema import EdlSource, normalize_plan, validate_plan  # noqa: E402

SRC = EdlSource(path="x.mp4", duration=10)


def _segs(plan):
    return [(round(s.start, 3), round(s.end, 3), s.keep) for s in plan.segments]


def _norm(segments):
    return normalize_plan({"source": {"path": "x.mp4", "duration": 10}, "segments": segments}, SRC)


def test_cut_before_overlapping_keep_is_trimmed_not_extended():
    plan = _norm([
        {"start": 0, "end": 5, "keep": False},
        {"start": 3, "end": 10, "keep": True},
    ])
    assert _segs(plan) == [(0, 3, False), (3, 10, True)]
    assert validate_plan(plan).ok


def test_cut_fully_covered_by_keep_start_is_dropped():
    plan = _norm([
        {"start": 2, "end": 2.02, "keep": False},
        {"start": 0, "end": 10, "keep": True},
    ])
    # القطع الصفري يُسقط أولاً؛ الإبقاء يغطي كامل المدة.
    assert _segs(plan) == [(0, 10, True)]


def test_cut_inside_keep_is_ignored():
    plan = _norm([
        {"start": 0, "end": 6, "keep": True},
        {"start": 2, "end": 4, "keep": False},
    ])
    assert _segs(plan) == [(0, 6, True), (6, 10, False)]


def test_keep_total_duration_never_shrinks_on_overlap():
    plan = _norm([
        {"start": 0, "end": 4, "keep": False},
        {"start": 1, "end": 9, "keep": True},
        {"start": 8, "end": 10, "keep": False},
    ])
    kept = sum(s.end - s.start for s in plan.segments if s.keep)
    assert abs(kept - 8.0) < 1e-6
