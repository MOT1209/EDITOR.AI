import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0a0a0f",
          panel: "#12121a",
          soft: "#1a1a26",
          elev: "#22222f",
        },
        line: "#2a2a3a",
        ink: {
          DEFAULT: "#f5f5fa",
          soft: "#a0a0b5",
          mute: "#6b6b80",
        },
        brand: {
          DEFAULT: "#7c3aed",
          glow: "#a855f7",
          accent: "#06b6d4",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      boxShadow: {
        glow: "0 0 40px rgba(124, 58, 237, 0.35)",
        panel: "0 8px 32px rgba(0, 0, 0, 0.5)",
      },
      animation: {
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
        "scan-line": "scan-line 2s linear infinite",
        shimmer: "shimmer 2.4s linear infinite",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "0.7" },
          "50%": { opacity: "1" },
        },
        "scan-line": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
