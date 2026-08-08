import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

function wrapText(text: string, max: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (test.length > max) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function buildSVG(title: string, aspect: string): string {
  const lines = wrapText(title || "فيديو رائع", 18);
  const w = 1280;
  const h = aspect === "9:16" ? 2280 : 720;
  const lineH = 96;
  const totalH = lines.length * lineH;
  const startY = h / 2 - totalH / 2 + lineH * 0.75;

  const tspans = lines
    .map(
      (l, i) =>
        `<tspan x="${w / 2}" dy="${i === 0 ? 0 : lineH}">${escape(l)}</tspan>`
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#7c3aed"/>
        <stop offset="100%" stop-color="#06b6d4"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.5" r="0.6">
        <stop offset="0%" stop-color="rgba(255,255,255,0.25)"/>
        <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
      </radialGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000" flood-opacity="0.5"/>
      </filter>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <rect width="${w}" height="${h}" fill="url(#glow)"/>
    <rect x="0" y="0" width="${w}" height="${h}" fill="rgba(0,0,0,0.25)"/>
    <text x="${w / 2}" y="${startY}" text-anchor="middle" font-family="Tajawal, Arial, sans-serif" font-size="86" font-weight="800" fill="#fff" filter="url(#shadow)">${tspans}</text>
    <g transform="translate(60, ${h - 110})">
      <rect x="0" y="0" width="160" height="48" rx="8" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.4)"/>
      <text x="80" y="32" text-anchor="middle" font-family="Tajawal, Arial, sans-serif" font-size="22" font-weight="600" fill="#fff">MontageAI</text>
    </g>
  </svg>`;
}

function escape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function POST(req: NextRequest) {
  const { title = "فيديو رائع", aspect = "16:9" } = await req.json();
  const svg = buildSVG(title, aspect);
  return NextResponse.json({
    svg: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    title,
    aspect,
  });
}
