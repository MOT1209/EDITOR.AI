"""غلاف ثنائية auto-editor (WyattBlue) — اختياري + احتياطات ffmpeg.

القدرات المضافة للمسار (كلها تتدهور بأناقة بلا الثنائية):
1. ``detect_motion_spans``  — قصّ السكون (المشاهد الثابتة) عبر ``--edit motion``؛
   الاحتياط: ffmpeg ``freezedetect``.
2. ``detect_black_spans``   — الإطارات السوداء عبر ``--edit "(not blackdetect)"``؛
   الاحتياط: ffmpeg ``blackdetect``.
3. ``loudness_tiers``       — طبقات الجلوسة (قصّ / عادي / سريع) عبر طبقات
   ``--edit:N/--when:N``؛ الاحتياط: عتبتا silencedetect منفصلتان.
4. ``edl_to_cut_ranges``    — ترجمة مقاطع EDL المقصوصة إلى صيغة ``--cut``.
5. ``preview_stats``        — إحصائيات القص من EDL (حتمية، بلا ثنائية).

تحليل auto-editor يُنفَّذ بتصدير الجدول الزمني v3 (``--export json``) وقراءة
مقاطع المسار الأساسي؛ الفجوات بينها = الفترات الخاملة. بلا الثنائية تبقى
احتياطات ffmpeg فقط — فلا يتعطل المسار (مبدأ التدهور الأنيق).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from src.agents.edl_schema import EdlPlan, SilenceSpan
from src.agents.utils import get_logger, resolve_auto_editor, resolve_ffmpeg

logger = get_logger("auto_editor")

MIN_SPAN_SECONDS = 0.3  # مطابقة لـ MIN_SILENCE_SECONDS في المحلل

# عتبات طبقات الجلوسة (تقريب تحفّظي لقواعد auto-editor الافتراضية):
#  - أقل من CUT_DB: صمت يُقصّ.
#  - دون NORMAL_DB: هادئ يُبقي 1x.
#  - فوق NORMAL_DB: صاخب يُسارَع (FAST_SPEED).
CUT_DB = -30
NORMAL_DB = -12
FAST_SPEED = 1.3

TIME_PAT = re.compile(r"(\d+):(\d+):(\d+(?:\.\d+)?)")


@dataclass
class TierSpan:
    """فترة بطبقة جلوسة: cut (قصّ) / normal (عادي 1x) / fast (سريع)."""

    start: float
    end: float
    tier: str  # "cut" | "normal" | "fast"


# ---------------------------------------------------------------------------
# التنفيذ عبر الثنائية
# ---------------------------------------------------------------------------

def has_auto_editor() -> bool:
    """هل الثنائية متوفرة (AUTO_EDITOR_PATH / .montage_ai/bin / PATH)؟"""
    return resolve_auto_editor() is not None


def run_auto_editor(args: List[str], timeout: int = 300) -> subprocess.CompletedProcess:
    """يشغّل الثنائية بوسائط إضافية ويعيد النتيجة (يرفع إن كانت غير مثبتة)."""
    exe = resolve_auto_editor()
    if not exe:
        raise RuntimeError(
            "auto-editor غير مثبت — شغّل: python scripts/install-auto-editor.py"
        )
    logger.info("auto-editor: %s %s", Path(exe).name, " ".join(args))
    return subprocess.run(
        [exe, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


def _export_v3(args: List[str], timeout: int = 300) -> Optional[Dict[str, Any]]:
    """يشغّل auto-editor بتعبير ``--edit`` ويصدّر الجدول الزمني v3 كقاموس.

    يرجع ``None`` عند أي فشل (ثنائية غائبة / رمز خطأ / JSON غير صالح) ليتدهور
    الاستدعاء إلى احتياط ffmpeg دون استثناء.
    """
    fd, tmp = tempfile.mkstemp(prefix="montage_ae_", suffix=".v3")
    os.close(fd)
    try:
        proc = run_auto_editor(
            [*args, "--margin", "0", "--smooth", "0", "--export", "json", "-o", tmp],
            timeout=timeout,
        )
        if proc.returncode != 0:
            logger.warning("auto-editor فشل (رمز %s): %s", proc.returncode, (proc.stderr or "")[:300])
            return None
        return json.loads(Path(tmp).read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 — أي فشل يتحول لاحتياط ffmpeg
        logger.warning("تصدير v3 غير متاح: %s", exc)
        return None
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def _fps(v3: Dict[str, Any]) -> float:
    """يحوّل ``timebase`` (مثل "30000/1001") إلى معدل إطارات."""
    try:
        num, den = str(v3.get("timebase") or "30/1").split("/")
        return float(num) / float(den)
    except (ValueError, ZeroDivisionError):
        return 30.0


def _base_clips(v3: Dict[str, Any]) -> List[Dict[str, Any]]:
    """مقاطع المسار الأساسي (v[0] ثم a[0]) — يعبّر عن ما يُحتفظ به."""
    for key in ("v", "a"):
        tracks = v3.get(key) or []
        if tracks and isinstance(tracks[0], list) and tracks[0]:
            return [c for c in tracks[0] if isinstance(c, dict)]
    return []


def _clips_source_ranges(v3: Dict[str, Any]) -> List[Tuple[float, float, Optional[float]]]:
    """نطاقات المصدر المحتفظ بها بالثواني: (بداية، نهاية، سرعة اختيارية).

    السرعة تُقرأ من تأثير ``speed:*`` في المقاطع المميّزة بطبقة ``--when:N``.
    """
    fps = _fps(v3)
    out: List[Tuple[float, float, Optional[float]]] = []
    for clip in _base_clips(v3):
        effects = clip.get("effects") or []
        if "cut" in effects:
            continue  # مقطع مقطوع بالكامل
        offset = float(clip.get("offset") or 0) / fps
        dur = float(clip.get("dur") or 0) / fps
        speed: Optional[float] = None
        for e in effects:
            if isinstance(e, str) and e.startswith("speed:"):
                try:
                    speed = float(e.split(":", 1)[1])
                except ValueError:
                    pass
        out.append((offset, offset + dur, speed))
    return out


def _inactive_spans(
    ranges: List[Tuple[float, float, Optional[float]]],
    duration: Optional[float],
    min_duration: float = MIN_SPAN_SECONDS,
) -> List[Tuple[float, float]]:
    """الفترات الخاملة = الفجوات بين نطاقات المصدر المحتفظ بها (بالثواني)."""
    spans: List[Tuple[float, float]] = []
    cursor = 0.0
    for start, end, _ in sorted(ranges, key=lambda r: r[0]):
        if start - cursor >= min_duration:
            spans.append((cursor, start))
        cursor = max(cursor, end)
    if duration and duration - cursor >= min_duration:
        spans.append((cursor, duration))
    return spans


def detect_motion_spans(
    source: str,
    threshold: float = 0.02,
    duration: Optional[float] = None,
    min_duration: float = MIN_SPAN_SECONDS,
) -> List[SilenceSpan]:
    """فترات السكون (المشاهد الثابتة) — عبر ``--edit motion`` أو احتياط freezedetect."""
    v3 = _export_v3([source, "--edit", f"motion:{threshold}"])
    if v3 is not None:
        ranges = _clips_source_ranges(v3)
        return [SilenceSpan(start=s, end=e) for s, e in _inactive_spans(ranges, duration, min_duration)]
    logger.info("لا auto-editor للحركة — احتياط ffmpeg freezedetect")
    return _ffmpeg_freeze_spans(source, min_duration)


def detect_black_spans(
    source: str,
    duration: Optional[float] = None,
    min_duration: float = MIN_SPAN_SECONDS,
) -> List[SilenceSpan]:
    """فترات الإطارات السوداء — عبر ``--edit "(not blackdetect)"`` أو احتياط blackdetect."""
    v3 = _export_v3([source, "--edit", "(not blackdetect:0.98)"])
    if v3 is not None:
        ranges = _clips_source_ranges(v3)
        return [SilenceSpan(start=s, end=e) for s, e in _inactive_spans(ranges, duration, min_duration)]
    logger.info("لا auto-editor للسواد — احتياط ffmpeg blackdetect")
    return _ffmpeg_black_spans(source, min_duration)


def loudness_tiers(
    source: str,
    duration: Optional[float] = None,
    min_duration: float = MIN_SPAN_SECONDS,
) -> List[TierSpan]:
    """طبقات الجلوسة عبر طبقات auto-editor (قصّ/عادي/سريع) — أو احتياط ffmpeg.

    الأوامر: ``--edit audio:CUT_DB`` (صمت يبقى 0) + ``--edit:2 audio:NORMAL_DB``
    (الهادئ 1x) + ``--when:2 speed:FAST_SPEED`` (الصاخب يُسارَع). المقاطع بلا
    تأثير سرعة = عادي، والمسرَّعة = سريع، والفجوات = قصّ.
    """
    v3 = _export_v3([
        source,
        "--edit", f"audio:{CUT_DB}dB",
        "--edit:2", f"audio:{NORMAL_DB}dB",
        "--when:2", f"speed:{FAST_SPEED}",
    ])
    if v3 is not None:
        return _tiers_from_ranges(_clips_source_ranges(v3), duration, min_duration)
    logger.info("لا auto-editor للطبقات — احتياط ffmpeg بعتبتي صمت")
    return _fallback_tiers(source, duration, min_duration)


def _tiers_from_ranges(
    ranges: List[Tuple[float, float, Optional[float]]],
    duration: Optional[float],
    min_duration: float,
) -> List[TierSpan]:
    tiers: List[TierSpan] = [
        TierSpan(start=s, end=e, tier="fast" if (speed or 1.0) > 1.001 else "normal")
        for s, e, speed in ranges
        if e - s >= min_duration
    ]
    for s, e in _inactive_spans(ranges, duration, min_duration):
        tiers.append(TierSpan(start=s, end=e, tier="cut"))
    tiers.sort(key=lambda t: t.start)
    return tiers


# ---------------------------------------------------------------------------
# احتياطات ffmpeg
# ---------------------------------------------------------------------------

def _ffmpeg_run(args: List[str], timeout: int = 180) -> Tuple[str, str]:
    proc = subprocess.run(
        [resolve_ffmpeg(), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    return proc.stdout or "", proc.stderr or ""


def probe_duration(source: str) -> float:
    """مدة المصدر بالثواني من ``ffmpeg -i`` (سريع، بلا ffprobe)."""
    try:
        _, err = _ffmpeg_run(["-hide_banner", "-i", source])
    except Exception:  # noqa: BLE001
        return 0.0
    m = TIME_PAT.search(err or "")
    if not m:
        return 0.0
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def _parse_start_end(out: str, kind: str) -> List[Tuple[float, float]]:
    """يفسّر مخرجات silencedetect/freezedetect/blackdetect (start/end)."""
    starts = [float(x) for x in re.findall(rf"{kind}_start:\s*([\d.]+)", out)]
    ends = [float(x) for x in re.findall(rf"{kind}_end:\s*([\d.]+)", out)]
    spans = []
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else s + MIN_SPAN_SECONDS
        if e - s >= MIN_SPAN_SECONDS:
            spans.append((s, e))
    return spans


def _ffmpeg_freeze_spans(source: str, min_duration: float) -> List[SilenceSpan]:
    """freezedetect: يكشف المشاهد الثابتة (اختلاف بكسلي تحت n لمدة d)."""
    try:
        _, err = _ffmpeg_run([
            "-hide_banner", "-i", source,
            "-vf", f"freezedetect=n=0.003:d={min_duration}",
            "-f", "null", "-",
        ])
    except Exception as exc:  # noqa: BLE001
        logger.warning("freezedetect فشل: %s", exc)
        return []
    spans = [SilenceSpan(start=s, end=e) for s, e in _parse_start_end(err or "", "lavfi.freezedetect.freeze")]
    return [s for s in spans if s.end - s.start >= min_duration]


def _ffmpeg_black_spans(source: str, min_duration: float) -> List[SilenceSpan]:
    """blackdetect: يكشف الإطارات/التلاشي السوداء."""
    try:
        _, err = _ffmpeg_run([
            "-hide_banner", "-i", source,
            "-vf", f"blackdetect=d={min_duration}:pix_th=0.10",
            "-f", "null", "-",
        ])
    except Exception as exc:  # noqa: BLE001
        logger.warning("blackdetect فشل: %s", exc)
        return []
    spans = [SilenceSpan(start=s, end=e) for s, e in _parse_start_end(err or "", "lavfi.blackdetect.black")]
    return [s for s in spans if s.end - s.start >= min_duration]


def _ffmpeg_silence_spans(source: str, noise_db: float, min_duration: float) -> List[SilenceSpan]:
    """silencedetect بعتبة محددة (dB) — لطبقات الجلوسة الاحتياطية."""
    try:
        _, err = _ffmpeg_run([
            "-hide_banner", "-i", source,
            "-af", f"silencedetect=noise={noise_db}dB:d={min_duration}",
            "-f", "null", "-",
        ])
    except Exception as exc:  # noqa: BLE001
        logger.warning("silencedetect (%sdB) فشل: %s", noise_db, exc)
        return []
    return [SilenceSpan(start=s, end=e) for s, e in _parse_start_end(err or "", "silence")]


def _fallback_tiers(
    source: str,
    duration: Optional[float],
    min_duration: float,
) -> List[TierSpan]:
    """طبقات احتياطية: قصّ (صمت <-30dB) / عادي (هادئ <-12dB) / سريع (فوقها)."""
    duration = duration or probe_duration(source)
    cut = _ffmpeg_silence_spans(source, CUT_DB, min_duration)
    quiet = _ffmpeg_silence_spans(source, NORMAL_DB, min_duration)

    # normal = هادئ غير صامت
    normal: List[Tuple[float, float]] = []
    for q in quiet:
        rem = [(q.start, q.end)]
        for c in cut:
            merged: List[Tuple[float, float]] = []
            for s, e in rem:
                if c.end <= s or c.start >= e:
                    merged.append((s, e))
                else:
                    if c.start > s:
                        merged.append((s, c.start))
                    if c.end < e:
                        merged.append((c.end, e))
            rem = merged
        normal.extend(rem)

    tiers: List[TierSpan] = [TierSpan(start=c.start, end=c.end, tier="cut") for c in cut]
    tiers += [TierSpan(start=s, end=e, tier="normal") for s, e in normal if e - s >= min_duration]
    # سريع = مكمّل الهادئ داخل حدود المصدر
    occupied = sorted([(c.start, c.end) for c in cut] + [(s, e) for s, e in normal])
    cursor = 0.0
    for s, e in occupied:
        if s - cursor >= min_duration:
            tiers.append(TierSpan(start=cursor, end=s, tier="fast"))
        cursor = max(cursor, e)
    if duration and duration - cursor >= min_duration:
        tiers.append(TierSpan(start=cursor, end=duration, tier="fast"))
    tiers.sort(key=lambda t: t.start)
    return tiers


# ---------------------------------------------------------------------------
# ترجمة EDL → auto-editor + إحصائيات
# ---------------------------------------------------------------------------

def edl_to_cut_ranges(plan: EdlPlan) -> str:
    """يبني وسيط ``--cut`` (بإطارات المصدر) من مقاطع EDL المقصوصة.

    auto-editor يقبل عدة نطاقات مفصولة بمسافات بصيغة ``start,end`` حيث الوحدة
    الافتراضية هي الزمن الأساسي (إطارات) — نحول الثواني إلى إطارات بالتقريب.
    """
    fps = max(float(plan.source.fps) or 30.0, 1.0)
    ranges: List[str] = []
    for seg in plan.segments:
        if not seg.keep:
            s = max(0, int(round(seg.start * fps)))
            e = max(0, int(round(seg.end * fps)))
            if e > s:
                ranges.append(f"{s},{e}")
    return " ".join(ranges)


def preview_stats(plan: EdlPlan) -> Dict[str, Any]:
    """إحصائيات معاينة القص المحسوبة من EDL (حتمية، بلا ثنائية)."""
    kept = sum(seg.end - seg.start for seg in plan.segments if seg.keep)
    cut = sum(seg.end - seg.start for seg in plan.segments if not seg.keep)
    total = kept + cut
    clips = sum(1 for seg in plan.segments if seg.keep)
    return {
        "keptSeconds": round(kept, 2),
        "cutSeconds": round(cut, 2),
        "totalSeconds": round(total, 2),
        "keptPercent": round(kept / total * 100, 1) if total > 0 else 0.0,
        "clipCount": clips,
    }
