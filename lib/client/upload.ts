// رفع خام متدفق (T-26): جسم الطلب = بايتات الملف مباشرة، فيبثّه المتصفح من القرص ويكتبه الخادم
// للقرص دون تحميله في الذاكرة (multipart كان يُقرأ كاملاً في ذاكرة الخادم قبل أي فحص).
// الاسم يُرسل مرمّزاً في x-upload-name (للامتداد والعرض فقط؛ الخادم يولّد اسماً عشوائياً).
import { apiFetch } from "@/lib/api-config";

export async function uploadFileRaw(url: "/api/ffmpeg/probe" | "/api/assets/upload", file: File): Promise<Response> {
  return apiFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "x-upload-name": encodeURIComponent(file.name),
      ...(file.type ? { "x-upload-type": file.type } : {}),
    },
    body: file,
  });
}
