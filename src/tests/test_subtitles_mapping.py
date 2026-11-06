# -*- coding: utf-8 -*-
"""اختبارات خائط التوقيت في subtitles — إصلاح L-3 (خرافة القصّ في الخط الزمني).

يغطي:
1) كلمة كاملة داخل إبقاء → تحويل مطابق لطرفيها.
2) كلمة تتصالب نهاية إبقائها → تُثبَّت نهايتها عند نهاية المقطع (لا امتداد
   زائف إلى نهاية المخرَج كما كان يفعل السلوك القديم).
3) كلمة بادئة في منطقة مُقصوصة → تُسقَط بأمان (لا استثناء ولا توقيت زائف).
4) حدود to_output: قبل أول إبقاء/بعد آخر إبقاء/فجوة بين إبقاءين — قيم حدّية.
5) تدهور أنيق: خطة قصّ كليّ (لا keeps) لا تُنهَار build_ass ولا الخائط.
6) ass_timestamp: صفر، 59.9، منتصف الساعة، 90 دقيقة، وسالب.
7) ass_escape: نص عادي يبقى، أسطر جديدة، وإدارة محارف ASS الحدّية.
8) تغطية شاملة: خطة متعددة الإبقاء بسرعات مختلفة (تراكم دقيق، رتيب).
9) تكامل build_ass: تحقّق مباشر من أسطر Dialogue الناتجة.
10) منع توقيت زائف على نهاية المخرَج كاملاً من مسار الكلمات.
11) جولة كاملة: تهريب الأقواس + قراءة الطوابع عكسياً.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # src/
sys.path.insert(0, str(ROOT.parent))  # جذر المشروع (لـ src.agents)

sys.stdout.reconfigure(encoding="utf-8")

import pytest  # noqa: E402

from src.agents.subtitles import (  # noqa: E402
    _TimelineMapper,
    ass_escape,
    ass_timestamp,
    build_ass,
)
from src.agents.edl_schema import (  # noqa: E402
    CaptionLine,
    CaptionStyle,
    EdlPlan,
    EdlSource,
    PlanOverlay,
    PlanSegment,
    WordTiming,
)


# ── أدوات مساعدة ─────────────────────────────────────────────────────────
def _seg(start: float, end: float, keep: bool, speed: float = 1.0) -> PlanSegment:
    """مقطع خطة مختصر."""
    return PlanSegment(start=start, end=end, keep=keep, speed=speed)


def _mapper(*specs: tuple) -> _TimelineMapper:
    """خائط من مقاطع (start, end, keep, speed=1.0)."""
    return _TimelineMapper([_seg(*spec) for spec in specs])


def _plan(segments, captions=None, overlays=None) -> EdlPlan:
    """خطة EDL جاهزة لـ build_ass."""
    return EdlPlan(
        source=EdlSource(path="x.mp4", duration=40.0),
        segments=[_seg(*s) for s in segments],
        captions=captions or [],
        text_overlays=overlays or [],
    )


def _stamp(ts: str) -> float:
    """تحليل H:MM:SS.cs إلى ثوانٍ (عكس ass_timestamp)."""
    h, m, rest = ts.split(":")
    s, cs = rest.split(".")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(cs) / 100.0


def _dialogues(ass_text: str) -> list:
    """تعيين أسطر Dialogue إلى (بداية، نهاية، نص) بالثواني."""
    out = []
    for line in ass_text.splitlines():
        if not line.startswith("Dialogue: "):
            continue
        parts = line[len("Dialogue: "):].split(",", 9)
        out.append((_stamp(parts[1]), _stamp(parts[2]), parts[9]))
    return out


# ── خرافة القصّ L-3: مسار الكلمات ────────────────────────────────────────
def test_01_word_fully_inside_keep_maps_exactly():
    """كلمة كاملة داخل إبقاء واحد بسيط → (3→4) تُحوَّل حرفياً (بسرعة 1)."""
    m = _mapper((0, 10, True))
    ws, we = m.word_span(3.0, 4.0)
    assert ws == pytest.approx(3.0) and we == pytest.approx(4.0)
    # تكامل build_ass: الحدث يحمل التوقيت المتوقع حرفياً
    cap = CaptionLine(
        text="أهلاً بالجميع", start=3.0, end=4.0, style=CaptionStyle.KARAOKE,
        words=[WordTiming(word="أهلاً", start=3.0, end=4.0)],
    )
    events = _dialogues(build_ass(_plan([(0, 10, True)], captions=[cap])))
    assert len(events) == 1
    s, e, _ = events[0]
    assert s == pytest.approx(3.0) and e == pytest.approx(4.0)


def test_02_word_straddling_keep_end_clamps_to_keep_output_end():
    """كلمة (9→12) على إبقاء (0→10) وقصّ (10→15): نهايتها تُثبَّت عند نهاية
    الإبقاء في المخرَج (10) — السلوك القديم كان يسحبها إلى نهاية المخرَج
    كلّه (25) فتظهر معلّقة على آخر الفيديو زمنياً رغم أن مصدرها مُقصوص."""
    m = _mapper((0, 10, True), (10, 15, False), (15, 30, True))
    ws, we = m.word_span(9.0, 12.0)
    assert ws == pytest.approx(9.0)
    assert we == pytest.approx(10.0), "يجب أن تلتصق النهاية بنهاية الإبقاء"
    assert we != pytest.approx(m.to_output(30.0)), "لا امتداد إلى نهاية المخرَج"
    # تحقّق نصّي أيضاً في مخرج build_ass
    cap = CaptionLine(
        text="نهاية القصّ", start=9.0, end=12.0, style=CaptionStyle.KARAOKE,
        words=[WordTiming(word="نهاية", start=9.0, end=12.0)],
    )
    events = _dialogues(
        build_ass(_plan([(0, 10, True), (10, 15, False), (15, 30, True)], captions=[cap]))
    )
    assert len(events) == 1
    s, e, _ = events[0]
    assert s == pytest.approx(9.0) and e == pytest.approx(10.0)


def test_03_word_starting_in_cut_is_dropped_safely():
    """كلمة (11→13) تبدأ داخل قصّ (10→15) → word_span=None، وتسقط من مخرج
    build_ass بلا استثناء ولا حدث زمني مُختلق."""
    m = _mapper((0, 10, True), (10, 15, False), (15, 30, True))
    assert m.word_span(11.0, 13.0) is None
    # لا استثناء حتى مع نهاية تقع داخل الإبقاء التالي (تسالب القصّ)
    assert m.word_span(11.0, 17.0) is None
    # مسار build_ass: الكلمة تزول دون إضرار بالكلمات السليمة
    cap = CaptionLine(
        text="سلام", start=11.0, end=17.0, style=CaptionStyle.KARAOKE,
        words=[
            WordTiming(word="خارج", start=11.0, end=13.0),
            WordTiming(word="داخل", start=16.0, end=17.0),
        ],
    )
    events = _dialogues(
        build_ass(_plan([(0, 10, True), (10, 15, False), (15, 30, True)], captions=[cap]))
    )
    assert len(events) == 1  # «خارج» سقطت، «داخل» بقيت
    s, e, txt = events[0]
    assert "داخل" in txt and "خارج" not in txt
    assert s == pytest.approx(11.0), "(16→17) في المصدر = (11→12) في المخرَج"


def test_04_word_starting_exactly_at_keep_end_is_dropped():
    """كلمة تبدأ عند حافة نهاية الإبقاء تماماً (النطاق نصف مفتوح) → None."""
    m = _mapper((0, 10, True))
    assert m.word_span(10.0, 12.0) is None


# ── حدود to_output خارج الإبقاء (قيم حدّية فقط) ───────────────────────────
def test_05_to_output_boundaries_and_gap():
    """قبل أول إبقاء → 0؛ فجوة (10→15) → عتبة الإبقاء التالي (5)؛
    بعد آخر إبقاء → نهاية المخرَج (10)."""
    m = _mapper((5, 10, True), (15, 20, True))
    assert m.to_output(0.0) == pytest.approx(0.0)
    assert m.to_output(3.0) == pytest.approx(0.0), "قبل أول إبقاء"
    assert m.to_output(12.5) == pytest.approx(5.0), "فجوة → بداية الإبقاء التالي"
    assert m.to_output(25.0) == pytest.approx(10.0), "بعد آخر إبقاء → نهاية المخرَج"
    assert m.to_output(7.5) == pytest.approx(2.5), "داخل الإبقاء كما كان"


# ── التدهور الأنيق: خطة قصّ كليّ (لا keeps) ──────────────────────────────
def test_06_all_cut_plan_degrades_gracefully():
    """خطة قصّ كليّ (كل المقاطع keep=False): الخائط تعيد 0 بأمان وbuild_ass
    لا ينهار ولا يولّد أسطر Dialogue."""
    m = _mapper((0, 10, False), (10, 20, False))
    assert m.to_output(5.0) == pytest.approx(0.0)
    assert m.word_span(2.0, 3.0) is None
    ass = build_ass(_plan([(0, 10, False), (10, 20, False)]))
    assert "[Events]" in ass
    assert _dialogues(ass) == []


# ── ass_timestamp ────────────────────────────────────────────────────────
def test_07_ass_timestamp_cases():
    """صفر، 59.9s، منتصف الساعة (1:01:27.25)، 90 دقيقة، وسالب (يُثبَّت صفراً)."""
    assert ass_timestamp(0.0) == "0:00:00.00"
    assert ass_timestamp(59.9) == "0:00:59.90"
    assert ass_timestamp(3687.25) == "1:01:27.25"
    assert ass_timestamp(90 * 60) == "1:30:00.00"
    assert ass_timestamp(-3.0) == "0:00:00.00"


# ── ass_escape ───────────────────────────────────────────────────────────
def test_08_ass_escape_basics():
    """نص عادي يبقى، إزالة \\r، \\n و \\r\\n → \\N، وأقواس أوامر ASS تُهرَّب."""
    assert ass_escape("مرحبا بالعالم") == "مرحبا بالعالم"
    assert ass_escape("سطر أول\nسطر ثانٍ") == "سطر أول\\Nسطر ثانٍ"
    assert ass_escape("سطر أول\r\nسطر ثانٍ") == "سطر أول\\Nسطر ثانٍ"
    assert ass_escape("{\\an5}hack") == "\\{\\an5\\}hack"
    assert ass_escape("") == ""


# ── تغطية شاملة: عدة إبقاء بسرعات مختلفة ─────────────────────────────────
def test_09_multi_keep_mixed_speeds_total_and_monotonic():
    """خطة متعددة الإبقاء: (0→10) سرعة 1، (15→20) سرعة 2، (25→30) سرعة 1.25:
    المجموع = 10 + 2.5 + 4 = 16.5 والتحويل رتيب ومطابق داخل كل مقطع."""
    m = _mapper((0, 10, True, 1.0), (15, 20, True, 2.0), (25, 30, True, 1.25))
    assert m.to_output(30.0) == pytest.approx(16.5), "نهاية المخرَج = مجموع المدد المسرّعة"
    prev = -1.0
    for t in [0.0, 5.0, 10.0, 12.0, 15.0, 17.5, 20.0, 22.0, 25.0, 27.5, 30.0, 35.0]:
        v = m.to_output(t)
        assert v >= prev - 1e-9, f"رتابة مكسورة عند t={t}"
        prev = v
    # مطابقة داخلية لكل مقطع (تحويل خطي بسرعته)
    assert m.to_output(17.5) == pytest.approx(10.0 + 2.5 / 2.0)
    assert m.to_output(27.5) == pytest.approx(12.5 + 2.5 / 1.25)


# ── منع التوقيت الزائف على نهاية المخرَج من مسار الكلمات ─────────────────
def test_10_clamped_word_never_reaches_output_end_from_straddling():
    """كلمة تتصالب نهاية الإبقاء (5→12 على إبقاء (0→10) بسرعة 0.5 ثم
    إبقاء آخر): نهايتها عند 10/0.5=20 وليست نهاية المخرَج (20+15=35) —
    كان السلوك القديم يسحبها إلى 35 إذ لم يقع 12 في أي إبقاء."""
    m = _mapper((0, 10, True, 0.5), (15, 30, True, 1.0))
    assert m.to_output(30.0) == pytest.approx(35.0), "نهاية المخرَج للمرجعية"
    ws, we = m.word_span(5.0, 12.0)
    assert ws == pytest.approx(5.0 / 0.5)
    assert we == pytest.approx(10.0 / 0.5), "التثبيت عند نهاية الإبقاء بسرعته"
    assert we != pytest.approx(35.0), "لا سحب إلى نهاية المخرَج"


# ── تكامل build_ass: كافّة الطبقات مع الإسقاط ────────────────────────────
def test_11_build_ass_full_layers_and_drop_integration():
    """خطة واقعية: كلمة سليمة + كلمة تتصالب قصّ + كلمة في قصّ + سطر BOLD
    كامل + overlay. كل الأحداث ضمن حدود الإبقاء بلا أي توقيت زائف."""
    words = [
        WordTiming(word="سلام", start=1.0, end=2.0),     # كامل داخل (0→10)
        WordTiming(word="متقاطع", start=9.0, end=12.0),   # يتصالب نهاية القصّ
        WordTiming(word="مقصوص", start=11.0, end=13.0),   # في القصّ → يُسقَط
        WordTiming(word="ثاني", start=16.0, end=17.0),    # داخل الإبقاء الثاني
    ]
    cap = CaptionLine(
        text="تغطية", start=1.0, end=17.0, style=CaptionStyle.KARAOKE, words=words
    )
    bold = CaptionLine(
        text="شوّد أعلاه", start=2.0, end=3.0, style=CaptionStyle.BOLD, words=[]
    )
    overlay = PlanOverlay(text="مرتع", start=4.0, end=6.0)
    plan = _plan(
        [(0, 10, True), (10, 15, False), (15, 30, True)],
        captions=[cap, bold],
        overlays=[overlay],
    )
    events = _dialogues(build_ass(plan))
    assert len(events) == 5  # 3 كاريوكي (سقطت المُقصوصة) + 1 bold + 1 overlay
    karaoke = [(round(s, 2), round(e, 2)) for s, e, txt in events
               if txt.startswith("{\\an2\\fs58")]
    assert karaoke == [
        (1.0, 2.0),
        (9.0, 10.0),      # المُتصالِبة مُثبَّتة عند نهاية الإبقاء
        (11.0, 12.0),     # «ثاني»: (16→17) مصدر = (11→12) مخرَج
    ], karaoke
    all_texts = " ".join(txt for _, _, txt in events)
    assert "مقصوص" not in all_texts, "الكلمة المُقصوصة أُسقِطت بأمان"
    assert "شوّد أعلاه" in all_texts and "مرتع" in all_texts


def test_12_escape_and_timestamp_roundtrip_in_dialogue():
    """جولة كاملة: كلمة نصها أقواس ASS تُهرَّب، والطوابع تُقرأ عكسياً بدقة
    النصف المئوي من الثانية."""
    cap = CaptionLine(
        text="ممنوع", start=0.5, end=1.5, style=CaptionStyle.KARAOKE,
        words=[WordTiming(word="{وق}", start=0.5, end=1.5)],
    )
    events = _dialogues(build_ass(_plan([(0, 5, True)], captions=[cap])))
    assert len(events) == 1
    s, e, txt = events[0]
    assert s == pytest.approx(0.5) and e == pytest.approx(1.5)
    assert "\\{وق\\}" in txt
