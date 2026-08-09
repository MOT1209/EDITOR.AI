"""سجل الوكلاء — آلية الفصل بين الإشراف والتنفيذ.

تسجّل وحدات الوكلاء أصنافها هنا عبر ``@register_agent``؛ وتبني المديرة التنفيذية
وكلاءها من السجل بالاسم فقط، لذا لا تحتاج أي تعديل عند إكمال الوكلاء لاحقاً.
"""
from __future__ import annotations

from typing import Any, Dict, Type


class AgentRegistryError(KeyError):
    """يُرمى عند طلب وكيل غير مسجَّل."""


AGENT_REGISTRY: Dict[str, Type[Any]] = {}


def register_agent(name: str):
    """مزيّن لتسجيل صنف وكيل تحت اسم مرحلته (analyst / director / render)."""

    def decorator(cls: Type[Any]) -> Type[Any]:
        if name in AGENT_REGISTRY:
            raise AgentRegistryError(f"وكيل مكرر: {name}")
        AGENT_REGISTRY[name] = cls
        return cls

    return decorator


def get_agent_class(name: str) -> Type[Any]:
    """يبني المديرة التنفيذية الوكلاء من خلال هذه الدالة فقط — بدون استيراد مباشر."""
    try:
        return AGENT_REGISTRY[name]
    except KeyError as exc:
        raise AgentRegistryError(f"وكيل غير مسجَّل: {name}") from exc
