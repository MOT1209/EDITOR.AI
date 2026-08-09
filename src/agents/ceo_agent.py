"""وكيل المديرة التنفيذية (CEO Agent) — إشراف وتنسيق المسار.

الدور:
- تقود مسار المونتاج: محلل → مخرج → رندر، بتفويض عبر CrewAI ``Process.hierarchical``
  (المرحلة الإبداعية تُدار من وكيلة CEO مباشرة كمديرة للمهمة).
- تتحقق من جودة كل مُخرَج عبر ``validation.STAGE_VALIDATORS`` قبل السماح
  للمرحلة التالية (بوابة الجودة) — مع محاولات تصحيح محدودة وتغذية الأخطاء رجوعاً.
- تحفظ كل مخرجات المراحل في ``.montage_ai/pipeline/<job_id>/`` ليمكن تشخيص
  أي فشل دون إعادة تشغيل المسار.

فصل صارم عن الوكلاء:
- الوكلاء تُبنى من ``registry.AGENT_REGISTRY`` بالاسم فقط (لا استيراد مباشر).
- البوابات دوال نقية في ``validation.py`` على مُخرَج الوكيل.
- إكمال ``analyst`` أو ``render`` لاحقاً = تسجيل/تعديل صنفهما فقط، بلا تغيير هنا.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field

from src.agents.edl_schema import (
    AnalystReport,
    AspectRatio,
    EdlPlan,
    EdlSource,
    RenderPlan,
)
from src.agents.registry import get_agent_class
from src.agents.utils import disable_crewai_cache_breakpoints, env_or_default, get_logger, load_env
from src.agents.validation import STAGE_VALIDATORS

STAGE_ORDER: tuple[str, ...] = ("analyst", "director", "critic", "audio", "render")
DEFAULT_MODEL = env_or_default("OPENCODE_MODEL", "llama-3.3-70b-versatile")
DEFAULT_BASE_URL = env_or_default("OPENCODE_BASE_URL", "https://api.groq.com/openai/v1")


@dataclass
class PipelineContext:
    """سياق تشغيل واحد — يُمرَّر لكل الوكلاء ويحمل ملاحظات التصحيح بين المحاولات."""

    job_id: str
    source_path: str
    request: str
    language: str = "ar"
    mood_hint: Optional[str] = None
    demo: bool = False
    enable_b_roll: bool = True
    target_aspect: AspectRatio = AspectRatio.PORTRAIT
    duration: float = 0.0  # تجاوز اختياري للمدة إن تعذر فحص المصدر
    output_dir: str = ".montage_ai/exports"
    feedback: List[str] = field(default_factory=list)  # ملاحظات آخر محاولة فاشلة
    source: Optional[EdlSource] = None  # يُملأ بعد مرحلة المحلل
    ceo_manager_agent: Optional[Any] = None  # وكيلة CrewAI CEO (للمخرج) — يضبطها المنسق


class PipelineResult(BaseModel):
    """النتيجة النهائية للمسار — تُسلسَل وتُعرض وتُحفظ كـ JSON."""

    job_id: str
    status: Literal["completed", "failed", "partial"] = "completed"
    artifacts_dir: str = ""
    duration_seconds: float = 0.0
    edl: Optional[EdlPlan] = None
    analyst: Optional[AnalystReport] = None
    critic: Optional[Any] = None
    audio: Optional[Any] = None
    render: Optional[RenderPlan] = None
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class CeoOrchestrator:
    """المديرة التنفيذية — منسّق مسار المونتاج وبوابة الجودة النهائية."""

    def __init__(
        self,
        *,
        llm: Optional[Any] = None,
        output_dir: Optional[str] = None,
        max_retries: int = 2,
        verbose: bool = False,
    ) -> None:
        load_env()  # .env.local أولاً (عرف المشروع)
        self.logger = get_logger("ceo")
        self.llm = llm if llm is not None else self._default_llm()
        if self.llm is not None:
            # فقط عند وجود LLM فعلي — استيراد crewai ثقيل (~100s عبر torch على Windows)
            disable_crewai_cache_breakpoints()  # توافق مزوّدات OpenAI-compatible (Groq)
        self.pipeline_dir = Path(
            output_dir or env_or_default("MONTAGE_PIPELINE_DIR", ".montage_ai/pipeline")
        )
        self.max_retries = max_retries
        self.verbose = verbose
        self.ceo_manager_agent = self._build_ceo_manager()
        self._agents = {
            name: get_agent_class(name)(llm=self.llm, verbose=verbose) for name in STAGE_ORDER
        }
        self.logger.info(
            "المديرة جاهزة — LLM: %s | وكلاء: %s | بوابات: %s",
            self._llm_label(),
            ", ".join(STAGE_ORDER),
            ", ".join(STAGE_VALIDATORS),
        )

    # ------------------------------------------------------------------
    # الإعداد
    # ------------------------------------------------------------------

    def _default_llm(self) -> Optional[Any]:
        """يبني LLM بنفس أعراف تهيئة المشروع (OPENCODE_API_KEY + OPENCODE_BASE_URL + OPENCODE_MODEL).

        يعيد None بلا مفتاح — المسار يتحول تلقائياً للوكلاء المحليين (قواعد).
        """
        try:
            from crewai import LLM
        except ImportError:
            self.logger.warning("crewai غير مثبت — عمل بدون LLM (وكلاء محليون)")
            return None
        api_key = env_or_default("OPENCODE_API_KEY") or env_or_default("OPENAI_API_KEY")
        if not api_key:
            self.logger.warning("لا OPENCODE_API_KEY — عمل بدون LLM (خطة محلية أنيقة)")
            return None
        model = DEFAULT_MODEL
        # LiteLLM يحتاج بادئة مزوّد لبعض الأنواع (مثل groq/ قبل اسم الموديل)
        if "/" not in model and "groq" in (DEFAULT_BASE_URL or "").lower():
            model = f"groq/{model}"
        try:
            return LLM(
                model=model,
                api_key=api_key,
                base_url=DEFAULT_BASE_URL,
                temperature=0.3,
            )
        except Exception as exc:  # noqa: BLE001 — نموذج/مزود غير مدعوم لا يكسر المسار
            self.logger.warning("تعذّر بناء LLM (%s) — عمل بدون LLM", exc)
            return None

    def _build_ceo_manager(self) -> Optional[Any]:
        """وكيلة CrewAI CEO — مديرة المهمة الهرمية للمخرج (تفويض + مراجعة)."""
        if self.llm is None:
            return None
        try:
            from crewai import Agent
        except ImportError:
            return None
        return Agent(
            role="المديرة التنفيذية (Executive Producer)",
            goal=(
                "الإشراف على طاقم مونتاج الفيديو: تفويض المهام، مراجعة جودة كل "
                "مُخرَج، وإيقاف أي مخرج لا يلتزم بطلب المستخدم أو ببنية EDL."
            ),
            backstory=(
                "مديرة إنتاج تنفيذية بخبرة 15 عاماً في الفيديو الرقمي: تتحقق من "
                "الخطة قبل الرندر، وترفض أي خطة بها صمت طويل أو إيقاع باهت."
            ),
            llm=self.llm,
            verbose=self.verbose,
            allow_delegation=True,
        )

    def _llm_label(self) -> str:
        return self.llm.model if self.llm is not None else "none (محلي)"

    # ------------------------------------------------------------------
    # نقطة الدخول
    # ------------------------------------------------------------------

    async def run(
        self,
        source_path: str,
        request: str,
        *,
        language: str = "ar",
        mood_hint: Optional[str] = None,
        demo: bool = False,
        enable_b_roll: bool = True,
        target_aspect: Union[AspectRatio, str] = AspectRatio.PORTRAIT,
        duration: float = 0.0,
        plan_only: bool = False,
    ) -> PipelineResult:
        started = time.monotonic()
        job_id = f"job_{int(time.time() * 1000)}"
        if isinstance(target_aspect, str):
            target_aspect = _coerce_aspect(target_aspect)
        ctx = PipelineContext(
            job_id=job_id,
            source_path=source_path,
            request=request,
            language=language,
            mood_hint=mood_hint,
            demo=demo,
            enable_b_roll=enable_b_roll,
            target_aspect=target_aspect,
            duration=duration,
            output_dir=str(self.pipeline_dir / job_id / "exports"),
            ceo_manager_agent=self.ceo_manager_agent,
        )
        artifacts_dir = self.pipeline_dir / job_id
        artifacts_dir.mkdir(parents=True, exist_ok=True)

        self.logger.info("بدء مسار %s — الطلب: %s", job_id, request[:80])
        artifacts: Dict[str, Any] = {}
        warnings: List[str] = []

        try:
            stages = STAGE_ORDER[:-1] if plan_only else STAGE_ORDER  # بدون الرندر (تخطيط فقط)
            for stage in stages:
                if stage == "critic":
                    # حلقة المراجعة الإبداعية: ناقد ↔ مخرج حتى القبول أو نفاد المحاولات
                    outcome = await self._creative_loop(ctx, artifacts)
                else:
                    outcome = await self._run_stage(stage, ctx, artifacts)
                warnings.extend(outcome.warnings)
                if not outcome.ok:
                    self.logger.error("مرحلة %s فشلت نهائياً: %s", stage, outcome.errors)
                    return self._finish(
                        ctx, artifacts, artifacts_dir, started,
                        status="failed", errors=outcome.errors, warnings=warnings,
                    )
                artifacts[stage] = outcome.artifact
                self._save_artifact(ctx, stage, outcome.artifact)

            edl = artifacts["director"]
            self.logger.info("اكتمل المسار: «%s» — %d مقطعاً، %d ترجمة",
                             edl.title, len(edl.segments), len(edl.captions))
            return self._finish(
                ctx, artifacts, artifacts_dir, started,
                status="completed", warnings=warnings,
            )
        except Exception as exc:  # noqa: BLE001 — أي خطأ غير متوقع يُحفظ ويُشخَّص
            self.logger.exception("فشل غير متوقع في المسار %s", job_id)
            return self._finish(
                ctx, artifacts, artifacts_dir, started,
                status="failed", errors=[str(exc)], warnings=warnings,
            )

    # ------------------------------------------------------------------
    # تشغيل مرحلة واحدة مع بوابة الجودة ومحاولات التصحيح
    # ------------------------------------------------------------------

    async def _run_stage(self, stage: str, ctx: PipelineContext, prior: Dict[str, Any]) -> "_StageOutcome":
        agent = self._agents[stage]
        validator = STAGE_VALIDATORS[stage]
        attempt = 0
        while True:
            # ملاحظة: لا نُصفّر ctx.feedback هنا — ما تضعه البوابة في المحاولة
            # الفاشلة يجب أن يصله الوكيل في المحاولة التالية (المخرج عبر البرومبت).
            try:
                artifact = await agent.execute(ctx, prior)
            except NotImplementedError as exc:
                self.logger.error("مرحلة %s: واجهة غير منفّذة: %s", stage, exc)
                return _StageOutcome(ok=False, errors=[str(exc)])
            except Exception as exc:  # noqa: BLE001
                self.logger.exception("مرحلة %s: خطأ تنفيذ", stage)
                return _StageOutcome(ok=False, errors=[f"{type(exc).__name__}: {exc}"])

            validation = validator(artifact)
            if validation.ok:
                ctx.feedback = []  # نجحت المرحلة — امسح ملاحظات التصحيح القديمة
                return _StageOutcome(ok=True, artifact=artifact, warnings=validation.warnings)

            ctx.feedback = validation.errors
            attempt += 1
            self.logger.warning(
                "مرحلة %s: بوابة الجودة رفضت (%s) — محاولة %d/%d",
                stage, validation.errors[0] if validation.errors else "أخطاء",
                attempt, self.max_retries,
            )
            if attempt > self.max_retries:
                return _StageOutcome(ok=False, errors=validation.errors, warnings=validation.warnings)

    async def _creative_loop(self, ctx: PipelineContext, artifacts: Dict[str, Any]) -> "_StageOutcome":
        """حلقة الناقد الإبداعي: يراجع الخطة المعتمدة بنيوياً؛ عند revise يعيد المخرج
        بالملاحظات حتى القبول أو نفاد المحاولات (يمرر حينها بأفضل خطة سليمة + تحذير)."""
        critic = self._agents["critic"]
        director = self._agents["director"]
        round_no = 0
        while True:
            critique = await critic.execute(ctx, artifacts)
            artifacts["critic"] = critique  # آخر تقرير ناقد — يُحفظ في run() أيضاً
            self._save_artifact(ctx, "critic", critique)
            if critique.verdict == "approve":
                self.logger.info("الناقد اعتمد الخطة (%.0f/100)", critique.score)
                return _StageOutcome(ok=True, artifact=critique)
            round_no += 1
            if round_no > self.max_retries:
                self.logger.warning(
                    "الناقد ما زال يطلب مراجعة بعد %d جولة — تمرير بأفضل خطة سليمة",
                    round_no - 1,
                )
                return _StageOutcome(
                    ok=True,
                    artifact=critique,
                    warnings=[
                        f"الناقد طلب مراجعة لم تُنفَّذ بالكامل (الدرجة {critique.score:.0f}/100) — تمرير مع تحذير"
                    ],
                )
            # أعد المخرج بملاحظات الناقد (LLM يعيد التخطيط؛ القواعد تصمد بلا تغيير)
            ctx.feedback = list(critique.suggestions)
            self.logger.info(
                "الناقد يطلب مراجعة (%.0f/100): %d ملاحظة → إعادة المخرج",
                critique.score, len(critique.suggestions),
            )
            plan = await director.execute(ctx, artifacts)
            validation = STAGE_VALIDATORS["director"](plan)
            if not validation.ok:
                return _StageOutcome(ok=False, errors=validation.errors)
            artifacts["director"] = plan
            self._save_artifact(ctx, "director", plan)
            artifacts["critic_rounds"] = round_no

    # ------------------------------------------------------------------
    # الحفظ والتشخيص
    # ------------------------------------------------------------------

    def _save_artifact(self, ctx: PipelineContext, stage: str, artifact: Any) -> None:
        try:
            payload = (
                artifact.model_dump(mode="json", by_alias=True, exclude_none=True)
                if hasattr(artifact, "model_dump")
                else {"artifact": str(artifact)}
            )
            path = self.pipeline_dir / ctx.job_id / f"{stage}.json"
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            self.logger.info("حُفظ مُخرَج %s: %s", stage, path)
        except Exception as exc:  # noqa: BLE001 — الحفظ لا يوقف المسار
            self.logger.warning("تعذّر حفظ مُخرَج %s: %s", stage, exc)

    def _finish(
        self,
        ctx: PipelineContext,
        artifacts: Dict[str, Any],
        artifacts_dir: Path,
        started: float,
        *,
        status: str,
        errors: Optional[List[str]] = None,
        warnings: Optional[List[str]] = None,
    ) -> PipelineResult:
        manifest = {
            "job_id": ctx.job_id,
            "status": status,
            "source_path": ctx.source_path,
            "request": ctx.request,
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "duration_seconds": round(time.monotonic() - started, 2),
            "stages": {name: name in artifacts for name in STAGE_ORDER},
            "errors": errors or [],
            "warnings": warnings or [],
        }
        (artifacts_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return PipelineResult(
            job_id=ctx.job_id,
            status=status,  # type: ignore[arg-type]
            artifacts_dir=str(artifacts_dir),
            duration_seconds=round(time.monotonic() - started, 2),
            edl=artifacts.get("director"),
            analyst=artifacts.get("analyst"),
            critic=artifacts.get("critic"),
            audio=artifacts.get("audio"),
            render=artifacts.get("render"),
            errors=errors or [],
            warnings=warnings or [],
        )


def _coerce_aspect(value: Union[AspectRatio, str]) -> AspectRatio:
    """يحوّل نص نسبة العرض إلى enum (تسامح مع المدخلات النصية)."""
    if isinstance(value, AspectRatio):
        return value
    normalized = str(value).strip().replace(" ", "")
    for candidate in AspectRatio:
        if candidate.value == normalized or candidate.name.lower() == normalized.lower():
            return candidate
    return AspectRatio.PORTRAIT


@dataclass
class _StageOutcome:
    ok: bool
    artifact: Any = None
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
