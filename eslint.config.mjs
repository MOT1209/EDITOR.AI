// ESLint 9 (flat config) — نفس قواعد .eslintrc.json السابق (next/core-web-vitals).
import { FlatCompat } from "@eslint/eslintrc";
import path from "path";
import { fileURLToPath } from "url";

const compat = new FlatCompat({ baseDirectory: path.dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", ".montage_ai/**", ".venv/**", "next-env.d.ts", "docs/**", "examples/**", "public/**"] },
  ...compat.extends("next/core-web-vitals"),
  { files: ["components/editor/*.tsx"], rules: { "@next/next/no-img-element": "off" } },
];

export default config;
