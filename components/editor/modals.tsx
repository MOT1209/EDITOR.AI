// مودالات مستقلة — استُخرجت من Editor.tsx لتقليل حجم الملف.
import { useState } from "react";
import { Key, Keyboard, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { apiConfig } from "@/lib/api-config";
import { ModalShell } from "./ui";

export function ApiSettingsModal({ onClose }: { onClose: () => void }) {
  const [opencodeKey, setOpenCodeKey] = useState(apiConfig.opencodeKey || "");
  const [hfToken, setHfToken] = useState(apiConfig.hfToken || "");
  const [hfStatus, setHfStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    apiConfig.opencodeKey = opencodeKey;
    apiConfig.hfToken = hfToken;
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const testHf = async () => {
    if (!hfToken) return;
    setHfStatus("testing");
    try {
      const res = await fetch("https://huggingface.co/api/whoami-v2", {
        headers: { Authorization: `Bearer ${hfToken}` },
      });
      setHfStatus(res.ok ? "ok" : "error");
    } catch { setHfStatus("error"); }
  };

  return (
    <ModalShell onClose={onClose} title="إعدادات API" icon={Key}>
      <div className="space-y-5" dir="rtl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Key className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-medium text-zinc-200">OpenAI / OpenCode API</span>
          </div>
          <p className="text-[10px] text-zinc-500 mb-2">مفتاح API للنسخ الصوتي (Whisper) والتحليل (GPT-4o)</p>
          <input
            type="password"
            value={opencodeKey}
            onChange={(e) => setOpenCodeKey(e.target.value)}
            placeholder="sk-..."
            className="w-full bg-[#12121e] border border-[#1e1e2e] rounded px-3 py-2 text-[12px] text-zinc-300 font-mono focus:outline-none focus:border-blue-600/50"
          />
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <Key className="h-4 w-4 text-indigo-400" />
            <span className="text-sm font-medium text-zinc-200">Hugging Face Token</span>
          </div>
          <p className="text-[10px] text-zinc-500 mb-2">رمز Hugging Face للترجمة والتوليد (اختياري)</p>
          <div className="flex gap-2">
            <input
              type="password"
              value={hfToken}
              onChange={(e) => setHfToken(e.target.value)}
              placeholder="hf_..."
              className="flex-1 bg-[#12121e] border border-[#1e1e2e] rounded px-3 py-2 text-[12px] text-zinc-300 font-mono focus:outline-none focus:border-blue-600/50"
            />
            <button
              onClick={testHf}
              disabled={hfStatus === "testing" || !hfToken}
              className="px-3 py-2 rounded bg-[#1a1a28] text-zinc-400 hover:text-zinc-200 text-[11px] border border-[#1e1e2e] disabled:opacity-40"
            >
              {hfStatus === "testing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
               hfStatus === "ok" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> :
               hfStatus === "error" ? <XCircle className="h-3.5 w-3.5 text-red-400" /> : "اختبار"}
            </button>
          </div>
          {hfStatus === "ok" && <p className="text-[10px] text-emerald-400 mt-1">✓ التوكن صالح</p>}
          {hfStatus === "error" && <p className="text-[10px] text-red-400 mt-1">✗ التوكن غير صالح</p>}
        </div>

        <div className="bg-amber-500/5 rounded p-3 border border-amber-500/25">
          <p className="text-[10px] text-amber-300/90 leading-relaxed">
            ⚠️ <b>تنبيه أمني:</b> المفاتيح تُحفظ في المتصفح (localStorage) — أي سكربت على الصفحة
            يستطيع قراءتها (خطر XSS). مناسب للاستخدام المحلي فقط. عند النشر على استضافة عامة
            استخدم متغيرات البيئة على الخادم (<code className="bg-[#12121e] px-1 rounded">process.env</code>)
            ولا تعتمد على هذه النافذة. للاستخدام الدائم محلياً أضفها في
            <code className="bg-[#12121e] px-1 rounded">.env.local</code>:
            <br />
            <code className="text-zinc-400 bg-[#12121e] px-1 rounded block mt-1">OPENCODE_API_KEY=sk-...<br />HF_TOKEN=hf_...</code>
          </p>
        </div>

        <div className="flex gap-2 justify-end pt-2 border-t border-[#1e1e2e]">
          <button onClick={onClose} className="px-4 py-2 rounded text-[11px] text-zinc-400 hover:text-zinc-200 bg-[#1a1a28] border border-[#1e1e2e]">
            إلغاء
          </button>
          <button onClick={handleSave} className="px-4 py-2 rounded text-[11px] text-white bg-blue-600 hover:bg-blue-500 flex items-center gap-2">
            {saved && <CheckCircle2 className="h-3 w-3" />}
            {saved ? "تم الحفظ" : "حفظ الإعدادات"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const items = [
    { k: "Space", l: "تشغيل / إيقاف" },
    { k: "← / →", l: "تقديم / تأخير 5 ثوان" },
    { k: "+ / -", l: "تكبير / تصغير التايملاين" },
    { k: "S", l: "قص عند نقطة التشغيل" },
    { k: "Del", l: "حذف المقطع المحدد" },
    { k: "M", l: "كتم الصوت" },
  ];
  return (
    <ModalShell onClose={onClose} title="اختصارات لوحة المفاتيح" icon={Keyboard} width="max-w-md">
      <div className="space-y-1.5">
        {items.map((i) => (
          <div
            key={i.k}
            className="flex items-center justify-between p-2 rounded-md bg-bg-soft border border-line/50"
          >
            <span className="text-xs text-ink-soft">{i.l}</span>
            <kbd className="text-[10px] px-2 py-0.5 rounded bg-bg border border-line text-brand-glow font-mono">
              {i.k}
            </kbd>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}
