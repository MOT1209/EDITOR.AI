"""وكيل المحلل — Data & Emotion Analyst.

المسؤوليات (العقد الكامل — يُنفَّذ بالكامل في ممر لاحق):
1. التفريغ الصوتي Whisper مع توقيتات كلمة-بكلمة (word-level timestamps).
2. تمييز المتحدثين (Speaker Diarization — e.g. pyannote).
3. خريطة الصمت (silences > 0.3s) — **منفّذ الآن** عبر ffmpeg silencedetect.
4. تتبع الوجه (MediaPipe) لتغذية أحداث CropZoomEvent للقص الذكي 9:16.
5. فحص بيانات المصدر (المدة/الدقة/fps) — **منفّذ الآن** عبر ffmpeg -i.

التنفيذ في هذا الممر: الخطوات 3 و5 حقيقية وقابلة للتشغيل، بينما 1 و2 و4
معلّقة برفع NotImplementedError تُلتقط داخلياً كتحذيرات في التقرير حتى لا
يتعطل المسار — والمخرجات تمر عبر بوابة ``validate_analyst`` في validation.py.
"""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
import tempfile
import uuid
from typing import List, Optional

from src.agents.edl_schema import (
    AnalystReport,
    FaceTrack,
    QualityInfo,
    SilenceSpan,
    SpeakerSegment,
    WordTiming,
)
from src.agents.registry import register_agent
from src.agents.utils import env_or_default, get_logger, load_env, resolve_ffmpeg

try:  # اختياري: pyannote.audio لتمييز المتحدثين (يمكن تثبيته لاحقاً)
    _HAS_PYNANOTE = True

    def _pyannote_pipeline():
        """ينشئ خط معالجة Diarization — استيراد كسول (المكتبة ثقيلة ~70s عبر lightning/torch)."""
        try:
            from pyannote.audio import Pipeline
            return Pipeline.from_pretrained("pyannote/speaker-diarization")
        except Exception:
            return None
except ImportError:
    _HAS_PYNANOTE = False

    def _pyannote_pipeline():  # pragma: no cover
        return None

MIN_SILENCE_SECONDS = 0.3  # متطلب: silences > 0.3s
SILENCE_NOISE_DB = -25  # نفس عتبة طبقة Next.js


@register_agent("analyst")
class AnalystAgent:
    """محلل البيانات والانفعالات — واجهة موحّدة تنفّذها المديرة التنفيذية."""

    STAGE = "analyst"

    def __init__(
        self,
        llm: Optional[object] = None,
        verbose: bool = False,
        ffmpeg: Optional[str] = None,
    ) -> None:
        self.logger = get_logger("analyst")
        self.llm = llm  # يُستخدم لاحقاً لتحليل الانفعالات واللقطات (غير مطلوب الآن)
        self.verbose = verbose
        self.ffmpeg = ffmpeg or resolve_ffmpeg()

    # ------------------------------------------------------------------
    # عقد التنفيذ (تستدعيه المديرة التنفيذية)
    # ------------------------------------------------------------------

    async def execute(self, ctx: object, prior: dict) -> AnalystReport:
        """ينفّذ تحليل المصدر بشكل متزامن في مؤشر ترابط (I/O كثيف عبر subprocess)."""
        self.logger.info("تحليل المصدر: %s", ctx.source_path)
        return await asyncio.to_thread(self._analyze_sync, ctx)

    # ------------------------------------------------------------------
    # التنفيذ
    # ------------------------------------------------------------------

    def _analyze_sync(self, ctx: object) -> AnalystReport:
        warnings: List[str] = []
        meta = self._probe_source(ctx.source_path)
        silences = self._detect_silences(ctx.source_path)

        words: List[WordTiming] = []
        transcript = ""
        if getattr(ctx, "demo", False):
            # وضع تجريبي: كلمات مصنّعة للتحقق من الترجمات المتحركة بلا Whisper.
            words = _demo_words(meta["duration"])
            transcript = " ".join(w.word for w in words)
            warnings.append("وضع تجريبي (--demo): كلمات مصنّعة بدل Whisper")
        else:
            try:
                words, transcript = self.transcribe_word_level(ctx.source_path, ctx.language)
            except Exception as exc:  # noqa: BLE001 — فشل التفريغ لا يوقف المسار
                warnings.append(f"التفريغ النصي غير متاح: {exc}")

        speakers: List[SpeakerSegment] = []
        try:
            speakers = self.identify_speakers(ctx.source_path)
        except NotImplementedError as exc:
            warnings.append(f"تمييز المتحدثين معلّق: {exc}")

        face_tracks: List[FaceTrack] = []
        try:
            face_tracks = self.track_faces(ctx.source_path)
        except NotImplementedError as exc:
            warnings.append(f"تتبع الوجه معلّق: {exc}")

        report = AnalystReport(
            source_path=ctx.source_path,
            duration=meta["duration"],
            width=meta["width"],
            height=meta["height"],
            fps=meta["fps"],
            has_audio=meta["has_audio"],
            transcript=transcript,
            words=words,
            silences=silences,
            speakers=speakers,
            face_tracks=face_tracks,
            quality=QualityInfo(),  # تقدير لاحق عبر تحليل اللقطات
            warnings=warnings,
        )
        self.logger.info(
            "التقرير جاهز: مدة %.1fs، صمت %d فترة، كلمات %d، تحذيرات %d",
            report.duration,
            len(report.silences),
            len(report.words),
            len(report.warnings),
        )
        return report

    # ------------------------------------------------------------------
    # نقطة التوسعة 1: التفريغ النصي Whisper (كلمة-بكلمة)
    # ------------------------------------------------------------------

    def transcribe_word_level(self, source_path: str, language: str = "ar") -> tuple[list[WordTiming], str]:
        """يفرّغ الصوت عبر Whisper (Groq API) مع توقيتات كلمة-بكلمة.

        التنفيذ: استخراج mp3 16kHz mono عبر ffmpeg (≈0.24MB/دقيقة — يدعم
        مقاطع أطول من حد 25MB) ثم POST إلى ``/audio/transcriptions`` بنفس
        أعراف طبقة Next.js (``WHISPER_MODEL`` + ``OPENCODE_*`` من ``.env.local``).
        """
        load_env()
        api_key = env_or_default("OPENCODE_API_KEY") or env_or_default("OPENAI_API_KEY")
        base_url = env_or_default("OPENCODE_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
        model = env_or_default("WHISPER_MODEL", "whisper-large-v3-turbo")
        if not api_key:
            raise RuntimeError("لا OPENCODE_API_KEY — لا يمكن استدعاء Whisper")

        audio_path = self._extract_audio_mp3(source_path)
        try:
            return self._whisper_request(api_key, base_url, model, audio_path, language)
        finally:
            try:
                os.unlink(audio_path)
            except OSError:
                pass

    # ------------------------------------------------------------------
    # Whisper عبر Groq — أدوات
    # ------------------------------------------------------------------

    def _extract_audio_mp3(self, source_path: str) -> str:
        """يستخرج مسار الصوت كـ mp3 16kHz mono (نفس قرار طبقة Next.js)."""
        fd, out = tempfile.mkstemp(prefix=f"montage_whisper_{uuid.uuid4().hex[:8]}_", suffix=".mp3")
        os.close(fd)
        try:
            proc = subprocess.run(
                [
                    self.ffmpeg, "-hide_banner", "-y", "-i", source_path,
                    "-vn", "-ac", "1", "-ar", "16000",
                    "-c:a", "libmp3lame", "-b:a", "32k", out,
                ],
                capture_output=True,
                text=True,
                timeout=180,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("انتهت مهلة استخراج الصوت للتفريغ") from exc
        if proc.returncode != 0 or not os.path.exists(out):
            os.unlink(out)
            raise RuntimeError("تعذّر استخراج الصوت عبر ffmpeg للتفريغ النصي")
        return out

    def _whisper_request(
        self,
        api_key: str,
        base_url: str,
        model: str,
        audio_path: str,
        language: str,
    ) -> tuple[list[WordTiming], str]:
        """POST multipart إلى Groq/OpenAI Whisper ويفسّر توقيتات الكلمات."""
        try:
            import httpx
        except ImportError as exc:
            raise RuntimeError("httpx غير مثبت (pip install httpx)") from exc

        with open(audio_path, "rb") as fh:
            data = fh.read()
        try:
            res = httpx.post(
                f"{base_url}/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": ("audio.mp3", data, "audio/mpeg")},
                data={
                    "model": model,
                    "response_format": "verbose_json",
                    "timestamp_granularities[]": "word",
                    **({"language": language} if language else {}),
                },
                timeout=300.0,
            )
        except httpx.HTTPError as exc:
            raise RuntimeError(f"تعذّر الاتصال بـ Whisper: {exc}") from exc
        if res.status_code != 200:
            raise RuntimeError(
                f"Whisper API error ({res.status_code}): {res.text[:200]}"
            )
        payload = res.json()

        words: List[WordTiming] = []
        for i, w in enumerate(payload.get("words") or []):
            text = str(w.get("word") or w.get("text") or "").strip()
            if not text:
                continue
            try:
                start = float(w["start"])
                end = float(w["end"])
            except (KeyError, TypeError, ValueError):
                continue
            words.append(WordTiming(word=text, start=start, end=end, index=i))
        transcript = str(payload.get("text") or "").strip()
        self.logger.info(
            "Whisper اكتمل: %d كلمة، %d حرفاً (الموديل %s)",
            len(words),
            len(transcript),
            model,
        )
        return words, transcript

    # ------------------------------------------------------------------
    # نقطة التوسعة 2: تمييز المتحدثين (Diarization)
    # ------------------------------------------------------------------

    def identify_speakers(self, source_path: str) -> list[SpeakerSegment]:
        """يفرّق المتحدثين إلى فترات (SpeakerSegment).

        الأولوية: pyannote.audio (إن ثُبت) مع نموذج الحوار الافتراضي.
        البديل المنيع: تمييز افتراضي على الحدود الصامتة — يبدّل علامة
        المتحدث بين كل كتلة نطقية مستنيرة بالصمت (دقة محدودة لكنها تبقي
        المسار منضّغاً بلا نماذج/تحميلات)."""
        if _HAS_PYNANOTE:
            try:
                pipeline = _pyannote_pipeline()
                if pipeline is None:
                    raise RuntimeError("pyannote.audio غير متاح — تمييز صامت بديل")
                wav = self._extract_wav(source_path)
                try:
                    segments = sorted(pipeline(wav), key=lambda s: s[2])
                    return [
                        SpeakerSegment(
                            start=float(seg.start), end=float(seg.end),
                            label=str(seg.name or "speaker_0"),
                            confidence=float(seg.confidence or 0.5),
                        )
                        for seg in segments
                    ]
                finally:
                    os.unlink(wav)
            except Exception as exc:  # noqa: BLE001 — فشل النموذج لا يوقف المسار
                self.logger.warning("pyannote فشل (%s) — الرجوع للتمييز الصامت", exc)
        return self._silence_bounded_diarization(source_path)

    def _silence_bounded_diarization(self, source_path: str) -> list[SpeakerSegment]:
        """تمييز مؤقت: يبدّل المتحدث بين كل كتلة نطقية (مفروقة بالصمت > 0.3s).
        مفيد عندما لا يتوفر نموذج pyannote أو اتصال بنيئي."""
        silences = self._detect_silences(source_path)
        report = self._probe_source(source_path)
        dur = max(report["duration"], 0.0)
        # حدود كتل النطق = ما بين نهاية الصمت وبداية الصمت الآتي.
        bounds = sorted({0.0, dur, *(g for s in silences for g in (s.start, s.end) if 0 < g < dur)})
        out: List[SpeakerSegment] = []
        speaker = 0
        for i in range(len(bounds) - 1):
            s_start, s_end = bounds[i], bounds[i + 1]
            if s_end - s_start >= 0.2:
                out.append(SpeakerSegment(
                    start=s_start, end=s_end,
                    label=f"speaker_{speaker % 2}", confidence=0.3,
                ))
                speaker += 1
        return out

    # ------------------------------------------------------------------
    # نقطة التوسعة 3: تتبع الوجه — يغذي CropZoomEvent (OpenCV DNN / Haar)
    # ------------------------------------------------------------------

    def track_faces(self, source_path: str) -> list[FaceTrack]:
        """يتبع وجه المتحدث لإنتاج FaceTrack يستهلكه المخرج
        كأحداث قص/زوم للتحويل 16:9 ← 9:16.

        يحرك cv2 DNN (Caffe) مع تخزين مؤقت؛ إذا توفّر الحزمة الترميزية
        يرجع لكاشف Haar المخزّن. يرجع [] بلا استثناء عند غياب الوجوه —
        المخرج يستخدم المركز الافتراضي (center_x=0.5, center_y=0.42).
        MediaPipe كان مقترحاً لكنه غير مستقر على Windows."""
        try:
            import cv2
        except ImportError:
            self.logger.warning("تتبع الوجه معلّق: cv2 غير مثبت")
            return []
        det = self._init_face_detector()
        if det is None:
            self.logger.warning("تتبع الوجه: لا كاشف وجوه متوفر (DNN غير محمّل + Haar مفقود)")
            return []
        cap = cv2.VideoCapture(source_path)
        if not cap.isOpened():
            return []
        fps = max(float(cap.get(cv2.CAP_PROP_FPS)) or 30.0, 1.0)
        width = max(float(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), 1.0)
        height = max(float(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)), 1.0)
        sample_dt = 0.4  # عينة كل 0.4ث — كفاية للتتبع بدون بطء
        step = max(1, int(fps * sample_dt))
        raw: List[tuple] = []
        idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if idx % step == 0:
                t = idx / fps
                face = self._detect_face(frame, det, width, height)
                if face is not None:
                    raw.append((t, *face))
            idx += 1
        cap.release()
        return self._merge_face_peaks(raw)

    def _init_face_detector(self) -> Optional[tuple]:
        """ينشئ كاشف وجوه: DNN Caffe (مخبأ) أو Haar cascade (مخبأ).
        يرجع (kind, net/cascade, w, h) أو None لو كلاهما غير متاح."""
        import cv2
        dnn_cfg = self._face_model_path("deploy.prototxt")
        dnn_model = self._face_model_path("res10_300x300_ssd.caffemodel")
        if dnn_cfg and dnn_model:
            try:
                net = cv2.dnn.readNetFromCaffe(dnn_cfg, dnn_model)
                if not net.empty():
                    return ("dnn", net, 300, 300)
            except cv2.error:
                pass
        # fallback: Haar cascade المخزّن
        haar_path = self._face_model_path("haarcascade_frontalface.xml")
        if haar_path:
            cascade = cv2.CascadeClassifier(haar_path)
            if not cascade.empty():
                return ("haar", cascade, None, None)
        return None

    def _detect_face(self, frame, det, width: float, height: float) -> Optional[tuple]:
        """يكتشف الوجهة الأولى في الإطار → (center_x, center_y, size) نسبي."""
        import cv2
        kind = det[0]
        if kind == "dnn":
            _, net, sw, sh = det
            blob = cv2.dnn.blobFromImage(frame, 1.0, (sw, sh), (104.0, 177.0, 123.0), swapRB=False, crop=False)
            net.setInput(blob)
            out = net.forward()
            # البنية: [1,1,N,7] → [batch, id, conf, x1, y1, x2, y2]
            for i in range(out.shape[2]):
                conf = float(out[0, 0, i, 2])
                if conf < 0.6:
                    continue
                x1 = float(out[0, 0, i, 3]) * width
                y1 = float(out[0, 0, i, 4]) * height
                x2 = float(out[0, 0, i, 5]) * width
                y2 = float(out[0, 0, i, 6]) * height
                cx = (x1 + x2) / 2 / width
                cy = (y1 + y2) / 2 / height
                sz = (x2 - x1) / width
                return max(0.0, min(1.0, cx)), max(0.0, min(1.0, cy)), sz
            return None
        # Haar
        _, cascade, _, _ = det
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=3, minSize=(30, 30))
        if len(faces):
            x, y, w, h = faces[0]
            return (x + w / 2) / width, (y + h / 2) / height, w / width
        return None

    def _merge_face_peaks(self, raw: List[tuple]) -> List[FaceTrack]:
        """يدمج العينات المتتالية للوجه إلى مسارات (فاصل ≥ 1.0ث → مسار جديد)."""
        if not raw:
            return []
        tracks: List[FaceTrack] = []
        cur_start, cur_end = raw[0][0], raw[0][0]
        cx_sum, cy_sum, sz_sum, n = 0.0, 0.0, 0.0, 0
        for t, cx, cy, sz in sorted(raw):
            if t - cur_end > 1.0 and n > 0:
                tracks.append(FaceTrack(start=cur_start, end=cur_end,
                    center_x=cx_sum / n, center_y=cy_sum / n, size=sz_sum / n))
                cur_start, cur_end, cx_sum, cy_sum, sz_sum, n = t, t, cx, cy, sz, 1
            else:
                cur_end = t; cx_sum += cx; cy_sum += cy; sz_sum += sz; n += 1
        if n > 0:
            tracks.append(FaceTrack(start=cur_start, end=cur_end,
                center_x=cx_sum / n, center_y=cy_sum / n, size=sz_sum / n))
        return tracks

    def _face_model_path(self, name: str) -> Optional[str]:
        """يحل مسار نموذج كاشف الوجوه في .montage_ai/models/ (مخزن مرة واحدة)."""
        pipeline_dir = getattr(self, "pipeline_dir", None)  # غير إلزامي — افتراضي للمشروع
        d = os.path.join(pipeline_dir, "models") if pipeline_dir else ".montage_ai/models"
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, name)
        if name in ("deploy.prototxt", "haarcascade_frontalface.xml"):
            return p if os.path.exists(p) else None
        if name == "res10_300x300_ssd.caffemodel":
            if os.path.exists(p) and os.path.getsize(p) > 100000:
                return p
            for u in ("https://raw.githubusercontent.com/opencv/opencv_3.0.0/release-3.0.0/samples/dnn/face_detector/res10_300x300_ssd_iter_140000.caffemodel",):
                try:
                    import urllib.request
                    urllib.request.urlretrieve(u, p)
                    if os.path.getsize(p) > 100000:
                        return p
                except Exception as exc:  # noqa: BLE001
                    self.logger.debug("تنزيل res10 فشل (%s) — سيستخدم Haar", exc)
        return p if os.path.exists(p) else None

    def _extract_wav(self, source_path: str) -> str:
        """يستخرج wav 16kHz mono (مطلوب pyannote/التمييز الصوتي)."""
        fd, out = tempfile.mkstemp(prefix=f"montage_diarize_{uuid.uuid4().hex[:8]}_", suffix=".wav")
        os.close(fd)
        subprocess.run([self.ffmpeg, "-y", "-i", source_path, "-ar", "16000", "-ac", "1", out],
            capture_output=True, timeout=60, check=False)
        return out

    # ------------------------------------------------------------------
    # أدوات ffmpeg (منفّذة)
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # أدوات ffmpeg (منفّذة)
    # ------------------------------------------------------------------

    def _probe_source(self, path: str) -> dict:
        """يستخرج المدة/الدقة/fps من مخرجات ``ffmpeg -i`` (سريع، بلا ffprobe)."""
        try:
            proc = subprocess.run(
                [self.ffmpeg, "-hide_banner", "-i", path],
                capture_output=True,
                text=True,
                timeout=30,
            )
        except FileNotFoundError as exc:
            raise RuntimeError(f"ffmpeg غير موجود: {self.ffmpeg}") from exc
        info = proc.stderr or ""

        duration = 0.0
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", info)
        if m:
            duration = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))

        width = height = 0
        m = re.search(r"(\d{2,4})x(\d{2,4})", info)
        if m:
            width, height = int(m.group(1)), int(m.group(2))

        fps = 30.0
        m = re.search(r"(\d+(?:\.\d+)?)\s*fps", info)
        if m:
            fps = float(m.group(1))

        return {
            "duration": duration,
            "width": width,
            "height": height,
            "fps": fps,
            "has_audio": "Audio:" in info,
        }

    def _detect_silences(self, path: str) -> List[SilenceSpan]:
        """يكتشف فترات الصمت (> 0.3s) عبر silencedetect — نفس عتبة طبقة Next.js."""
        try:
            proc = subprocess.run(
                [
                    self.ffmpeg,
                    "-hide_banner",
                    "-i", path,
                    "-af", f"silencedetect=noise={SILENCE_NOISE_DB}dB:d={MIN_SILENCE_SECONDS}",
                    "-f", "null", "-",
                ],
                capture_output=True,
                text=True,
                timeout=300,
            )
        except subprocess.TimeoutExpired:
            self.logger.warning("انتهت مهلة كشف الصمت (فيديو طويل؟) — سيعالج بدون خريطة صمت")
            return []
        out = proc.stderr or ""
        starts = [float(x) for x in re.findall(r"silence_start:\s*([\d.]+)", out)]
        ends = [float(x) for x in re.findall(r"silence_end:\s*([\d.]+)", out)]
        spans = []
        for i, s in enumerate(starts):
            e = ends[i] if i < len(ends) else s + MIN_SILENCE_SECONDS
            if e - s >= MIN_SILENCE_SECONDS:
                spans.append(SilenceSpan(start=s, end=e))
        return spans


def _demo_words(duration: float) -> List[WordTiming]:
    """كلمات عربية تجريبية موزعة على مدة الفيديو — لتشغيل الترجمات بلا Whisper."""
    text = "مرحبا بكم في محرر المونتاج الذكي — قص الصمت تلقائيا وإضافة الترجمات"
    words = text.split()
    step = duration / max(len(words), 1)
    return [
        WordTiming(word=w, start=i * step, end=(i + 1) * step, index=i)
        for i, w in enumerate(words)
    ]
