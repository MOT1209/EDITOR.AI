"""أدوات مشتركة: إعداد السجلات، تحميل البيئة، واستخراج JSON من ردود LLM.

اتّباع أعراف المستودع: تُقرأ المفاتيح من ``.env.local`` (نفس ملف التهيئة الذي
تستخدمه طبقة Next.js) ثم من متغيرات البيئة.
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, Optional

try:  # python-dotenv اختياري — يعمل بدونها عبر متغيرات البيئة مباشرة
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None  # type: ignore[assignment]


def disable_crewai_cache_breakpoints() -> None:
    """يعطّل علامة ``cache_breakpoint`` التي يحقنها CrewAI في الرسائل.

    محول OpenAI المتوافق (Groq/OpenRouter...) يمرّر العلامة كما هي فيرفضها
    المزود (Groq: ``property 'cache_breakpoint' is unsupported``). المحولات
    الأحدث (Anthropic) تعالجها بنفسها؛ التعطيل آمن للجميع (الكاش اختياري).
    """
    try:
        import crewai.llms.cache as cache_mod

        def _passthrough(message: Dict[str, Any]) -> Dict[str, Any]:
            return message

        if getattr(cache_mod, "mark_cache_breakpoint", None) is not _passthrough:
            cache_mod.mark_cache_breakpoint = _passthrough
            get_logger("crewai").info("تم تعطيل cache_breakpoint (توافق Groq/OpenAI-compatible)")
    except ImportError:
        pass  # crewai غير مثبت — لا داعي


def load_env() -> None:
    """يحمّل ``.env.local`` ثم ``.env`` إن وُجدا (نفس عرف المشروع)."""
    if load_dotenv is None:
        return
    for candidate in (Path(".env.local"), Path(".env")):
        if candidate.exists():
            load_dotenv(candidate, override=False)
            return


def get_logger(name: str) -> logging.Logger:
    """مسجِّل موحّد ببادئة ``montage.`` وتنسيق قراءة واحدة لكل الوكلاء."""
    logger = logging.getLogger(f"montage.{name}")
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
                "%H:%M:%S",
            )
        )
        logger.addHandler(handler)
        logger.propagate = False
    return logger


def resolve_ffmpeg() -> str:
    """يعثر على ثنائية ffmpeg بنفس منطق اكتشاف مشروع Next.js (FFMPEG_PATH ثم PATH ثم مسارات شائعة)."""
    env_path = os.environ.get("FFMPEG_PATH")
    if env_path and Path(env_path).exists():
        return env_path
    which = shutil.which("ffmpeg")
    if which:
        return which
    for candidate in (r"C:\ffmpeg\bin\ffmpeg.exe", "/usr/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"):
        if Path(candidate).exists():
            return candidate
    return "ffmpeg"


def resolve_auto_editor() -> Optional[str]:
    """يعثر على ثنائية auto-editor (اختيارية — تُستدعى للتحليل والتصدير).

    الترتيب: ``AUTO_EDITOR_PATH`` ← ``.montage_ai/bin/<اسم المنصة>`` ← ``auto-editor``
    في PATH. يرجع ``None`` عند الغياب ليتدهور المسار إلى احتياطات ffmpeg/قواعد
    (مبدأ التدهور الأنيق) — بخلاف ``resolve_ffmpeg`` التي تُلزم ثنائية.
    """
    env_path = os.environ.get("AUTO_EDITOR_PATH")
    if env_path and Path(env_path).exists():
        return env_path
    name = "auto-editor.exe" if os.name == "nt" else "auto-editor"
    local = Path(".montage_ai") / "bin" / name
    if local.exists():
        return str(local)
    which = shutil.which("auto-editor")
    if which:
        return which
    return None


def env_or_default(key: str, default: str = "") -> str:
    """قراءة متغير بيئة مع افتراضي آمن (لا ترفع KeyError عند غيابه)."""
    return os.environ.get(key, default)


# مزوّدات معروفة → بادئة LiteLLM (تتجاهل الحالة والحواف). المزوّد المخصص
# (OpenAI-compatible بلا بادئة) يُترك كما هو — مثل OpenCode Dev Tier عبر
# OPENCODE_BASE_URL المخصص.
_PROVIDER_PREFIXES: tuple[tuple[str, str], ...] = (
    ("groq.com", "groq/"),
    ("openrouter.ai", "openrouter/"),
    ("api.openai.com", "openai/"),
    ("api.anthropic.com", "anthropic/"),
    ("generativelanguage.googleapis.com", "gemini/"),
)


def provider_prefix(base_url: str) -> str:
    """يستنتج بادئة مزوّد LiteLLM من عنوان الأساس (مثل ``groq/``).

    يخدم المرحلة 2.3: تبديل المزود من Groq المجاني (نافذة TPM صغيرة) إلى
    Dev Tier أو مزوّد آخر عبر OPENCODE_BASE_URL دون تغيير الكود.
    """
    url = (base_url or "").strip().lower()
    for fragment, prefix in _PROVIDER_PREFIXES:
        if fragment in url:
            return prefix
    return ""


def build_llm_model(base_url: str, model: str) -> str:
    """يبني اسم الموديل لـ LiteLLM: يضيف بادئة المزود إن لزم.

    إذا كان الموديل يحمل بادئة صريحة بالفعل (مثل ``qwen/qwen3.6-27b``) أو
    المزوّد مخصصاً بلا بادئة، يُترك الاسم كما هو.
    """
    model = (model or "").strip()
    if not model:
        return model
    prefix = provider_prefix(base_url)
    if prefix and "/" not in model:
        return f"{prefix}{model}"
    return model


# ====================================================================
# ضابط التكلفة (Cost Guard) — نظير Python لـ lib/server/cost-guard.ts
# يقدّر تكلفة استدعاءات المزوّدين المدفوعة ويتتبّع الإنفاق التراكمي للتشغيل،
# ليُسجَّل في أدلة .montage_ai/pipeline/ مع كل مسار.
# ====================================================================

_CHARS_PER_TOKEN = 4
_TOKENS_PER_IMAGE = 850


def _price(key: str, default: float) -> float:
    raw = os.environ.get(key, "")
    try:
        val = float(raw)
        return val if val >= 0 else default
    except (TypeError, ValueError):
        return default


def estimate_cost(
    kind: str,
    *,
    chars: int = 0,
    images: int = 0,
    duration_sec: float = 0.0,
) -> float:
    """يقدّر تكلفة استدعاء واحد بالدولار (تقدير وقائي يميل للأعلى قليلاً).

    ``kind`` ∈ {chat, vision, whisper, tts}. الأسعار قابلة للتهيئة عبر البيئة
    بنفس مفاتيح طبقة Next.js (COST_CHAT_PER_1K ...).
    """
    if kind == "chat":
        tokens = chars / _CHARS_PER_TOKEN
        return (tokens / 1000) * _price("COST_CHAT_PER_1K", 0.005)
    if kind == "vision":
        tokens = chars / _CHARS_PER_TOKEN + images * _TOKENS_PER_IMAGE
        return (tokens / 1000) * _price("COST_VISION_PER_1K", 0.01)
    if kind == "whisper":
        return (duration_sec / 60) * _price("COST_WHISPER_PER_MIN", 0.006)
    if kind == "tts":
        return (chars / 1000) * _price("COST_TTS_PER_1K_CHARS", 0.015)
    return 0.0


def budget_cap_usd() -> float:
    """السقف الكلي (افتراضي 5$). 0 أو أقل = بلا سقف."""
    return _price("MONTAGE_BUDGET_CAP", 5.0)


class BudgetExceeded(RuntimeError):
    """يُرفع عند تجاوز سقف التكلفة قبل استدعاء مدفوع."""


class BudgetTracker:
    """يتتبّع الإنفاق التراكمي لتشغيل واحد ويفرض السقف قبل كل استدعاء.

    الاستخدام::

        tracker = BudgetTracker()
        tracker.guard("whisper", duration_sec=meta["duration"])  # يرفع BudgetExceeded
        ...  # الاستدعاء الفعلي
        tracker.record("whisper", duration_sec=actual)           # تسجيل بعد النجاح
    """

    def __init__(self, cap_usd: Optional[float] = None) -> None:
        self.cap_usd = budget_cap_usd() if cap_usd is None else cap_usd
        self.spent_usd = 0.0

    def guard(self, kind: str, **opts: Any) -> float:
        """يفحص السقف دون تسجيل. يرجع التقدير، ويرفع BudgetExceeded عند التجاوز."""
        est = estimate_cost(kind, **opts)
        if self.cap_usd > 0 and self.spent_usd + est > self.cap_usd:
            raise BudgetExceeded(
                f"تجاوز سقف التكلفة: {self.spent_usd:.4f}$ + {est:.4f}$ "
                f"> السقف {self.cap_usd:.2f}$ (ارفع MONTAGE_BUDGET_CAP)"
            )
        return est

    def record(self, kind: str, **opts: Any) -> float:
        """يسجّل إنفاقاً فعلياً بعد نجاح الاستدعاء. يرجع المبلغ المُسجَّل."""
        est = estimate_cost(kind, **opts)
        self.spent_usd += est
        return est

    def snapshot(self) -> Dict[str, float]:
        """حالة الإنفاق للحفظ في أدلة المسار."""
        remaining = (self.cap_usd - self.spent_usd) if self.cap_usd > 0 else -1.0
        return {
            "spent_usd": round(self.spent_usd, 4),
            "cap_usd": self.cap_usd,
            "remaining_usd": round(remaining, 4),
        }


_JSON_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


def extract_json(text: Optional[str]) -> Optional[Dict[str, Any]]:
    """يستخرج كائن JSON من رد LLM بأقصى مرونة (أسوار، نص زائد، أول كتلة متوازنة)."""
    if not text:
        return None
    text = text.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    fence = _JSON_FENCE.search(text)
    if fence:
        try:
            return json.loads(fence.group(1))
        except json.JSONDecodeError:
            pass
    start = text.find("{")
    if start >= 0:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        pass
    return None
