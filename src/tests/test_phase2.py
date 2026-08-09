# -*- coding: utf-8 -*-
"""اختبار المرحلة 2 (وجه + متحدثون + مزوّد) — يعمل مع pytest أو مستقلاً (python file.py).

يغطي:
1) موجّه المزود (2.3): build_llm_model + provider_prefix.
2) قص يتبع الوجه (2.1): مراكز crop تتحرك مع الوجه عبر الزمن مع تنعيم EMA.
3) تلوين المتحدثين (2.2): ترجمات موسومة بمتحدث.
4) تدهور أنيق: بلا وجوه/متحدثين → الافتراضيات السابقة (0.5 / 0.42).
"""
import sys
from types import SimpleNamespace
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # src/
sys.path.insert(0, str(ROOT.parent))  # جذر المشروع (لـ src.agents)

sys.stdout.reconfigure(encoding="utf-8")

from src.agents.director_agent import DirectorAgent  # noqa: E402
from src.agents.edl_schema import (  # noqa: E402
    AnalystReport, FaceTrack, SilenceSpan, SpeakerSegment, WordTiming,
)
from src.agents.utils import build_llm_model, provider_prefix  # noqa: E402


def _ctx(**overrides) -> SimpleNamespace:
    base = dict(
        source_path="test.mp4", request="اختبار", language="ar",
        mood_hint="قوي", target_aspect="9:16", enable_b_roll=False,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _report_with_faces() -> AnalystReport:
    return AnalystReport(
        source_path="test.mp4", duration=20.0, width=1920, height=1080, fps=30, has_audio=True,
        silences=[SilenceSpan(start=8.5, end=9.0), SilenceSpan(start=15.5, end=16.0)],
        words=[WordTiming(word="مرحبا", start=2.0, end=2.5, index=0)],
        face_tracks=[
            FaceTrack(start=1.0, end=8.0, center_x=0.3, center_y=0.4),
            FaceTrack(start=8.0, end=16.0, center_x=0.7, center_y=0.35),
            FaceTrack(start=16.0, end=20.0, center_x=0.2, center_y=0.45),
        ],
        speakers=[
            SpeakerSegment(start=1.0, end=9.0, label="speaker_1"),
            SpeakerSegment(start=9.0, end=20.0, label="speaker_2"),
        ],
    )


# ── 1) موجّه المزود (2.3) ──────────────────────────────────────────────
def test_provider_routing():
    assert build_llm_model("https://api.groq.com/openai/v1", "llama-3.3-70b") == "groq/llama-3.3-70b"
    assert build_llm_model("https://openrouter.ai/api/v1", "deepseek-r1") == "openrouter/deepseek-r1"
    assert build_llm_model("https://my.dev.tier/v1", "custom-model") == "custom-model"  # مخصص بلا بادئة
    assert build_llm_model("https://api.groq.com/openai/v1", "qwen/qwen3.6-27b") == "qwen/qwen3.6-27b"
    assert provider_prefix("https://api.anthropic.com") == "anthropic/"


# ── 2) قص يتبع الوجه (2.1) ─────────────────────────────────────────────
def test_face_following_crops():
    d = DirectorAgent()
    plan = d._rule_based_plan(_ctx(), _report_with_faces())
    plan = d._apply_face_tracks(plan, _report_with_faces())
    crops = [(s.start, s.end, s.crop.center_x, s.crop.center_y)
             for s in plan.segments if s.keep and s.crop]
    assert len(crops) >= 2, f"يجب أن تحصل مقاطع الإبقاء على crop، وُجد {len(crops)}"
    first = crops[0]
    assert 0.15 <= first[2] <= 0.5, f"مركز أول مقطع يجب أن يقترب من الوجه: {first}"
    xs = [x for _, _, x, _ in crops]
    assert max(xs) - min(xs) > 0.1, f"يجب أن يتحرك المركز مع الوجه: {xs}"


# ── 3) تلوين المتحدثين (2.2) ───────────────────────────────────────────
def test_speaker_annotation():
    d = DirectorAgent()
    report = _report_with_faces()
    plan = d._rule_based_plan(_ctx(), report)
    plan = d._annotate_speakers(plan, report)
    speaker_labels = {c.speaker for c in plan.captions if c.speaker}
    assert speaker_labels, "يجب أن تُعلَّم الترجمات بمتحدث"


# ── 4) بدون وجوه/متحدثين → سلوك سابق دون تغيير ─────────────────────────
def test_graceful_degradation():
    d = DirectorAgent()
    plain = AnalystReport(
        source_path="test.mp4", duration=5.0, width=1920, height=1080, fps=30, has_audio=True,
    )
    plan = d._rule_based_plan(_ctx(), plain)
    plan = d._apply_face_tracks(plan, plain)
    for s in plan.segments:
        if s.keep and s.crop:
            assert s.crop.center_x == 0.5 and s.crop.center_y == 0.42, "بلا وجوه يبقى المركز الافتراضي"


if __name__ == "__main__":
    # تشغيل مستقل: python src/tests/test_phase2.py
    import asyncio
    for fn in (test_provider_routing, test_face_following_crops, test_speaker_annotation, test_graceful_degradation):
        fn()
        print(f"✓ {fn.__name__}")
    print("\n🎉 المرحلة 2: 4/4 ناجحة")
