"use client";

import dynamic from "next/dynamic";

const ExtensionsManager = dynamic(() => import("@/components/extensions/ExtensionsManager"), {
  ssr: false,
  loading: () => (
    <div className="h-screen w-screen flex items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-3">
        <div className="h-12 w-12 rounded-full border-2 border-brand/30 border-t-brand animate-spin" />
        <p className="text-ink-soft text-sm">جاري تحميل مدير الإضافات...</p>
      </div>
    </div>
  ),
});

export default function ExtensionsLoader() {
  return <ExtensionsManager />;
}
