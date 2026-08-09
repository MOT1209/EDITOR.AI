"""بوابات الجودة بين مراحل المسار (Validators) — تعمل المديرة التنفيذية من خلالها.

كل مرحلة لها محقِّق واحد مسجَّل في ``STAGE_VALIDATORS``. المحقِّقون دوال نقية على
مُخرَج الوكيل (لا تعرف شيئاً عن تنفيذ الوكيل الداخلي) — إكمال ``analyst`` أو
``render`` لاحقاً لا يمس هذه البوابات ولا منطق الإشراف.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional

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
    """بوابة الرندر: يجب وجود مسار مخرج وأمر ffmpeg غير فارغ."""
    if rp is None:
        return PlanValidation(errors=["لا توجد خطة رندر"])
    errors: list[str] = []
    warnings: list[str] = list(rp.notes)
    if not rp.output_path:
        errors.append("مسار الإخراج فارغ")
    if not rp.command:
        errors.append("أوامر ffmpeg فارغة")
    return PlanValidation(errors=errors, warnings=warnings)


# سجل البوابات: الاسم ↔ دالة التحقق (تستخدمه المديرة التنفيذية فقط).
STAGE_VALIDATORS: Dict[str, Callable[[Any], PlanValidation]] = {
    "analyst": validate_analyst,
    "director": validate_edl,
    "render": validate_render,
}
