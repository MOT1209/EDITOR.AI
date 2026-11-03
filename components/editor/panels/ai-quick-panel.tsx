"use client";

import {
  Sparkles,
  Scissors,
  Palette,
  Captions,
  Image as ImageIcon,
  Wand2,
  Layers,
  Smartphone,
  Tag,
  Bot,
  Brain,
  Aperture,
  Search,
  Crop,
  Waves,
  Video,
  Eye,
} from "lucide-react";
import type { State, Action } from "../state";

export function AIQuickPanel({
  state,
  dispatch,
  onFullAuto,
  onDirector,
  agentRequest,
  setAgentRequest,
  onSilence,
  onSubtitles,
  onColor,
  onStabilize,
  onBRoll,
  onShorts,
  onSceneDetect,
  onFaceDetect,
  onObjectDetect,
  onHighlight,
  onReframe,
  onMusicSync,
  onThumbnail,
  onTitleDesc,
  onFullPipeline,
  bpmInput,
  setBpmInput,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onFullAuto: () => void;
  onDirector: (requestText: string) => void;
  onFullPipeline: () => void;
  agentRequest: string;
  setAgentRequest: (s: string) => void;
  onSilence: () => void;
  onSubtitles: () => void;
  onColor: () => void;
  onStabilize: () => void;
  onBRoll: () => void;
  onShorts: () => void;
  onSceneDetect: () => void;
  onFaceDetect: () => void;
  onObjectDetect: () => void;
  onHighlight: () => void;
  onReframe: () => void;
  onMusicSync: () => void;
  onThumbnail: () => void;
  onTitleDesc: () => void;
  bpmInput: number;
  setBpmInput: (n: number) => void;
}) {
  const items: { id: string; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void; tone: string }[] = [
    {
      id: "auto",
      label: "مونتاج كامل تلقائي",
      desc: "تحليل + ترجمة + موسيقى + عناوين + B-Roll بضغطة واحدة",
      icon: Wand2,
      onClick: onFullAuto,
      tone: "from-brand to-brand-accent",
    },
    {
      id: "pipeline",
      label: "المسار الكامل (5 وكلاء)",
      desc: "تحليل + خطة EDL + تأكيدك ثم رندر فعلي — المسار الكامل",
      icon: Bot,
      onClick: onFullPipeline,
      tone: "from-violet-500 to-indigo-500",
    },
    {
      id: "silence",
      label: "إزالة الصمت والتوقفات",
      desc: "كشف وقص لحظات السكوت والوقفات الطويلة",
      icon: Scissors,
      onClick: onSilence,
      tone: "from-rose-500 to-orange-500",
    },
    {
      id: "scenes",
      label: "تقسيم المشاهد",
      desc: "كشف وتقسيم الفيديو إلى مشاهد منفصلة",
      icon: Video,
      onClick: onSceneDetect,
      tone: "from-sky-500 to-cyan-500",
    },
    {
      id: "faces",
      label: "كشف الوجوه",
      desc: "اكتشاف الوجوه وتتبعها في الفيديو",
      icon: Search,
      onClick: onFaceDetect,
      tone: "from-green-500 to-emerald-500",
    },
    {
      id: "objects",
      label: "كشف الأشياء",
      desc: "اكتشاف الأشياء المهمة في المشاهد",
      icon: Eye,
      onClick: onObjectDetect,
      tone: "from-teal-500 to-cyan-500",
    },
    {
      id: "subs",
      label: "ترجمة تلقائية",
      desc: "تفريغ صوتي ومزامنة على التايملاين",
      icon: Captions,
      onClick: onSubtitles,
      tone: "from-cyan-500 to-blue-500",
    },
    {
      id: "color",
      label: "تحسين الألوان",
      desc: "ضبط الإضاءة والتباين والتشبع",
      icon: Palette,
      onClick: onColor,
      tone: "from-amber-500 to-pink-500",
    },
    {
      id: "stab",
      label: "تثبيت الفيديو",
      desc: "إزالة الاهتزاز وتحسين الثبات",
      icon: Aperture,
      onClick: onStabilize,
      tone: "from-emerald-500 to-teal-500",
    },
    {
      id: "broll",
      label: "B-Roll تلقائي",
      desc: "توليد مشاهد تكميلية ذكية",
      icon: Layers,
      onClick: onBRoll,
      tone: "from-violet-500 to-fuchsia-500",
    },
    {
      id: "shorts",
      label: "Shorts / Reels",
      desc: "تحويل الفيديو إلى مقاطع عمودية",
      icon: Smartphone,
      onClick: onShorts,
      tone: "from-pink-500 to-rose-500",
    },
    {
      id: "highlight",
      label: "أفضل اللقطات",
      desc: "استخراج أفضل المشاهد تلقائياً",
      icon: Sparkles,
      onClick: onHighlight,
      tone: "from-orange-500 to-red-500",
    },
    {
      id: "reframe",
      label: "تحويل أفقي/عمودي",
      desc: "إعادة تأطير ذكية لمقاييس مختلفة",
      icon: Crop,
      onClick: onReframe,
      tone: "from-purple-500 to-violet-500",
    },
    {
      id: "music-sync",
      label: "مزامنة الموسيقى",
      desc: "مزامنة التقطيع مع الإيقاع الموسيقي",
      icon: Waves,
      onClick: onMusicSync,
      tone: "from-blue-500 to-indigo-500",
    },
    {
      id: "thumb",
      label: "Thumbnail تلقائي",
      desc: "غلاف جذاب بتقنية AI",
      icon: ImageIcon,
      onClick: onThumbnail,
      tone: "from-yellow-500 to-amber-500",
    },
    {
      id: "title",
      label: "عنوان ووصف",
      desc: "توليد عنوان SEO ووصف للفيديو",
      icon: Tag,
      onClick: onTitleDesc,
      tone: "from-indigo-500 to-purple-500",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-xl p-3 bg-gradient-to-br from-brand/20 to-brand-accent/10 border border-brand/30">
        <div className="flex items-start gap-2">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-brand to-brand-accent flex items-center justify-center shrink-0">
            <Brain className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold">المديرة التنفيذية 🎬</div>
            <p className="text-[11px] text-ink-soft mt-1">
              اشرح ماذا تريد — المديرة تحلل الفيديو، تقص الصمت والملل، تضيف الترجمة والموسيقى واللمسات، وتنفذ كل شيء تلقائياً.
            </p>
          </div>
        </div>
        <textarea
          value={agentRequest}
          onChange={(e) => setAgentRequest(e.target.value)}
          rows={3}
          placeholder="مثال: حوّله لفيديو إعلاني قصير وحماسي مع ترجمة واضحة ونصوص توضيحية…"
          className="mt-3 w-full rounded-lg bg-black/25 border border-brand/20 text-xs p-2.5 placeholder:text-ink-mute focus:border-brand/50 focus:outline-none resize-none text-ink"
        />
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => onDirector(agentRequest)}
            className="flex-1 btn-primary !py-2"
          >
            <Bot className="h-4 w-4" />
            نفّذ بالمديرة التنفيذية
          </button>
        </div>
        <button
          onClick={onFullAuto}
          className="mt-2 w-full rounded-lg border border-line/60 text-ink-soft hover:bg-bg-soft hover:text-ink transition flex items-center justify-center gap-1.5 py-2 text-[11px]"
        >
          <Wand2 className="h-3.5 w-3.5" />
          مونتاج كامل سريع (إعدادات افتراضية)
        </button>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-ink-soft mb-2">المزاج الموسيقي</div>
        <div className="grid grid-cols-3 gap-1.5">
          {["ملهم", "مريح", "سعيد", "متوتر", "احترافي", "حالم"].map((m) => (
            <button
              key={m}
              onClick={() => dispatch({ type: "SET_MOOD", mood: m })}
              className={`text-[10px] py-1.5 rounded-md border ${
                state.aiMood === m
                  ? "bg-brand/15 border-brand/40 text-brand-glow"
                  : "border-line text-ink-soft hover:bg-bg-soft"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-ink-soft mb-2">BPM للمزامنة</div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            aria-label="BPM للمزامنة"
            min={60}
            max={200}
            step={5}
            value={bpmInput}
            onChange={(e) => setBpmInput(Number(e.target.value))}
            className="flex-1 h-1.5 rounded-full appearance-none bg-bg-elev accent-brand cursor-pointer"
          />
          <span className="text-xs font-semibold text-ink-soft w-12 text-left">{bpmInput} BPM</span>
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-ink-soft mb-2">أدوات الذكاء</div>
        <div className="space-y-1.5">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={it.onClick}
              className="w-full text-right rounded-lg p-2.5 bg-bg-soft hover:bg-bg-elev border border-line/50 hover:border-brand/40 transition flex items-start gap-2.5"
            >
              <div
                className={`h-8 w-8 rounded-md bg-gradient-to-br ${it.tone} flex items-center justify-center shrink-0`}
              >
                <it.icon className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold">{it.label}</div>
                <div className="text-[10px] text-ink-mute leading-tight mt-0.5">{it.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
