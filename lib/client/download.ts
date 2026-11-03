// تنزيل ملف من المتصفح (Blob ⇒ رابط مؤقت). مصدر واحد لكل مواضع التنزيل في الواجهة.
// الإلغاء الفوري لرابط blob بعد click() كان يضيّع اسم الملف (يظهر «download») وقد يقطع التنزيل في بعض
// المتصفحات؛ نبقي الرابط 30 ثانية ثم نحرّره. الإضافة للـ DOM لازمة لـ Firefox.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
