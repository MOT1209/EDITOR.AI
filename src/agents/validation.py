"""بوابات الجودة بين مراحل المسار (Validators) — تعمل المديرة التنفيذية من خلالها.

كل مرحلة لها محقِّق واحد مسجَّل في ``STAGE_VALIDATORS``. المحقِّقون دوال نقية على
مُخرَج الوكيل (لا تعرف شيئاً عن تنفيذ الوكيل الداخلي) — إكمال ``analyst`` أو
``render`` لاحقاً لا يمس هذه البوابات ولا منطق الإشراف.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from src.agents.audio_agent import AudioPlan
from src.agents.critic_agent import CritiqueReport
from src.agents.edl_schema import (
    AnalystReport,
    EdlPlan,
    PlanValidation,
    RenderPlan,
    validate_plan,
)


def validate_analyst(report: Optional[AnalystReport]) -> PlanValidation:
    """بوابة المحلل: يجب معرفة مدة المصدر وبياناته الأساسية للمضي قدماً."""
    if report is None:
        return PlanValidation(errors=["لا يوجد تقرير محلل"])
    errors: list[str] = []
    warnings: list[str] = list(report.warnings)
    if report.duration <= 0:
        errors.append("فشل فحص المصدر: مدة الفيديو غير معروفة (0)")
    if report.silences and any(s.end <= s.start for s in report.silences):
        errors.append("تقرير الصمت يحتوي فترات معكوسة")
    if not report.silences and report.duration > 60:
        warnings.append("لا فترات صمت مكتشفة لمقطع طويل — تحقق من مستوى الضوضاء")
    if not report.transcript and not report.words:
        warnings.append("لا تفريغ نصي (Whisper غير منفّذ في هذا الممر أو صوت بلا كلام)")
    return PlanValidation(errors=errors, warnings=warnings)


def validate_edl(plan: Optional[EdlPlan]) -> PlanValidation:
    """بوابة المخرج: التحقق البنيوي والقواعدي الكامل على مخطط EDL."""
    if plan is None:
        return PlanValidation(errors=["لا توجد خطة EDL من وكيل المخرج"])
    return validate_plan(plan)


def validate_render(rp: Optional[RenderPlan]) -> PlanValidation:
    """بوابة الرندر: خطة صالحة + نتيجة رندر فعلية سليمة (إن كان الرندر منفَّذاً)."""
    if rp is None:
        return PlanValidation(errors=["لا توجد خطة رندر"])
    errors: list[str] = []
    warnings: list[str] = list(rp.notes)
    if not rp.output_path:
        errors.append("مسار الإخراج فارغ")
    if not rp.command:
        errors.append("أوامر ffmpeg فارغة")
    if rp.render_error:
        errors.append(f"فشل الرندر الفعلي: {rp.render_error}")
    elif not rp.rendered:
        warnings.append("الرندر لم يُنفَّذ بعد (خطة فقط)")
    return PlanValidation(errors=errors, warnings=warnings)


def validate_critique(critique: Optional[CritiqueReport]) -> PlanValidation:
    """بوابة الناقد: تحويل حكم النقد (approve/revise) إلى نتيجة البوابة.

    ``revise`` = أخطاء تدفع المديرة لإعادة المخرج بالملاحظات؛ ``approve`` = مرور.
    أي خلل في بنية التقرير نفسه يُفشل المرحلة (آمن).
    """
    if critique is None:
        return PlanValidation(errors=["لا يوجد تقرير ناقد"])
    if not (0 <= critique.score <= 100):
        return PlanValidation(errors=[f"درجة الناقد خارج النطاق 0..100: {critique.score}"])
    errors: list[str] = []
    warnings: list[str] = list(critique.notes)
    if critique.verdict == "revise":
        errors.append(f"الخطة تحتاج مراجعة إبداعية (الدرجة {critique.score:.0f}/100)")
    return PlanValidation(errors=errors, warnings=warnings)


def validate_audio(audio: Optional[AudioPlan]) -> PlanValidation:
    """بوابة الصوت: إرشادية فقط — لا تمنع المسار (الخطة الصوتية مواصفة اختيارية)."""
    if audio is None:
        return PlanValidation(errors=["لا توجد خطة صوتية"])
    warnings: list[str] = list(audio.notes)
    if not audio.ducking:
        warnings.append("لا نطاقات Ducking — بلا كلمات Whisper ولا ترجمة، قد يطغى الصوت على الموسيقى")
    return PlanValidation(errors=[], warnings=warnings)


# سجل البوابات: الاسم ↔ دالة التحقق (تستخدمه المديرة التنفيذية فقط).
STAGE_VALIDATORS: Dict[str, Callable[[Any], PlanValidation]] = {
    "analyst": validate_analyst,
    "director": validate_edl,
    "critic": validate_critique,
    "audio": validate_audio,
    "render": validate_render,
}
