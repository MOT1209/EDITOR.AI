"""تصدير خطة EDL إلى برنامج مونتاج عبر auto-editor (NLE).

الاستخدام:
    python -m src.export_nle <المصدر> <التنسيق> <خطة_EDL.json> -o <المخرجات>

- <التنسيق>: premiere | resolve | shotcut | kdenlive | final_cut_pro
- <خطة_EDL.json>: خطة ``EdlPlan`` بتسلسل camelCase (من الواجهة).
- يُنشئ جدولاً زمنياً تُقصّ فيه مقاطع EDL (keep=false) عبر ``--edit 1 --cut``.

يتطلب ثنائية auto-editor (إلا لغرض الصدق لا يُقصّ شيء): إن غابت، يخرج برمز 3
ورسالة واضحة توجه المستخدم إلى scripts/install-auto-editor.py. بلا نطاقات قص،
يصدّر نسخة حرفية (identity) من المصدر.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from src.agents.auto_editor_utils import run_auto_editor
from src.agents.edl_schema import EdlPlan
from src.agents.utils import get_logger, resolve_auto_editor

logger = get_logger("export_nle")

# أسماء تنسيقات auto-editor للتصدير (أسماء ودودة → رسمية)
FORMATS = {
    "premiere": "premiere",
    "resolve": "resolve",
    "shotcut": "shotcut",
    "kdenlive": "kdenlive",
    "final_cut_pro": "final_cut_pro",
    "fcp": "final_cut_pro",
    "sony_vegas": "sony_vegas",
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="تصدير EDL إلى NLE عبر auto-editor")
    parser.add_argument("source", help="ملف الفيديو المصدر")
    parser.add_argument("format", choices=sorted(FORMATS), help="تنسيق التصدير")
    parser.add_argument("plan_json", help="مسار JSON لخطة EdlPlan (camelCase)")
    parser.add_argument("-o", "--out", required=True, help="ملف المخرجات")
    args = parser.parse_args(argv)

    if not resolve_auto_editor():
        print(
            "auto-editor غير مثبت — شغّل: python scripts/install-auto-editor.py",
            file=sys.stderr,
        )
        return 3

    try:
        plan_data = json.loads(Path(args.plan_json).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"تعذّر قراءة خطة EDL: {exc}", file=sys.stderr)
        return 2

    plan = EdlPlan.model_validate(plan_data)
    fmt = FORMATS[args.format]
    out = Path(args.out)

    # وسائط القص: ``--edit 1`` يحتفظ بكل شيء؛ ``--cut`` يحذف نطاقات EDL المقصوصة.
    cli = [args.source, "--edit", "1"]
    cut = edl_to_cut_ranges(plan)
    if cut:
        cli += ["--cut", cut]
    cli += ["--export", fmt, "-o", str(out)]

    try:
        proc = run_auto_editor(cli, timeout=600)
    except Exception as exc:  # noqa: BLE001
        print(f"فشل تشغيل auto-editor: {exc}", file=sys.stderr)
        return 4

    if proc.returncode != 0:
        print(f"auto-editor فشل (رمز {proc.returncode}): {(proc.stderr or '')[:600]}", file=sys.stderr)
        return proc.returncode

    if not out.exists():
        print("لم يُنتج المخرجات المطلوبة.", file=sys.stderr)
        return 5

    print(f"تصدير جاهز: {out}")
    return 0


def edl_to_cut_ranges(plan: EdlPlan) -> str:
    """يبني وسيط ``--cut`` (بإطارات المصدر) من مقاطع EDL المقصوصة."""
    from src.agents.auto_editor_utils import edl_to_cut_ranges as _impl

    return _impl(plan)


if __name__ == "__main__":
    raise SystemExit(main())