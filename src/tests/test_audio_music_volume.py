# -*- coding: utf-8 -*-
"""اختبار إصلاح حجم الموسيقى (music_volume) في وكيل الصوت.

الهدف: توثيق أن ``0.0`` (موسيقى مكتومة عمداً) ليست قيمة «missing»،
لذلك يجب أن تمر كما هي (0.0) وليس أن تُستبدل بـ 0.5. القيمة ``None``
هي فقط التي تُعد «غير محدّدة» وتُستبدل بالافتراضي 0.5.
"""
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent  # src/
sys.path.insert(0, str(ROOT.parent))  # جذر المشروع (لـ src.agents)

from src.agents.edl_schema import EdlPlan, EdlSource, VideoStyle, RenderHints  # noqa: E402
from src.agents.audio_agent import AudioAgent  # noqa: E402


def _plan(music_volume):
    """يبني خطة EDL مصغّرة مع قيمة music_volume المطلوبة (None مسموح بالتجاوز)."""
    source = EdlSource(
        path="t.mp4", duration=10.0, width=1920, height=1080, fps=30, has_audio=True,
    )
    plan = EdlPlan(
        version="1.0",
        title="اختبار",
        description="d",
        tags=[],
        summary="s",
        source=source,
        style=VideoStyle(music_volume=0.5),
        render=RenderHints(),
        segments=[],
        captions=[],
    )
    # تجاوز التحقق لاختبار حالة None (الـ schema لا يقبل None مباشرة)
    plan.style.music_volume = music_volume
    return plan


def _ctx():
    return SimpleNamespace(source_path="t.mp4", output_dir=".montage_ai/tests")


def _result_volume(music_volume):
    plan = _plan(music_volume)
    audio_plan = AudioAgent()._build_sync(_ctx(), plan, None)
    return audio_plan.music.volume


def test_music_volume_none_defaults_to_half():
    """None → 0.5 (سلوك كما كان: غير محدّد يأخذ الافتراضي)."""
    assert _result_volume(None) == 0.5


def test_music_volume_zero_stays_muted():
    """0.0 → 0.0 (الإصلاح: مكتوم عمداً وليس missing)."""
    assert _result_volume(0.0) == 0.0


def test_music_volume_point_three_passes():
    """0.3 → 0.3 (تجاوز عادي)."""
    assert _result_volume(0.3) == 0.3


def test_music_volume_one_passes():
    """1.0 → 1.0 (الحد الأعلى كما كان)."""
    assert _result_volume(1.0) == 1.0


if __name__ == "__main__":
    for fn in (
        test_music_volume_none_defaults_to_half,
        test_music_volume_zero_stays_muted,
        test_music_volume_point_three_passes,
        test_music_volume_one_passes,
    ):
        fn()
        print(f"✓ {fn.__name__}")
    print("\n🎉 اختبارات music_volume: 4/4 ناجحة")