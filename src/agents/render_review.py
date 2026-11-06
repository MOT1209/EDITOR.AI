"""مراجعة ما بعد الرندر (Post-render self-review) — درس مستفاد من OpenMontage.

بعد إنتاج ``final.mp4`` نفحص المخرَج الفعلي (لا الخطة فقط) عبر ffprobe/ffmpeg
دون أي تبعية إضافية:

- المدة صالحة (> 0) ومطابقة تقريباً للمتوقّع.
- يوجد مسار فيديو، والفيديو ليس أسود بالكامل (blackdetect).
- يوجد مسار صوت وليس صامتاً تماماً عند توقّع الصوت (volumedetect).

الوحدة نقية وقابلة للاختبار: دالة ``review_render`` ترجع ``(passed, issues, details)``؛
عند غياب ffprobe/ffmpeg أو تعذّر الفحص تُرجع نتيجة غير حاسمة (لا تمنع — تدهور أنيق).
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from src.agents.utils import get_logger, resolve_ffmpeg

logger = get_logger("render_review")

# نسبة السواد التي تُعتبر خللاً (أكثر من نصف الفيديو أسود).
BLACK_RATIO_THRESHOLD = 0.5
# مستوى صوت (dB) يُعتبر تحته صامتاً عملياً.
SILENCE_DB_THRESHOLD = -70.0


def _ffprobe_path() -> str:
    """يشتق مسار ffprobe من مسار ffmpeg (نفس المجلد عادةً)."""
    ff = resolve_ffmpeg()
    if ff.endswith("ffmpeg") or ff.endswith("ffmpeg.exe"):
        cand = ff.rsplit("ffmpeg", 1)[0] + ("ffprobe.exe" if ff.endswith(".exe") else "ffprobe")
        if Path(cand).exists():
            return cand
    return "ffprobe"


def probe(path: str) -> Optional[Dict]:
    """يرجع (duration, has_video, has_audio) عبر ffprobe، أو None عند التعذّر."""
    try:
        proc = subprocess.run(
            [
                _ffprobe_path(), "-v", "error", "-print_format", "json",
                "-show_format", "-show_streams", path,
            ],
            capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("ffprobe غير متاح: %s", exc)
        return None
    if proc.returncode != 0:
        return None
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None
    streams = data.get("streams", [])
    has_video = any(s.get("codec_type") == "video" for s in streams)
    has_audio = any(s.get("codec_type") == "audio" for s in streams)
    duration = 0.0
    try:
        duration = float(data.get("format", {}).get("duration", 0) or 0)
    except (TypeError, ValueError):
        pass
    return {"duration": duration, "has_video": has_video, "has_audio": has_audio}


def _black_ratio(path: str, duration: float, ffmpeg: str) -> Optional[float]:
    """نسبة زمن الفيديو الأسود (0..1) عبر مرشح blackdetect، أو None عند التعذّر."""
    if duration <= 0:
        return None
    try:
        proc = subprocess.run(
            [ffmpeg, "-i", path, "-vf", "blackdetect=d=0.1:pix_th=0.10",
             "-an", "-f", "null", "-"],
            capture_output=True, text=True, timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    total_black = 0.0
    for m in re.finditer(r"black_start:([\d.]+) black_end:([\d.]+)", proc.stderr):
        total_black += float(m.group(2)) - float(m.group(1))
    return min(1.0, total_black / duration)


def _audio_mean_db(path: str, ffmpeg: str) -> Optional[float]:
    """متوسط مستوى الصوت (dB) عبر volumedetect، أو None عند التعذّر."""
    try:
        proc = subprocess.run(
            [ffmpeg, "-i", path, "-af", "volumedetect", "-f", "null", "-"],
            capture_output=True, text=True, timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(r"mean_volume:\s*(-?[\d.]+) dB", proc.stderr)
    return float(m.group(1)) if m else None


def review_render(
    path: str,
    *,
    expect_audio: bool = True,
    expected_duration: float = 0.0,
) -> Tuple[bool, List[str], Dict]:
    """يفحص المخرَج الفعلي. يرجع (passed, issues, details).

    ``passed=False`` فقط عند وجود خلل حاسم (ملف مفقود/فارغ، بلا فيديو، أسود
    بالكامل، صوت متوقّع لكنه صامت). الفحوص غير الحاسمة تُسجَّل في details.
    """
    issues: List[str] = []
    details: Dict = {}

    p = Path(path)
    if not p.exists() or p.stat().st_size == 0:
        return False, ["ملف الإخراج مفقود أو فارغ"], {"exists": False}

    meta = probe(path)
    if meta is None:
        # لا نستطيع الفحص — لا نمنع (تدهور أنيق) لكن نسجّل.
        details["probe"] = "unavailable"
        return True, [], details

    details.update(meta)
    if meta["duration"] <= 0:
        issues.append("مدة الفيديو الناتج صفر أو غير معروفة")
    if not meta["has_video"]:
        issues.append("لا يوجد مسار فيديو في المخرَج")
    if expected_duration > 0 and meta["duration"] > 0:
        drift = abs(meta["duration"] - expected_duration) / expected_duration
        details["duration_drift"] = round(drift, 3)
        if drift > 0.5:
            issues.append(
                f"مدة المخرَج ({meta['duration']:.1f}s) تنحرف كثيراً عن المتوقّع "
                f"({expected_duration:.1f}s)"
            )

    ffmpeg = resolve_ffmpeg()
    if meta["has_video"]:
        black = _black_ratio(path, meta["duration"], ffmpeg)
        if black is not None:
            details["black_ratio"] = round(black, 3)
            if black >= BLACK_RATIO_THRESHOLD:
                issues.append(f"الفيديو أسود بنسبة {black*100:.0f}% — خلل رندر محتمل")

    if expect_audio:
        if not meta["has_audio"]:
            issues.append("الصوت متوقّع لكن لا يوجد مسار صوت في المخرَج")
        else:
            mean_db = _audio_mean_db(path, ffmpeg)
            if mean_db is not None:
                details["audio_mean_db"] = mean_db
                if mean_db <= SILENCE_DB_THRESHOLD:
                    issues.append(f"مسار الصوت صامت عملياً ({mean_db:.0f} dB)")

    passed = len(issues) == 0
    if passed:
        logger.info("مراجعة ما بعد الرندر: نجحت %s", details)
    else:
        logger.error("مراجعة ما بعد الرندر: فشلت — %s", issues)
    return passed, issues, details
