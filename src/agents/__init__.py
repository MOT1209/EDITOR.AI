"""حزمة الوكلاء — استيراد هذا الملف يُسجّل جميع الوكلاء في السجل تلقائياً.

عقد التصميم (Decoupling):
- كل وكيل يسجّل نفسه في ``registry.AGENT_REGISTRY`` عبر ``@register_agent``.
- المديرة التنفيذية (ceo_agent) لا تستورد أي وكيل داخلياً؛ بل تبنيها من السجل
  بالاسم فقط. هذا يعني أن ``analyst_agent`` و ``render_agent`` يمكن إكمال تنفيذهما
  بالكامل لاحقاً دون أي تعديل على منطق الإشراف.
- كل مرحلة لها محقِّق (validator) مسجَّل في ``validation.STAGE_VALIDATORS``
  يمثل "بوابة الجودة" بين مراحل المسار.
"""

from src.agents.registry import AGENT_REGISTRY, register_agent, get_agent_class
from src.agents import edl_schema, validation
from src.agents import analyst_agent  # noqa: F401  (تسجيل)
from src.agents import director_agent  # noqa: F401  (تسجيل)
from src.agents import critic_agent  # noqa: F401  (تسجيل — الناقد الإبداعي)
from src.agents import audio_agent  # noqa: F401  (تسجيل — مهندس الصوت)
from src.agents import render_agent  # noqa: F401  (تسجيل)
from src.agents.ceo_agent import CeoOrchestrator, PipelineContext, PipelineResult

__all__ = [
    "AGENT_REGISTRY",
    "register_agent",
    "get_agent_class",
    "edl_schema",
    "validation",
    "CeoOrchestrator",
    "PipelineContext",
    "PipelineResult",
]
