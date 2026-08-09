"""وكيل المخرج الإبداعي — Scene & B-Roll Director.

المسؤوليات:
1. توليد خطة القص (EDL JSON) من تقرير المحلل + طلب المستخدم — عبر LLM داخل
   Crew مع ``Process.hierarchical`` تحت إشراف وكيلة المديرة التنفيذية.
2. اقتراحات B-Roll بكلمات مفتاحية وجلب الأصول من Pexels (async) إن توفر مفتاح.
3. توقيتات ترجمات كلمة-بكلمة (word-level) لأنماط الفيديو العمودي القصير
   (Hormozi/Highlight/Beasty) — تُحمَل في ``EdlPlan.captions``.
4. أحداث قص/زوم (CropZoomEvent) للتحويل 16:9 ← 9:16 — من ``face_tracks`` إن
   وجدت، أو افتراضي ذكي عند غيابها.

التدهور الأنيق: عند غياب crewai/LLM أو فشل الاستجابة، ينتج خطة قواعد محلية
(قص الصمت + ترجمة + موسيقى) — مطابق لسلوك mock في طبقة Next.js، فالمسار لا
يتعطل بلا مفتاح API.
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import List, Optional

import httpx

from src.agents.edl_schema import (
    AspectRatio,
    BrollProvider,
    BrollSuggestion,
    CaptionLine,
    CaptionStyle,
    ColorFilterId,
    CropZoomEvent,
    EdlPlan,
    EdlSource,
    MusicMood,
    OverlayPosition,
    PlanOverlay,
    PlanSegment,
    VideoStyle,
    WordTiming,
    normalize_plan,
)
from src.agents.registry import register_agent
from src.agents.utils import env_or_default, extract_json, get_logger

# سقف كلمات السطر حسب النمط (أنماط العقد: default/bold/highlight/karaoke)
MAX_WORDS_PER_LINE: dict[str, int] = {
    CaptionStyle.DEFAULT.value: 5,
    CaptionStyle.BOLD.value: 4,
    CaptionStyle.HIGHLIGHT.value: 3,
    CaptionStyle.KARAOKE.value: 4,
}

DIRECTOR_SYSTEM_PROMPT = """أنت "المخرج الإبداعي" في طاقم مونتاج الفيديو — مسؤول عن خطة القص (EDL).
تستقبل تقرير محلل (صمت/كلمات/لقطات) وطلب المستخدم، وتنتج خطة EDL بجودة محرر
سوشال ميديا محترف: قصّ الصمت، تسريع اللحظات البطيئة، إبراز الـ Hooks، اقتراح
B-Roll بكلمات مفتاحية، وترجمات كلمة-بكلمة. أخرج JSON صالحاً فقط يطابق المخطط
الموضح (الحقول camelCase). لا تخرج أي نص خارج JSON."""


def _coerce_aspect(value: str) -> AspectRatio:
    """يحوّل نص نسبة العرض إلى enum (تسامح مع المدخلات النصية)."""
    normalized = str(value).strip().replace(" ", "")
    for candidate in AspectRatio:
        if candidate.value == normalized or candidate.name.lower() == normalized.lower():
            return candidate
    return AspectRatio.PORTRAIT


@register_agent("director")
class DirectorAgent:
    """المخرج الإبداعي — يولّد مخطط EDL من تقرير المحلل وطلب المستخدم."""

    STAGE = "director"

    def __init__(self, llm: Optional[object] = None, verbose: bool = False) -> None:
        self.logger = get_logger("director")
        self.llm = llm
        self.verbose = verbose
        self.crew_agent = None
        if llm is not None:
            self.crew_agent = self._build_crew_agent()

    # ------------------------------------------------------------------
    # CrewAI Agent (يُنشأ فقط عند توفر llm + crewai)
    # ------------------------------------------------------------------

    def _build_crew_agent(self) -> Optional[object]:
        try:
            from crewai import Agent
        except ImportError:
            self.logger.warning("crewai غير مثبت — سيُستخدم المخرج المحلي (قواعد)")
            return None
        return Agent(
            role="المخرج الإبداعي (Scene & B-Roll Director)",
            goal="إنتاج خطة قص EDL ذكية تلبي طلب المستخدم وتقطع الملل وتبرز اللحظات",
            backstory=(
                "مخرج محترف متخصص في محتوى السوشال ميديا العمودي: يعرف متى يقص "
                "الصمت، ومتى يسرّع، وأين يضع الـ B-Roll والترجمات الكلمة-بكلمة."
            ),
            llm=self.llm,
            verbose=self.verbose,
            allow_delegation=False,
        )

    # ------------------------------------------------------------------
    # عقد التنفيذ (تستدعيه المديرة التنفيذية)
    # ------------------------------------------------------------------

    async def execute(self, ctx: object, prior: dict) -> EdlPlan:
        report = prior.get("analyst")
        feedback: List[str] = list(getattr(ctx, "feedback", []) or [])

        plan: Optional[EdlPlan] = None
        if self.crew_agent is not None and getattr(ctx, "ceo_manager_agent", None) is not None:
            try:
                plan = await self._llm_plan(ctx, report, feedback)
                self.logger.info("خطة LLM جاهزة: «%s»", plan.title)
            except Exception as exc:  # noqa: BLE001 — أي فشل LLM يتحول لخطة محلية
                self.logger.warning("فشل خطة LLM (%s) — الرجوع للخطة المحلية", exc)
        if plan is None:
            plan = self._rule_based_plan(ctx, report)
            self.logger.info("خطة محلية جاهزة: «%s»", plan.title)

        if getattr(ctx, "enable_b_roll", True):
            plan = await self.enrich_b_roll(plan)
        return plan

    # ------------------------------------------------------------------
    # 1) خطة LLM داخل Crew هرمي بقيادة المديرة التنفيذية
    # ------------------------------------------------------------------

    async def _llm_plan(self, ctx: object, report: object, feedback: List[str]) -> EdlPlan:
        from crewai import Crew, Process, Task

        task = Task(
            description=self._build_prompt(ctx, report, feedback),
            expected_output="JSON صالح يطابق مخطط EDL (camelCase) بدون أي نص آخر",
            agent=self.crew_agent,
        )
        # الافتراضي هرمي (المديرة تشرف وتفوض). عند حد معدل المزود (نافذة
        # TPM المجانية في Groq صغيرة) يتدهور تلقائياً إلى sequential — ويبقى
        # LLM في الصورة، والقواعد المحلية آخر خط دفاع. "sequential" صريح عبر
        # CREWAI_PROCESS=sequential يوفر الرموز من البداية.
        process_name = env_or_default("CREWAI_PROCESS", "hierarchical").strip().lower()
        if process_name == "sequential":
            process = Process.sequential
            result = await self._kickoff_with_retry(Crew(agents=[self.crew_agent], tasks=[task], process=process, verbose=self.verbose), 2)
        else:
            try:
                crew = Crew(
                    agents=[self.crew_agent], tasks=[task], verbose=self.verbose,
                    process=Process.hierarchical,
                    manager_agent=getattr(ctx, "ceo_manager_agent", None),
                )
                result = await self._kickoff_with_retry(crew, 1)
            except Exception as exc:  # noqa: BLE001 — حد معدل/قوالب المديرة → sequential
                self.logger.warning("الهرمية غير ممكنة (%s) — تدهور تلقائي إلى sequential", exc)
                result = await self._kickoff_with_retry(Crew(agents=[self.crew_agent], tasks=[task], process=Process.sequential, verbose=self.verbose), 1)
        raw_output = ""
        try:
            raw_output = result.tasks_output[0].raw
        except (AttributeError, IndexError, TypeError):
            raw_output = str(result)
        data = extract_json(raw_output)
        if data is None:
            raise ValueError("استجابة المخرج لا تحتوي JSON صالحاً")
        return normalize_plan(data, source=self._source_of(ctx, report))

    async def _kickoff_with_retry(self, crew: Any, max_retries: int = 2) -> Any:
        """تشغيل Crew مع إعادة محاولة عند حدود معدل المزود (429/TPM).

        Groq المجاني 12000 TPM — ينتظر ``retry_after`` (أو 25s) ثم يعيد.
        """
        import asyncio as _asyncio

        from litellm import RateLimitError as LiteRateLimitError

        attempt = 0
        while True:
            try:
                return await crew.kickoff_async(inputs={})
            except LiteRateLimitError as exc:
                attempt += 1
                if attempt > max_retries:
                    raise
                wait = 25
                try:
                    wait = float(exc.retry_after) + 1
                except Exception:  # noqa: BLE001
                    pass
                self.logger.warning(
                    "حد معدل LLM (TPM) — إعادة المحاولة بعد %.0fs (%d/%d)", wait, attempt, max_retries
                )
                await _asyncio.sleep(wait)

    def _example_plan(self, source: EdlSource) -> Dict[str, Any]:
        """مثال EDL مصغّر وموثوق البنية — مرجع المخرج بدل مخطط JSON الكامل (توفير رموز)."""
        return {
            "title": "فيديو حماسي",
            "source": {
                "path": source.path,
                "duration": source.duration,
                "width": source.width,
                "height": source.height,
                "fps": source.fps,
            },
            "style": {
                "colorFilter": "vivid",
                "musicMood": "قوي",
                "musicVolume": 0.5,
                "captions": True,
                "captionStyle": "bold",
            },
            "segments": [
                {
                    "start": 0.0, "end": 4.8, "keep": True, "speed": 1.2,
                    "reason": "مقدمة مثيرة — Hook",
                    "crop": {"source": "source", "centerX": 0.5, "centerY": 0.4,
                             "zoom": 1.35, "ease": "easeInOutQuad"},
                    "b_roll": {"keywords": ["sunset", "city"]},
                },
                {"start": 4.8, "end": 6.2, "keep": False, "speed": 1.0, "reason": "صمت"},
                {"start": 6.2, "end": 12.0, "keep": True, "speed": 1.0,
                 "reason": "محتوى رئيسي", "crop": {"source": "source", "centerX": 0.5,
                 "centerY": 0.4, "zoom": 1.35, "ease": "easeInOutQuad"}},
            ],
            "captions": [
                {
                    "text": "مرحبا بكم",
                    "start": 0.2, "end": 2.0, "words": [
                        {"word": "مرحبا", "start": 0.2, "end": 1.0, "index": 0},
                        {"word": "بكم", "start": 1.0, "end": 2.0, "index": 1},
                    ],
                }
            ],
            "b_roll": [{"id": "b1", "keywords": ["sunset", "city"], "start": 0.5,
                        "end": 4.0, "reason": "إحياء البداية"}],
            "textOverlays": [],
            "render": {"encoder": "auto", "quality": "standard"},
        }

    def _build_prompt(self, ctx: object, report: object, feedback: List[str]) -> str:
        source = self._source_of(ctx, report)
        aspect = getattr(ctx, "target_aspect", None) or AspectRatio.PORTRAIT
        if isinstance(aspect, str):
            aspect = _coerce_aspect(aspect)
        example = self._example_plan(source)
        example_json = json.dumps(example, ensure_ascii=False, separators=(",", ":"))
        silences = (
            json.dumps([s.model_dump(by_alias=True) for s in report.silences], ensure_ascii=False)
            if report and report.silences
            else "[]"
        )
        words = (
            json.dumps([w.model_dump(by_alias=True) for w in report.words[:200]], ensure_ascii=False)
            if report and report.words
            else "[]"
        )
        hints = (
            json.dumps([h.model_dump(by_alias=True) for h in report.highlights], ensure_ascii=False)
            if report and report.highlights
            else "[]"
        )
        feedback_note = (
            "ملاحظات تصحيح من المديرة التنفيذية على المحاولة السابقة — عالجها:\n"
            + "\n".join(f"- {f}" for f in feedback[:8])
            if feedback
            else ""
        )
        return f"""طلب المستخدم: {ctx.request}
اللغة: {ctx.language} | مزاج الموسيقى المطلوب: {ctx.mood_hint or 'لا تفضيل'}
المصدر: مدة {source.duration:.1f}s | {source.width}x{source.height} | {source.aspect.value}
الهدف: فيديو عمودي قصير ({getattr(aspect, 'value', aspect)})

تقرير المحلل:
- فترات الصمت: {silences}
- كلمات التفريغ (أول 200): {words}
- لحظات مميزة (Hooks): {hints}

{feedback_note}

مثال مصغّر على شكل JSON المطلوب (المفاتيح camelCase — أخرج بنفس البنية):
{example_json}

قواعد إلزامية:
1. المقاطع تغطي 0..{source.duration:.1f}s كاملة (مقاطع keep و cut معاً).
2. قصّ فترات الصمت (keep=false) وقيّم المقاطع المتبقية.
3. سرعة 0.25..4 فقط؛ التوقف عند اللحظات المهمة (speed<1) وتسريع البطيء (speed>1).
4. إن كان المصدر أفقياً والهدف عمودياً، أضف crop لكل مقطع إبقاء (zoom>=1.05).
5. لكل 3-5 ثوانٍ مملة محتملة اقترح b_roll بكلمات مفتاحية إنجليزية (pexels).
6. captionStyle ضمن: default, bold, highlight, karaoke — ومفعّل افتراضياً.
7. حد أقصى 60 مقطعاً.
"""

    # ------------------------------------------------------------------
    # 2) الخطة المحلية (قواعد) — تعمل بلا LLM/crewai
    # ------------------------------------------------------------------

    def _rule_based_plan(self, ctx: object, report: object) -> EdlPlan:
        source = self._source_of(ctx, report)
        duration = source.duration
        mood = self._pick_mood(ctx.mood_hint)
        aspect = getattr(ctx, "target_aspect", None) or AspectRatio.PORTRAIT
        if isinstance(aspect, str):
            aspect = _coerce_aspect(aspect)
        style = VideoStyle(
            color_filter=ColorFilterId.VIVID if mood == MusicMood.POWERFUL else ColorFilterId.NONE,
            music_mood=mood,
            captions=True,
            caption_style=(
                CaptionStyle.BOLD
                if aspect == AspectRatio.PORTRAIT
                else CaptionStyle.HIGHLIGHT
            ),
            music_volume=0.5,
        )

        segments: List[PlanSegment] = []
        silences = [s for s in (report.silences if report else []) if s.end > s.start]
        cursor = 0.0
        for sil in silences:
            if sil.start > cursor + 0.05:
                segments.append(PlanSegment(start=cursor, end=sil.start, keep=True, reason="مقطع كلامي"))
            segments.append(PlanSegment(start=sil.start, end=sil.end, keep=False, reason="صمت مكتشف"))
            cursor = max(cursor, sil.end)
        if duration - cursor > 0.05:
            segments.append(PlanSegment(start=cursor, end=duration, keep=True, reason="الخاتمة"))
        if not segments and duration > 0:
            segments.append(PlanSegment(start=0.0, end=duration, keep=True, reason="فيديو كامل"))

        # القص الذكي العمودي: حدث قص/زوم لكل مقطع إبقاء عند التحويل من أفقي.
        portrait = aspect == AspectRatio.PORTRAIT
        source_is_landscape = source.width >= source.height
        if portrait and source_is_landscape:
            for seg in segments:
                if seg.keep:
                    seg.crop = CropZoomEvent(
                        start=seg.start,
                        end=seg.end,
                        center_x=0.5,
                        center_y=0.42,
                        zoom=1.35,
                        ease="ease_in_out",
                        source="default",
                    )

        captions = self.build_caption_lines(
            words=list((report.words if report else []) or []),
            style=style.caption_style,
            position=OverlayPosition.BOTTOM,
            duration=duration,
        )

        return EdlPlan(
            title="خطة محلية (بدون LLM)",
            summary="قص الصمت + ترجمة + موسيقى (تدهور أنيق بلا مفتاح API)",
            source=source,
            style=style,
            segments=segments,
            text_overlays=[],
            captions=captions,
            metadata={"fallback": True, "provider": "rule-based"},
        )

    # ------------------------------------------------------------------
    # 3) ترجمات كلمة-بكلمة (word-by-word animated captions)
    # ------------------------------------------------------------------

    def build_caption_lines(
        self,
        words: List[WordTiming],
        style: CaptionStyle,
        position: OverlayPosition,
        duration: float,
        max_words_per_line: Optional[int] = None,
    ) -> List[CaptionLine]:
        """يبني أسطر ترجمة كاملة مع توقيتات كلماتها.

        إذا كانت الكلمات بلا توقيتات (start=end=0) يوزّعها افتراضياً على مدة
        الفيديو بالتساوي — فتبقى الترجمات متحركة حتى قبل تفعيل Whisper.
        """
        if not words:
            return []
        max_words = max_words_per_line or MAX_WORDS_PER_LINE.get(style.value, 5)
        has_timing = any(w.end > w.start for w in words)
        if not has_timing and duration > 0:
            step = duration / max(len(words), 1)
            words = [
                WordTiming(word=w.word, start=i * step, end=(i + 1) * step, index=w.index or i)
                for i, w in enumerate(words)
            ]
        lines: List[CaptionLine] = []
        for i in range(0, len(words), max_words):
            group = words[i : i + max_words]
            lines.append(
                CaptionLine(
                    text=" ".join(w.word for w in group),
                    start=group[0].start,
                    end=group[-1].end,
                    words=[WordTiming(**w.model_dump()) for w in group],
                    style=style,
                    position=position,
                )
            )
        return lines

    # ------------------------------------------------------------------
    # 4) B-Roll: اقتراح + جلب من Pexels (async)
    # ------------------------------------------------------------------

    async def enrich_b_roll(self, plan: EdlPlan) -> EdlPlan:
        """يجلب أصول Pexels للاقتراحات بلا أصل بعد (غير قاتل عند الفشل أو غياب المفتاح)."""
        api_key = os.environ.get("PEXELS_API_KEY", "")
        pending = [b for b in plan.b_roll if not b.asset_url and not b.asset_id]
        if not pending:
            return plan
        if not api_key:
            self.logger.info("لا PEXELS_API_KEY — تُبقى الاقتراحات ككلمات مفتاحية فقط")
            return plan

        async def _fetch(broll: BrollSuggestion) -> BrollSuggestion:
            query = "+".join(broll.keywords[:3]) or "video"
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.get(
                        "https://api.pexels.com/videos/search",
                        params={"query": query, "per_page": 1, "orientation": "portrait"},
                        headers={"Authorization": api_key},
                    )
                    resp.raise_for_status()
                    videos = resp.json().get("videos", [])
                    if videos:
                        v = videos[0]
                        files = [f for f in v.get("video_files", []) if f.get("width") and f.get("height")]
                        files.sort(key=lambda f: (f.get("height") or 0) * (f.get("width") or 0))
                        best = files[-1] if files else None
                        broll.asset_id = str(v.get("id"))
                        broll.asset_url = (best or {}).get("link") or v.get("url")
                        broll.thumbnail_url = v.get("image")
            except Exception as exc:  # noqa: BLE001 — فشل الجلب لا يوقف الخطة
                self.logger.warning("فشل جلب B-Roll لـ %s: %s", query, exc)
            return broll

        results = await asyncio.gather(*(_fetch(b) for b in pending))
        fetched = sum(1 for b in results if b.asset_url)
        self.logger.info("B-Roll: جُلب %d/%d من Pexels", fetched, len(pending))
        return plan

    # ------------------------------------------------------------------
    # أدوات مساعدة
    # ------------------------------------------------------------------

    def _source_of(self, ctx: object, report: object) -> EdlSource:
        if report is not None and getattr(report, "duration", 0) > 0:
            return EdlSource(
                path=ctx.source_path,
                duration=report.duration,
                width=report.width,
                height=report.height,
                fps=report.fps,
                has_audio=report.has_audio,
            )
        duration = float(getattr(ctx, "duration", 0) or 0)
        return EdlSource(path=ctx.source_path, duration=duration)

    def _pick_mood(self, hint: Optional[str]) -> MusicMood:
        if hint:
            for mood in MusicMood:
                if mood.value == hint or mood.name.lower() == str(hint).lower():
                    return mood
        return MusicMood.POWERFUL
