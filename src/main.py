"""نقطة الدخول لمسار المونتاج المتعدد الوكلاء.

الاستخدام:
    python -m src.main video.mp4 --request "فيديو حماسي قصير مع ترجمة" [--demo]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from src.agents.ceo_agent import CeoOrchestrator
from src.agents.edl_schema import edl_to_json


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="montage",
        description="مسار المونتاج متعدد الوكلاء (CEO → Analyst → Director → Render)",
    )
    ap.add_argument("input", help="مسار الفيديو المصدر")
    ap.add_argument("--request", default="فيديو قصير حماسي مع ترجمة", help="طلب المستخدم")
    ap.add_argument("--language", default="ar", help="لغة التفريغ (ar/en...)")
    ap.add_argument("--mood", default=None, help="مزاج الموسيقى: قوي/مريح/سعيد/ملهم/احترافي...")
    ap.add_argument("--demo", action="store_true", help="تخطي الوكلاء المعلّقين ببيانات تجريبية")
    ap.add_argument("--no-broll", action="store_true", help="تعطيل جلب B-Roll من Pexels")
    ap.add_argument("--aspect", default="9:16", choices=["9:16", "16:9", "1:1"], help="نسبة المخرَج")
    ap.add_argument("--pipeline-dir", default=None, help="مجلد مخرجات التشخيص (افتراضي .montage_ai/pipeline)")
    ap.add_argument("--json-out", default=None, help="مسار كتابة PipelineResult كـ JSON (لطبقة Next.js)")
    ap.add_argument("--verbose", action="store_true", help="سجلات مفصّلة من CrewAI")
    return ap


async def _run(args: argparse.Namespace) -> int:
    source = Path(args.input)
    if not source.exists():
        print(f"خطأ: الملف غير موجود: {source}")
        return 2

    orchestrator = CeoOrchestrator(
        output_dir=args.pipeline_dir,
        verbose=args.verbose,
    )
    result = await orchestrator.run(
        source_path=str(source),
        request=args.request,
        language=args.language,
        mood_hint=args.mood,
        demo=args.demo,
        enable_b_roll=not args.no_broll,
        target_aspect=args.aspect,  # type: ignore[arg-type]
    )

    print("=" * 56)
    print(f"الحالة: {result.status}  |  الزمن: {result.duration_seconds:.1f}s")
    print(f"الأدلة: {result.artifacts_dir}")
    if result.edl:
        print(f"العنوان: {result.edl.title}")
        print(f"المقاطع: {len(result.edl.segments)}  |  الترجمات: {len(result.edl.captions)}")
        keeps = sum(1 for s in result.edl.segments if s.keep)
        print(f"مقاطع الإبقاء: {keeps}")
        out_edl = Path(result.artifacts_dir) / "edl.json"
        out_edl.write_text(edl_to_json(result.edl), encoding="utf-8")
        print(f"خطة EDL كاملة: {out_edl}")
    if result.render:
        if result.render.rendered:
            print(f"الرندر اكتمل: {result.render.output_path}")
            print(f"  الحجم: {result.render.output_bytes / 1e6:.1f}MB | الزمن: {result.render.render_seconds:.1f}s")
        elif result.render.render_error:
            print(f"فشل الرندر: {result.render.render_error}")
    if result.critique:
        print(f"الناقد: {result.critique.score:.0f}/100 → {result.critique.verdict}")
        for s in result.critique.strengths[:3]:
            print(f"  ✓ {s}")
        for s in result.critique.suggestions[:3]:
            print(f"  ⚠ {s}")
    if result.audio:
        print(f"الصوت: {result.audio.music.bpm} BPM ({result.audio.music.mood.value}) | "
              f"{len(result.audio.ducking)} نافذة Ducking | {len(result.audio.fx)} مؤثر")
    for err in result.errors:
        print(f"خطأ: {err}")
    for warn in result.warnings:
        print(f"تحذير: {warn}")
    print("=" * 56)
    if args.json_out:
        out = Path(args.json_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(
            result.model_dump_json(by_alias=True, exclude_none=True),
            encoding="utf-8",
        )
        print(f"JSON: {out}")
    return 0 if result.status == "completed" else 1


def main() -> int:
    args = build_parser().parse_args()
    try:
        return asyncio.run(_run(args))
    except KeyboardInterrupt:
        print("\nأُلغيت العملية.")
        return 130


if __name__ == "__main__":
    sys.exit(main())
