# -*- coding: utf-8 -*-
"""وكيل الناقد الإبداعي (Creative Critic) — بوابة الجودة الإبداعية بين المخرج والرندر.

الدور:
- يراجع خطة EDL التي أنتجها المخرج (LLM أو قواعد) بعد اجتيازها البوابة البنيوية
  ``validate_plan``، ويقيّمها إبداعياً: حضور الـ Hook، الإيقاع، تنوّع السرعة،
  الصمت المتبقي، تغطية الترجمة، B-Roll، وقص 9:16.
- ينتج ``CritiqueReport`` (درجة 0..100 + حكم approve/revise + نقاط قوة + ملاحظات
  عربية قابلة للتنفيذ) — والمديرة التنفيذية تعيد المخرج بالملاحظات عند ``revise``
  (حلقة التغذية الراجعة التي صُمم لها ``director.execute(feedback=...)`` أصلاً).

التدهور الأنيق:
- نقد قواعد (قواعد حتمية بلا LLM) — لا يحتاج crewai ولا مفتاح API.
- عند نفاد محاولات المراجعة يمرر المسار بأفضل خطة سليمة مع تحذير (الناقد مرشد
  جودة، والبوابة البنيوية تبقى الحارس الصارم الوحيد).
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Literal, Optional

from pydantic import Field

from src.agents.edl_schema import (
    AnalystReport,
    EdlBase,
    EdlPlan,
    MusicMood,
    PlanSegment,
)
from src.agents.registry import register_agent
from src.agents.utils import get_logger

# درجة القبول: الخطة عندها أو فوقها تُمرَّر للرندر مباشرة
APPROVE_THRESHOLD = 70.0
# سقف الملاحظات التي تُرسل للمخرج في كل جولة مراجعة
MAX_SUGGESTIONS_PER_ROUND = 6

# كلمات مفتاحية تدل على طلب «حماسي» (يستحق Hook نصي)
HYPE_KEYWORDS = ("حماس", "shorts", "شورت", "ترند", "فيروس")


class CritiqueReport(EdlBase):
    """تقرير الناقد — يُحفظ في ``pipeline/<job>/critic.json`` ويُعرض للمستخدم.

    ``score``: 0..100 (100 = جاهزة للرندر). ``verdict``: approve/revise.
    ``suggestions`` ملاحظات عربية توجّه المخرج في المحاولة التالية.
    """

    score: float = 100.0
    verdict: Literal["approve", "revise"] = "approve"
    strengths: List[str] = Field(default_factory=list)
    suggestions: List[str] = Field(default_factory=list)
    metrics: Dict[str, Any] = Field(default_factory=dict)
    notes: List[str] = Field(default_factory=list)


@register_agent("critic")
class CriticAgent:
    """الناقد الإبداعي — يقيس جودة الخطة ويوجه تحسيناتها بقواعد حتمية."""

    STAGE = "critic"

    def __init__(self, llm: Optional[object] = None, verbose: bool = False) -> None:
        self.logger = get_logger("critic")
        self.llm = llm
        self.verbose = verbose

    async def execute(self, ctx: object, prior: dict) -> CritiqueReport:
        """يراجع خطة EDL (في ``prior['director']``) وينتج تقرير نقد حتمياً."""
        plan: EdlPlan = prior.get("director")
        if plan is None:
            raise ValueError("الناقد يحتاج خطة EDL في prior['director']")
        report: Optional[AnalystReport] = prior.get("analyst") or None
        self.logger.info("مراجعة الخطة: «%s» (%d مقاطع)", plan.title, len(plan.segments))
        critique = await asyncio.to_thread(self._critique_sync, ctx, plan, report)
        self.logger.info(
            "الناقد: درجة %.0f/100 → %s (%d ملاحظة)",
            critique.score, critique.verdict, len(critique.suggestions),
        )
        return critique

    def _critique_sync(
        self,
        ctx: object,
        plan: EdlPlan,
        report: Optional[AnalystReport],
    ) -> CritiqueReport:
        suggestions: List[str] = []
        strengths: List[str] = []
        notes: List[str] = []
        score = 100.0
        metrics: Dict[str, Any] = {}

        duration = plan.source.duration if plan.source else 0.0
        keeps: List[PlanSegment] = [s for s in plan.segments if s.keep]
        if not keeps:
            return CritiqueReport(
                score=0.0,
                verdict="revise",
                suggestions=["الخطة بلا مقاطع إبقاء — الناتج سيكون فارغاً"],
                notes=["فشل هيكلي — يمنعها أيضاً validate_plan"],
            )

        # 1) Hook مبكر: أول مقطع إبقاء خلال 3 ثوانٍ
        first_start = min(s.start for s in keeps)
        metrics["first_keep_seconds"] = round(first_start, 1)
        if first_start > 3.0 and duration > 10:
            score -= 15
            suggestions.append(
                f"الخطة تبدأ بعد {first_start:.1f}ث — لا Hook في أول 3 ثوانٍ؛ ابدأ بلحظة مشوّقة أو نص جذاب"
            )
        else:
            strengths.append("بداية قوية (Hook مبكر)")

        # 2) الإيقاع: متوسط وطول المقاطع
        avg_keep = sum(s.end - s.start for s in keeps) / len(keeps)
        longest_keep = max(s.end - s.start for s in keeps)
        metrics["avg_keep_seconds"] = round(avg_keep, 1)
        metrics["longest_keep_seconds"] = round(longest_keep, 1)
        if avg_keep > 25 and duration > 60:
            score -= 12
            suggestions.append(
                f"متوسط المقطع {avg_keep:.0f}ث — إيقاع بطيء للشورتات؛ اقسّم المحتوى إلى مقاطع 5-15 ثانية"
            )
        elif avg_keep < 1.0 and len(keeps) > 3:
            score -= 5
            suggestions.append("مقاطع قصيرة جداً (أقل من ثانية) — إيقاع متقطع يرهق المشاهد")
        elif avg_keep <= 20:
            strengths.append(f"إيقاع جيد للشورتات (متوسط {avg_keep:.0f}ث)")
        if longest_keep > 45 and duration > 60:
            score -= 8
            suggestions.append(
                f"مقطع واحد طويل {longest_keep:.0f}ث — الأطول من 45 ثانية يفقد الالتفاف في الفيديو العمودي"
            )

        # 3) تنوّع السرعة
        speeds = {round(s.speed or 1.0, 2) for s in keeps}
        metrics["distinct_speeds"] = len(speeds)
        if len(speeds) <= 1 and duration >= 30:
            score -= 10
            suggestions.append(
                "سرعة موحّدة بلا تنوّع — أبطئ (speed<1) اللحظات المهمة وسرّع (speed>1) الأجزاء البطيئة"
            )

        # 4) صمت متبقٍ داخل مقاطع الإبقاء
        if report is not None:
            kept_silences = [
                sil
                for sil in report.silences
                if sil.end - sil.start >= 1.0
                and any(s.start <= sil.start + 0.05 and sil.end <= s.end + 0.05 for s in keeps)
            ]
            metrics["kept_silences_over_1s"] = len(kept_silences)
            if kept_silences:
                score -= 12
                suggestions.append(
                    f"{len(kept_silences)} فترة صمت (≥1ث) ما زالت داخل مقاطع إبقاء — اقصصها أو قلّصها"
                )

        # 5) تغطية الترجمة
        if plan.style.captions:
            if not plan.captions:
                score -= 15
                suggestions.append("الترجمات مفعّلة لكن لا أسطر ترجمة — فعّل الترجمة الكلمة-بكلمة")
            elif report is not None and report.words:
                speech_dur = max(sum(w.end - w.start for w in report.words), 1e-06)
                captions_dur = sum(l.end - l.start for l in plan.captions)
                coverage = captions_dur / speech_dur
                metrics["caption_coverage"] = round(coverage, 2)
                if coverage < 0.6:
                    score -= 8
                    suggestions.append(
                        f"تغطية الترجمة {coverage:.0%} فقط من الكلام — وسّعها لتغطي كل الجُمل المهمة"
                    )
                else:
                    strengths.append(f"تغطية ترجمة قوية ({coverage:.0%})")
            else:
                strengths.append("ترجمة مفعّلة")

        # 6) B-Roll: اقتراحات بلا أصول مجلوبة
        unresolved = [b for b in plan.b_roll if not b.asset_url and not b.asset_id]
        metrics["broll_suggested"] = len(plan.b_roll)
        metrics["broll_unresolved"] = len(unresolved)
        if unresolved:
            score -= 8
            suggestions.append(
                f"{len(unresolved)} اقتراح B-Roll بلا أصل مُجلب — وفّر أصولاً (Pexels/محلية) أو أزل الاقتراح"
            )
        elif plan.b_roll:
            strengths.append("B-Roll جاهز بأصول فعلية")

        # 7) قص 9:16 من مصدر أفقي
        target = getattr(ctx, "target_aspect", None)
        target_value = str(getattr(target, "value", str(target)))
        source_landscape = plan.source.width >= plan.source.height
        if "9:16" in str(target_value) and source_landscape:
            no_crop = [s for s in keeps if s.crop is None or (s.crop.zoom or 1.0) <= 1.0]
            metrics["keeps_without_crop"] = len(no_crop)
            if no_crop:
                score -= 6
                suggestions.append(
                    f"{len(no_crop)} مقطع إبقاء بلا قص/زوم (9:16 من مصدر أفقي) — أضف crop بمركز وجه إن وُجد"
                )
            else:
                strengths.append("قص عمودي مكتمل على كل المقاطع")

        # 8) طلب حماسي بلا Hook نصي
        request = str(getattr(ctx, "request", "") or "")
        wants_hype = any(k in request for k in HYPE_KEYWORDS)
        if wants_hype and not plan.text_overlays and duration >= 15:
            score -= 5
            suggestions.append("طلب حماسي بلا نصوص توضيحية (textOverlays) — أضف عبارة Hook على أول مقطع")

        # 9) توافق المزاج مع الإيقاع
        mood = plan.style.music_mood
        metrics["music_mood"] = mood.value if isinstance(mood, MusicMood) else str(mood)
        if isinstance(mood, MusicMood) and mood == MusicMood.POWERFUL and avg_keep > 30:
            score -= 5
            suggestions.append("مزاج «قوي» مع إيقاع بطيء — تسريع المقاطع يطابق الطاقة الموسيقية")

        # الخلاصة
        score = max(0.0, min(100.0, round(score, 1)))
        verdict: Literal["approve", "revise"] = "approve" if score >= APPROVE_THRESHOLD else "revise"
        if verdict == "revise":
            suggestions = suggestions[:MAX_SUGGESTIONS_PER_ROUND]
        notes.append(f"معيار القبول: {APPROVE_THRESHOLD:.0f}/100")
        return CritiqueReport(
            score=score,
            verdict=verdict,
            strengths=strengths,
            suggestions=suggestions,
            metrics=metrics,
            notes=notes,
        )
