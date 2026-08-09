# -*- coding: utf-8 -*-
"""اختبار المرحلة 2 (وجه + متحدثون + مزود) بمعزل عن حزمة الوكلاء المكسورة مؤقتاً
(الوكيل الآخر يبني audio_agent/critic_agent — نعطّل __init__ عبر sys.modules)."""
import sys, types, importlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # src/

# حزمة src.agents بلا __init__.py (تجاوز الاستيرادات المكسورة)
for name, path in (("src", ROOT.parent), ("src.agents", ROOT / "agents")):
    mod = types.ModuleType(name)
    mod.__path__ = [str(path)]
    sys.modules[name] = mod

sys.stdout.reconfigure(encoding="utf-8")

edl = importlib.import_module("src.agents.edl_schema")
utils = importlib.import_module("src.agents.utils")
director = importlib.import_module("src.agents.director_agent")

from types import SimpleNamespace
from src.agents.director_agent import DirectorAgent
from src.agents.edl_schema import (
    AnalystReport, FaceTrack, SilenceSpan, SpeakerSegment, WordTiming,
)
from src.agents.utils import build_llm_model, provider_prefix

# ── 1) موجّه المزود (2.3) ──────────────────────────────────────────────
assert build_llm_model("https://api.groq.com/openai/v1", "llama-3.3-70b") == "groq/llama-3.3-70b"
assert build_llm_model("https://openrouter.ai/api/v1", "deepseek-r1") == "openrouter/deepseek-r1"
assert build_llm_model("https://my.dev.tier/v1", "custom-model") == "custom-model"  # مخصص بلا بادئة
assert build_llm_model("https://api.groq.com/openai/v1", "qwen/qwen3.6-27b") == "qwen/qwen3.6-27b"
assert provider_prefix("https://api.anthropic.com") == "anthropic/"
print("✓ 2.3 موجّه المزود: 5 حالات")

# ── 2) قص يتبع الوجه (2.1) ─────────────────────────────────────────────
report = AnalystReport(
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
ctx = SimpleNamespace(
    source_path="test.mp4", request="اختبار", language="ar",
    mood_hint="قوي", target_aspect="9:16", enable_b_roll=False,
)
d = DirectorAgent()
plan = d._rule_based_plan(ctx, report)
plan = d._apply_face_tracks(plan, report)
crops = [(s.start, s.end, s.crop.center_x, s.crop.center_y)
         for s in plan.segments if s.keep and s.crop]
assert len(crops) >= 2, f"يجب أن تحصل مقاطع الإبقاء على crop، وُجد {len(crops)}"
first = crops[0]
assert 0.15 <= first[2] <= 0.5, f"مركز أول مقطع يجب أن يقترب من الوجه: {first}"
print("  مسارات القص:", [(round(s, 1), round(e, 1), round(x, 2)) for s, e, x, _ in crops])
# تحقق: المركز يتغير عبر الزمن (الوجه يتحرك من 0.3 → 0.7)
xs = [x for _, _, x, _ in crops]
assert max(xs) - min(xs) > 0.1, f"يجب أن يتحرك المركز مع الوجه: {xs}"
print("✓ 2.1 قص يتبع الوجه: مراكز متحركة مع تنعيم EMA")

# ── 3) تلوين المتحدثين (2.2) ───────────────────────────────────────────
plan = d._annotate_speakers(plan, report)
speaker_labels = {c.speaker for c in plan.captions if c.speaker}
assert speaker_labels, "يجب أن تُعلَّم الترجمات بمتحدث"
print(f"  متحدثو الترجمات: {sorted(speaker_labels)}")
print("✓ 2.2 تلوين المتحدثين: ترجمات موسومة")

# ── 4) بدون وجوه/متحدثين → سلوك سابق دون تغيير ─────────────────────────
plain = AnalystReport(source_path="test.mp4", duration=5.0, width=1920, height=1080, fps=30, has_audio=True)
plan2 = d._rule_based_plan(ctx, plain)
plan2 = d._apply_face_tracks(plan2, plain)
for s in plan2.segments:
    if s.keep and s.crop:
        assert s.crop.center_x == 0.5 and s.crop.center_y == 0.42, "بلا وجوه يبقى المركز الافتراضي"
print("✓ 4) تدهور أنيق: بلا بيانات وجه/متحدث → افتراضيات سابقة")

print("\n🎉 المرحلة 2 (جزئي — بمعزل): 4/4 ناجحة")
