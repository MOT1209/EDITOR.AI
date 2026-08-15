#!/usr/bin/env python3
"""تنزيل ثنائية auto-editor (WyattBlue) إلى .montage_ai/bin/ حسب المنصة.

الاستخدام:
    python scripts/install-auto-editor.py [--force] [--version 31.5.0]

المصدر: https://github.com/WyattBlue/auto-editor/releases
الترخيص: ملكية عامة (Unlicense) — الملفات الثنائية قد تحمل تراخيص مفتوحة أخرى.
بلا اعتماد Python خارجي (stdlib فقط) حتى يعمل خارج الـ venv.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import stat
import sys
import tempfile
import urllib.request
from pathlib import Path

REPO = "WyattBlue/auto-editor"
API_LATEST = f"https://api.github.com/repos/{REPO}/releases/latest"
DEFAULT_VERSION = "31.5.0"


def asset_name() -> str:
    """اسم أصل الإصدار حسب (نظام التشغيل، المعمارية)."""
    os_name = (platform.system() or "").lower()
    machine = (platform.machine() or "").lower()
    arch = "aarch64" if "aarch64" in machine or "arm64" in machine else (
        "armv7" if "arm" in machine else "x86_64"
    )
    if os_name == "windows":
        return f"auto-editor-windows-{arch}.exe"
    if os_name == "darwin":
        return f"auto-editor-macos-{arch}"
    return f"auto-editor-linux-{arch}"


def resolve_version(version: str) -> str:
    """يرجع إصداراً ثابتاً أو يسأل GitHub API عن أحدث إصدار (عند version='latest')."""
    if version != "latest":
        return version
    try:
        with urllib.request.urlopen(API_LATEST, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return str(data.get("tag_name") or DEFAULT_VERSION)
    except Exception as exc:  # noqa: BLE001 — لا إنترنت: نستخدم النسخة الافتراضية
        print(f"تحذير: تعذّر جلب أحدث إصدار ({exc}) — استخدم {DEFAULT_VERSION}")
        return DEFAULT_VERSION


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkstemp(suffix=".part", dir=str(dest.parent))[1])
    try:
        print(f"تنزيل {url}")
        with urllib.request.urlopen(url, timeout=120) as resp, open(tmp, "wb") as out:
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            while True:
                chunk = resp.read(1 << 16)
                if not chunk:
                    break
                out.write(chunk)
                done += len(chunk)
                if total:
                    print(f"\r  {done / 1e6:.1f}/{total / 1e6:.1f}MB", end="", flush=True)
        print()
        tmp.replace(dest)
    finally:
        if tmp.exists():
            tmp.unlink()


def main() -> int:
    ap = argparse.ArgumentParser(description="تنزيل ثنائية auto-editor")
    ap.add_argument("--force", action="store_true", help="إعادة التنزيل حتى لو وُجد الملف")
    ap.add_argument("--version", default="latest", help="نسخة الإصدار (افتراضي: أحدث إصدار)")
    args = ap.parse_args()

    bin_dir = Path(".montage_ai") / "bin"
    name = asset_name()
    dest = bin_dir / name
    if dest.exists() and not args.force:
        print(f"موجود مسبقاً: {dest} — استخدم --force لإعادة التنزيل")
        return 0

    version = resolve_version(args.version)
    url = (
        f"https://github.com/{REPO}/releases/download/{version}/{name}"
    )
    try:
        download(url, dest)
    except Exception as exc:  # noqa: BLE001
        print(f"فشل التنزيل: {exc}", file=sys.stderr)
        return 1

    if os.name != "nt":
        dest.chmod(dest.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    print(f"تم: {dest} ({dest.stat().st_size / 1e6:.1f}MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())