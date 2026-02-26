/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Paleta Mente Viva
        ink: "#08071A",
        deep: "#110F2B",
        panel: "#181630",
        card: "#201D3E",
        // Acentos
        violet: {
          DEFAULT: "#7C3AED",
          light: "#A855F7",
          lighter: "#C084FC",
        },
        teal: {
          DEFAULT: "#06B6D4",
          dark: "#0E7490",
        },
        // Semaforo
        success: "#16A34A",
        warning: "#F97316",
        danger: "#DC2626",
        // Texto
        cream: "#F5F3FF",
        muted: "rgba(245, 243, 255, 0.6)",
        subtle: "rgba(245, 243, 255, 0.35)",
      },
      fontFamily: {
        syne: ["Syne", "sans-serif"],
        sans: ["Instrument Sans", "sans-serif"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "breathe": "breathe 4s ease-in-out infinite",
      },
      keyframes: {
        breathe: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.02)" },
        },
      },
    },
  },
  plugins: [],
};
