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


def env_or_default(key: str, default: str = "") -> str:
    """قراءة متغير بيئة مع افتراضي آمن (لا ترفع KeyError عند غيابه)."""
    return os.environ.get(key, default)


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
