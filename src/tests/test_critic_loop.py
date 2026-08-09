# -*- coding: utf-8 -*-
"""اختبار تكامل الناقد الإبداعي ومهندس الصوت في المسار — pytest أو مستقل.

يغطي:
1) الناقد مسجّل في الحزمة ويرفض خطة ضعيفة (لا Hook مبكر + سرعة موحّدة) بحكم revise.
2) حلقة المراجعة (creative_loop): تعيد المخرج بملاحظات الناقد ثم تمرر بأفضل
   خطة سليمة مع تحذير عند نفاد المحاولات (لا يتوقف المسار أبداً).
3) مهندس الصوت يبني AudioPlan من خطة معتمدة (Ducking من كلمات Whisper).
4) تدهور أنيق: بلا كلمات → نطاقات الترجمة كمصدر للـ Ducking.
"""
import asyncio
import sys
from types import SimpleNamespace
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # src/
sys.path.insert(0, str(ROOT.parent))  # جذر المشروع (لـ src.agents)

sys.stdout.reconfigure(encoding="utf-8")

from src.agents import AGENT_REGISTRY, CeoOrchestrator  # noqa: E402
from src.agents.edl_schema import (  # noqa: E402
    AnalystReport, EdlPlan, EdlSource, SilenceSpan, WordTiming,
    VideoStyle, RenderHints, PlanSegment, CaptionLine,
)
from src.agents.audio_agent import AudioAgent  # noqa: E402
from src.agents.critic_agent import CriticAgent  # noqa: E402
from src.agents.director_agent import DirectorAgent  # noqa: E402
from src.agents.utils import get_logger  # noqa: E402


class _LightOrchestrator(CeoOrchestrator):
    """نسخة خفيفة من CeoOrchestrator لاختبار _creative_loop بلا استيراد crewai
    البطيء — لا تُستدعى __init__ الثقيلة (load_env + LLM + مديرة CrewAI)،
    بل نضبط الحقول الثلاثة التي تحتاجها الحلقة فقط (نفس مسار الكود تماماً)."""

    def __init__(self, max_retries: int = 2) -> None:  # noqa: D107
        self.max_retries = max_retries
        self.logger = get_logger("test")
        self._agents = {"critic": CriticAgent(), "director": DirectorAgent()}

    def _save_artifact(self, ctx, stage, artifact) -> None:  # noqa: ARG002
        pass  # لا كتابة ملفات في الاختبار


def _ctx() -> SimpleNamespace:
    return SimpleNamespace(
        source_path="test.mp4", request="فيديو حماسي قصير", language="ar",
        mood_hint="قوي", target_aspect="9:16", enable_b_roll=False,
        output_dir=".montage_ai/tests", feedback=[],
    )


def weak_plan(ctx) -> EdlPlan:
    """خطة ضعيفة عمداً: تبدأ متأخرة + سرعة موحّدة + بلا ترجمات/نصوص."""
    source = EdlSource(path=ctx.source_path, duration=40.0, width=1920, height=1080, fps=30, has_audio=True)
    return EdlPlan(
        version="1.0",
        title="خطة ضعيفة",
        description="اختبار",
        tags=["test"],
        summary="خطة بلا Hook ولا تنوّع",
        source=source,
        style=VideoStyle(music_mood="قوي", music_volume=0.5, captions=True, color_filter="vivid"),
        render=RenderHints(target_aspect="9:16", audio_target_lufs=-16.0, quality="high"),
        segments=[
            PlanSegment(id="s1", kind="keep", keep=True, start=9.0, end=30.0, source="default"),
            PlanSegment(id="s2", kind="keep", keep=True, start=32.0, end=40.0, source="default"),
        ],
        captions=[CaptionLine(id="c1", start=1.0, end=2.0, text="مرحبا")],
        b_roll=[],
        text_overlays=[],
    )


def make_report() -> AnalystReport:
    return AnalystReport(
        source_path="test.mp4", duration=40.0, width=1920, height=1080, fps=30, has_audio=True,
        silences=[SilenceSpan(start=3.0, end=8.0)],
        words=[
            WordTiming(word="كلمة", start=1.0, end=1.4, index=0),
            WordTiming(word="ثانية", start=1.5, end=2.0, index=1),
            WordTiming(word="ثالثة", start=2.1, end=2.6, index=2),
        ],
    )


def test_critic_registered():
    assert "critic" in AGENT_REGISTRY and "audio" in AGENT_REGISTRY, "الوكلاء الجدد غير مسجلين"
    assert sorted(AGENT_REGISTRY) == ["analyst", "audio", "critic", "director", "render"]


def test_critic_rejects_weak_plan():
    ctx = _ctx()
    critique = asyncio.run(CriticAgent().execute(ctx, {"director": weak_plan(ctx), "analyst": make_report()}))
    assert critique.verdict == "revise", f"يجب أن يرفض الخطة الضعيفة: {critique.verdict} ({critique.score})"
    assert critique.suggestions, "يجب أن يحمل ملاحظات توجيهية"
    assert 0.0 <= critique.score < 70.0, f"الدرجة يجب أن تكون دون معيار القبول: {critique.score}"


def test_creative_loop_never_fails():
    orchestrator = _LightOrchestrator(max_retries=2)
    artifacts = {"analyst": make_report(), "director": weak_plan(_ctx())}
    outcome = asyncio.run(orchestrator._creative_loop(_ctx(), artifacts))
    assert outcome.ok, f"حلقة المراجعة يجب ألا تفشل: {outcome.errors}"
    assert "critic" in artifacts, "يجب حفظ تقرير الناقد في الأدلة"
    assert artifacts["director"] is not None, "يجب بقاء أفضل خطة سليمة"


def test_audio_plan_from_words():
    ctx = _ctx()
    plan = weak_plan(ctx)
    audio_plan = asyncio.run(AudioAgent().execute(ctx, {"director": plan, "analyst": make_report()}))
    assert audio_plan.music.bpm == 128 and audio_plan.music.energy == 0.85, "ملف مزاج «قوي»"
    assert len(audio_plan.ducking) >= 1, "يجب بناء Ducking من الكلمات"
    assert audio_plan.loudness_lufs == -16.0, "معيار LUFS الافتراضي"


def test_audio_graceful_degradation():
    ctx = _ctx()
    plan = weak_plan(ctx)
    empty_report = AnalystReport(
        source_path="test.mp4", duration=40.0, width=1920, height=1080, fps=30, has_audio=True,
    )
    audio_plan = asyncio.run(AudioAgent().execute(ctx, {"director": plan, "analyst": empty_report}))
    assert len(audio_plan.ducking) >= 1, "نطاقات الترجمة بديل أنيق للـ Ducking"


if __name__ == "__main__":
    # تشغيل مستقل: python src/tests/test_critic_loop.py
    for fn in (
        test_critic_registered, test_critic_rejects_weak_plan,
        test_creative_loop_never_fails, test_audio_plan_from_words,
        test_audio_graceful_degradation,
    ):
        fn()
        print(f"✓ {fn.__name__}")
    print("\n🎉 تكامل الناقد والصوت: 5/5 ناجحة")
