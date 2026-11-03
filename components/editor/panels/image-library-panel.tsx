"use client";

import { useState } from "react";
import { v4 as uuid } from "uuid";
import { SectionTitle } from "../ui";
import { Image as ImageIcon, Plus, Loader2, Search } from "lucide-react";
import { apiFetch } from "@/lib/api-config";
import type { State, Action } from "../state";

interface PexelsPhoto {
  id: string;
  thumbnail: string;
  fullUrl: string;
  photographer: string;
}

export function ImageLibraryPanel({ state, dispatch }: { state: State; dispatch: React.Dispatch<Action> }) {
  const [query, setQuery] = useState("");
  const [photos, setPhotos] = useState<PexelsPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [importingId, setImportingId] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/assets/pexels?query=${encodeURIComponent(query)}`).then((r) => r.json());
      setConfigured(res.configured !== false);
      setPhotos(res.photos || []);
    } finally {
      setLoading(false);
    }
  };

  const addPhoto = async (photo: PexelsPhoto) => {
    setImportingId(photo.id);
    try {
      const res = await apiFetch("/api/assets/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: photo.fullUrl }),
      }).then((r) => r.json());
      if (!res.ref) return;
      const start = state.playhead || 0;
      dispatch({
        type: "ADD_CLIP",
        clip: {
          id: uuid(),
          assetId: `pexels_${photo.id}`,
          trackId: "t_video",
          start,
          duration: 4,
          inPoint: 0,
          outPoint: 4,
          effects: [],
          volume: 1,
          speed: 1,
          zoom: 1,
          panX: 0,
          panY: 0,
          smartZoom: false,
          kind: "image",
          imageUrl: res.ref as string,
        },
      });
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className="space-y-2">
      <SectionTitle icon={ImageIcon} title="مكتبة صور (Pexels)" />
      <div className="flex gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="ابحث عن صورة... (مثلاً: nature)"
          className="flex-1 bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
        />
        <button onClick={search} disabled={loading} className="btn-outline px-2.5" aria-label="بحث">
          <Search className="h-3.5 w-3.5" />
        </button>
      </div>
      {!configured && (
        <div className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md p-2">
          أضف مفتاح Pexels (PEXELS_API_KEY) في .env.local أو نافذة إعدادات API لتفعيل المكتبة.
        </div>
      )}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 max-h-72 overflow-y-auto">
          {photos.map((p) => (
            <button
              key={p.id}
              onClick={() => addPhoto(p)}
              disabled={importingId === p.id}
              className="relative aspect-video rounded-md overflow-hidden border border-line/50 hover:border-brand/40 group"
            >
              <img src={p.thumbnail} alt={p.photographer} className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors">
                {importingId === p.id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                ) : (
                  <Plus className="h-4 w-4 text-white opacity-0 group-hover:opacity-100" />
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
