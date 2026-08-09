"""توليد ترجمات ASS محروقة في الفيديو (subtitle burn-in).

التصميم:
- تُبنى التوقيتات على **زمن المخرَج** وليس زمن المصدر: بعد قص المقاطع وتسريعها
  يصبح الخط الزمني مضغوطاً، فنحوّل كل توقيت مصدر إلى توقيته في المخرَج عبر
  المرور على مقاطع الإبقاء المرتبة (نفس منطق concat في أمر ffmpeg).
- أسلوب karaoke يُصدر كلمة-بكلمة (نمط Hormozi الشائع لـ Reels/Shorts)؛
  الأنماط الأخرى سطراً كاملاً.
- ملف واحد ``captions.ass`` بجوار المخرَج ويُمرَّر لمرشح ``subtitles`` باسم
  الملف المجرّد فقط (تجنباً لخلل مرشح ffmpeg مع نقطتين في مسار Windows —
  الدرس من طبقة Next.js) مع تشغيل ffmpeg بـ cwd = مجلد الملف.
"""
from __future__ import annotations

from typing import Dict, List

from src.agents.edl_schema import CaptionStyle, EdlPlan, PlanSegment

# مواضع النصوص التوضيحية → كود محاذاة ASS (\an)
ALIGN_CODE: Dict[str, int] = {"bottom": 2, "center": 5, "top": 8}

# ألوان ASS بصيغة &HBBGGRR& (ترتيب معكوس عن CSS)
KARAOKE_COLOR = "&H00FFFF&"  # أصفر فاقع — الكلمة النشطة
BODY_COLOR = "&H00FFFFFF&"  # أبيض


def ass_timestamp(seconds: float) -> str:
    """تحويل ثوانٍ إلى H:MM:SS.cs (خانتا سنتي ثانية — صيغة ASS)."""
    cs = max(0, int(round(seconds * 100)))
    h = cs // 360000
    m = (cs % 360000) // 6000
    s = (cs % 6000) // 100
    csr = cs % 100
    return f"{h}:{m:02d}:{s:02d}.{csr:02d}"


def ass_escape(text: str) -> str:
    """يهيّئ النص لسطر Dialogue (سطر واحد، أسطر جديدة → \\N)."""
    return str(text).replace("\r", "").replace("\n", "\\N")


class _TimelineMapper:
    """يحوّل زمن المصدر إلى زمن المخرَج عبر مقاطع الإبقاء المرتبة."""

    def __init__(self, segments: List[PlanSegment]) -> None:
        self._keeps = [s for s in segments if s.keep]
        # مجاميع تراكمية (مدة المخرَج قبل كل مقطع)
        self._cursor = [0.0]
        acc = 0.0
        for s in self._keeps:
            acc += (s.end - s.start) / max(s.speed, 1e-9)
            self._cursor.append(acc)

    def to_output(self, t: float) -> float:
        for i, seg in enumerate(self._keeps):
            if seg.start <= t < seg.end:
                return self._cursor[i] + (t - seg.start) / max(seg.speed, 1e-9)
        return self._cursor[-1]  # خارج المقاطع → نهاية المخرَج


def build_ass(plan: EdlPlan, width: int = 720, height: int = 1280) -> str:
    """يبني محتوى ASS: الترجمة (سطر أو كلمة-بكلمة) + النصوص التوضيحية."""
    mapper = _TimelineMapper(plan.segments)
    events: List[str] = []

    if plan.style.captions:
        for cap in plan.captions:
            s, e = mapper.to_output(cap.start), mapper.to_output(cap.end)
            if e - s < 0.05:
                continue
            if cap.style == CaptionStyle.KARAOKE and cap.words:
                # كلمة-بكلمة: كل كلمة تظهر وحدها لحظة نطقها (نمط Hormozi).
                for w in cap.words:
                    ws, we = mapper.to_output(w.start), mapper.to_output(w.end)
                    if we - ws < 0.05:
                        continue
                    tag = f"{{\\an2\\fs58\\b1\\c{KARAOKE_COLOR}}}"
                    events.append(
                        f"Dialogue: 1,{ass_timestamp(ws)},{ass_timestamp(we)},Default,,0,0,0,,"
                        f"{tag}{ass_escape(w.word)}"
                    )
            else:
                bold = "\\b1" if cap.style == CaptionStyle.BOLD else ""
                tag = f"{{\\an2\\fs48{bold}\\c{BODY_COLOR}}}"
                events.append(
                    f"Dialogue: 0,{ass_timestamp(s)},{ass_timestamp(e)},Default,,0,0,0,,"
                    f"{tag}{ass_escape(cap.text)}"
                )

    for ov in plan.text_overlays:
        s, e = mapper.to_output(ov.start), mapper.to_output(ov.end)
        if e - s < 0.05 or not ov.text:
            continue
        align = ALIGN_CODE.get(ov.position.value, 5)
        tag = f"{{\\an{align}\\fs40\\b1\\c{BODY_COLOR}}}"
        events.append(
            f"Dialogue: 2,{ass_timestamp(s)},{ass_timestamp(e)},Default,,0,0,0,,"
            f"{tag}{ass_escape(ov.text)}"
        )

    header = "\n".join(
        [
            "[Script Info]",
            "ScriptType: v4.00+",
            f"PlayResX: {width}",
            f"PlayResY: {height}",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            "Style: Default,Arial,44,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,30,1",
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        ]
    )
    return header + "\n" + "\n".join(events) + "\n"
