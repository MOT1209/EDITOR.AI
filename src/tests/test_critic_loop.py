# -*- coding: utf-8 -*-
"""اختبار دمج الناقد الإبداعي ومهندس الصوت في المسار (المرحلة 2 المكتملة).

يغطي:
1) الناقد يرفض خطة ضعيفة (لا Hook مبكر + سرعة موحّدة) بحكم revise.
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

from src.agents import AGENT_REGISTRY, CeoOrchestrator, PipelineContext
from src.agents.edl_schema import (
    AnalystReport, EdlPlan, EdlSource, SilenceSpan, WordTiming,
    VideoStyle, RenderHints, PlanSegment, CaptionLine,
)
from src.agents.audio_agent import AudioAgent
from src.agents.critic_agent import CriticAgent


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


async def main() -> int:
    assert "critic" in AGENT_REGISTRY and "audio" in AGENT_REGISTRY, "الوكلاء الجدد غير مسجلين"
    print("✓ 0) critic + audio مسجلان في الحزمة")

    ctx = SimpleNamespace(
        source_path="test.mp4", request="فيديو حماسي قصير", language="ar",
        mood_hint="قوي", target_aspect="9:16", enable_b_roll=False,
        output_dir=".montage_ai/tests", feedback=[],
    )

    # ── 1) الناقد يرفض الخطة الضعيفة ──────────────────────────────────
    critic = CriticAgent()
    plan = weak_plan(ctx)
    critique = await critic.execute(ctx, {"director": plan, "analyst": make_report()})
    assert critique.verdict == "revise", f"يجب أن يرفض الخطة الضعيفة: {critique.verdict} ({critique.score})"
    assert critique.suggestions, "يجب أن يحمل ملاحظات توجيهية"
    print(f"✓ 1) الناقد رفض الخطة الضعيفة: {critique.score:.0f}/100 ← revise ({len(critique.suggestions)} ملاحظة)")
    for s in critique.suggestions[:2]:
        print(f"     • {s}")

    # ── 2) حلقة المراجعة لا تتوقف المسار أبداً ────────────────────────
    orchestrator = CeoOrchestrator(llm=None, max_retries=2)
    artifacts = {"analyst": make_report(), "director": weak_plan(ctx)}
    outcome = await orchestrator._creative_loop(ctx, artifacts)
    assert outcome.ok, f"حلقة المراجعة يجب ألا تفشل: {outcome.errors}"
    assert "critic" in artifacts, "يجب حفظ تقرير الناقد في الأدلة"
    assert artifacts["director"] is not None, "يجب بقاء أفضل خطة سليمة"
    print(f"✓ 2) حلقة المراجعة: {outcome.artifact.verdict} بعد مراجعة مع تحذير ({len(outcome.warnings)} تحذير)")

    # ── 3) مهندس الصوت يبني خطة من كلمات Whisper ──────────────────────
    audio = AudioAgent()
    audio_plan = await audio.execute(ctx, {"director": plan, "analyst": make_report()})
    assert audio_plan.music.bpm == 128 and audio_plan.music.energy == 0.85, "ملف مزاج «قوي»"
    assert len(audio_plan.ducking) >= 1, "يجب بناء Ducking من الكلمات"
    print(f"✓ 3) الصوت: {audio_plan.music.bpm}BPM | {len(audio_plan.ducking)} Ducking | {len(audio_plan.fx)} مؤثر | {audio_plan.loudness_lufs:.0f} LUFS")

    # ── 4) تدهور أنيق: بلا كلمات → نطاقات الترجمة ─────────────────────
    empty_report = AnalystReport(
        source_path="test.mp4", duration=40.0, width=1920, height=1080, fps=30, has_audio=True,
    )
    audio_plan2 = await audio.execute(ctx, {"director": plan, "analyst": empty_report})
    assert len(audio_plan2.ducking) >= 1, "نطاقات الترجمة بديل أنيق للـ Ducking"
    print(f"✓ 4) تدهور أنيق: بلا كلمات → {len(audio_plan2.ducking)} Ducking من أسطر الترجمة")

    print("\n🎉 تكامل الناقد والصوت: 5/5 ناجحة")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
