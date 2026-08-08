// مكوّنات UI صغيرة مستقلة — استُخرجت من Editor.tsx لتقليل حجم الملف.
import { X } from "lucide-react";

export function ModalShell({
  onClose,
  title,
  icon: Icon,
  children,
  width = "max-w-md",
}: {
  onClose: () => void;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        className={`w-full ${width} glass bg-bg-panel border border-line rounded-2xl shadow-panel overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-12 border-b border-line flex items-center px-4 gap-2">
          <Icon className="h-4 w-4 text-brand-glow" />
          <span className="text-sm font-semibold flex-1">{title}</span>
          <button onClick={onClose} className="btn-ghost p-1">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function SectionTitle({ icon: Icon, title }: { icon: React.ComponentType<{ className?: string }>; title: string }) {
  return (
    <div className="flex items-center gap-1.5 text-ink-soft">
      <Icon className="h-3.5 w-3.5" />
      <span className="text-[11px] font-semibold uppercase tracking-wider">{title}</span>
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center text-[11px] text-ink-mute py-4 px-2 rounded-md border border-dashed border-line">
      {text}
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-1.5 rounded bg-bg-soft">
      <span className="text-ink-mute">{label}</span>
      <span className="text-ink font-mono">{value}</span>
    </div>
  );
}

export function StatBox({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="p-2 rounded-md bg-bg-soft border border-line/50 text-center">
      <Icon className="h-4 w-4 mx-auto text-brand-glow mb-1" />
      <div className="text-base font-bold">{value}</div>
      <div className="text-[10px] text-ink-mute">{label}</div>
    </div>
  );
}

export function SliderRow({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-ink-soft mb-1">
        <span>{label}</span>
        <span className="font-mono text-brand-glow">
          {suffix || value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-brand"
      />
    </div>
  );
}

export function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (s: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-ink-soft flex-1">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-10 rounded border border-line bg-transparent"
      />
    </div>
  );
}

export function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (b: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="w-full flex items-center justify-between p-2 rounded-md bg-bg-soft border border-line/50"
    >
      <span className="text-[11px] text-ink-soft">{label}</span>
      <div
        className={`h-5 w-9 rounded-full relative transition ${
          value ? "bg-brand" : "bg-bg-elev"
        }`}
      >
        <div
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
            value ? "right-0.5" : "right-4.5"
          }`}
        />
      </div>
    </button>
  );
}
