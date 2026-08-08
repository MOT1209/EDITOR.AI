import { apiConfig } from "../api-config";

export async function hfTranslate(text: string, sourceLang = "auto", targetLang = "ar") {
  return huggingfaceCall(
    "facebook/mbart-large-50-many-to-many-mmt",
    { inputs: text, parameters: { src_lang: sourceLang, tgt_lang: targetLang } },
  );
}

export async function hfZeroShot(text: string, labels: string[]) {
  const res = await huggingfaceCall(
    "facebook/bart-large-mnli",
    { inputs: text, parameters: { candidate_labels: labels.join(",") } },
  );
  if (Array.isArray(res)) return res[0];
  return res;
}

export async function hfImageToText(imageBase64: string) {
  return huggingfaceCall(
    "nlpconnect/vit-gpt2-image-captioning",
    { inputs: imageBase64 },
  );
}

export async function hfTextToImage(prompt: string) {
  const token = apiConfig.hfToken;
  if (!token) throw new Error("HF_TOKEN غير مضبوط لإنشاء الصور");
  const res = await fetch(
    `https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-dev`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: prompt }),
    },
  );
  if (!res.ok) throw new Error(`FLUX error ${res.status}`);
  const buf = await res.arrayBuffer();
  return `data:image/webp;base64,${Buffer.from(buf).toString("base64")}`;
}

async function huggingfaceCall(model: string, payload: unknown) {
  const token = apiConfig.hfToken;
  if (!token) throw new Error("HF_TOKEN غير مضبوط");
  const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HuggingFace error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}
