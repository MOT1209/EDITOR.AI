# -*- coding: utf-8 -*-
"""اختبارات مرحلة التقوية (أ): ضابط التكلفة + مراجعة ما بعد الرندر.

يغطي:
1) ضابط التكلفة (أ-1): estimate_cost لكل نوع + BudgetTracker (guard/record/snapshot)
   + رفع BudgetExceeded عند التجاوز.
2) مراجعة ما بعد الرندر (أ-2): منع المخرَج الأسود/الصامت، القبول عند السلامة،
   والتدهور الأنيق عند غياب ffprobe.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT.parent))

from src.agents.utils import (  # noqa: E402
    BudgetExceeded,
    BudgetTracker,
    estimate_cost,
)
from src.agents import render_review  # noqa: E402


# ---------------------------------------------------------------- أ-1
def test_estimate_cost_per_kind():
    assert estimate_cost("whisper", duration_sec=600) > 0
    assert estimate_cost("tts", chars=1000) > 0
    assert estimate_cost("chat", chars=4000) > 0
    assert estimate_cost("vision", chars=100, images=2) > estimate_cost("chat", chars=100)
    assert estimate_cost("unknown") == 0.0


def test_budget_tracker_records_and_snapshots():
    t = BudgetTracker(cap_usd=1.0)
    t.record("tts", chars=1000)
    snap = t.snapshot()
    assert snap["spent_usd"] > 0
    assert snap["cap_usd"] == 1.0
    assert snap["remaining_usd"] == round(1.0 - snap["spent_usd"], 4)


def test_budget_tracker_blocks_over_cap():
    t = BudgetTracker(cap_usd=0.01)
    t.record("tts", chars=500)
    try:
        t.guard("whisper", duration_sec=600)  # ~0.06$ > 0.01
        assert False, "كان يجب رفع BudgetExceeded"
    except BudgetExceeded:
        pass


def test_budget_no_cap_allows_all():
    t = BudgetTracker(cap_usd=0.0)  # 0 = بلا سقف
    # لا يرفع مهما كان التقدير
    est = t.guard("whisper", duration_sec=100000)
    assert est > 0


# ---------------------------------------------------------------- أ-2
def test_review_blocks_black_and_silent(tmp_path, monkeypatch):
    f = tmp_path / "out.mp4"
    f.write_bytes(b"x")
    monkeypatch.setattr(
        render_review, "probe",
        lambda p: {"duration": 30.0, "has_video": True, "has_audio": False},
    )
    monkeypatch.setattr(render_review, "_black_ratio", lambda p, d, ff: 0.9)
    monkeypatch.setattr(render_review, "_audio_mean_db", lambda p, ff: None)
    passed, issues, _ = render_review.review_render(
        str(f), expect_audio=True, expected_duration=30
    )
    assert passed is False
    assert any("أسود" in i for i in issues)
    assert any("صوت" in i for i in issues)


def test_review_passes_healthy_output(tmp_path, monkeypatch):
    f = tmp_path / "out.mp4"
    f.write_bytes(b"x")
    monkeypatch.setattr(
        render_review, "probe",
        lambda p: {"duration": 30.0, "has_video": True, "has_audio": True},
    )
    monkeypatch.setattr(render_review, "_black_ratio", lambda p, d, ff: 0.05)
    monkeypatch.setattr(render_review, "_audio_mean_db", lambda p, ff: -18.0)
    passed, issues, _ = render_review.review_render(
        str(f), expect_audio=True, expected_duration=30
    )
    assert passed is True
    assert issues == []


def test_review_missing_file_fails():
    passed, issues, _ = render_review.review_render("/no/such/file.mp4")
    assert passed is False
    assert issues


def test_review_degrades_when_probe_unavailable(tmp_path, monkeypatch):
    f = tmp_path / "out.mp4"
    f.write_bytes(b"x")
    monkeypatch.setattr(render_review, "probe", lambda p: None)
    passed, issues, details = render_review.review_render(str(f))
    assert passed is True  # لا نمنع عند تعذّر الفحص
    assert details.get("probe") == "unavailable"


if __name__ == "__main__":
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
