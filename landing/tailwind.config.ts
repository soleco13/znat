import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

/**
 * Дизайн-система «Школа онлайн» (Shkola / AutoCheck) — те же токены, что в
 * apps/web/tailwind.config.js. Значения приходят из src/index.css.
 * Лендинг добавляет свои keyframes для скролл-анимаций и «дорогих» эффектов.
 */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1.25rem", screens: { "2xl": "1200px" } },
    extend: {
      fontFamily: {
        sans: "var(--font)",
        mono: "var(--font-mono)",
      },
      fontWeight: {
        medium: "550",
        semibold: "650",
        bold: "700",
        heavy: "750",
        black: "800",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "var(--c-primary-hover)",
          light: "var(--c-primary-light)",
          muted: "var(--c-primary-muted)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          light: "var(--c-success-light)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        teal: {
          DEFAULT: "hsl(var(--teal))",
          foreground: "hsl(var(--primary-foreground))",
          light: "var(--c-teal-light)",
        },
        cyan: "var(--c-cyan)",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        text: {
          DEFAULT: "var(--c-text)",
          2: "var(--c-text-2)",
          3: "var(--c-text-3)",
        },
        surface: {
          DEFAULT: "var(--c-surface)",
          2: "var(--c-surface-2)",
          3: "var(--c-surface-3)",
        },
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        md: "var(--radius)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "26px",
        "3xl": "34px",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "0 32px 80px -12px rgba(16,24,40,0.22), 0 12px 32px -8px rgba(16,24,40,0.12)",
        glow: "0 0 0 1px rgba(29,78,216,0.18), 0 18px 50px -12px rgba(29,78,216,0.35)",
      },
      maxWidth: { content: "1120px" },
      letterSpacing: {
        tightest: "-0.035em",
        head: "var(--tracking-head)",
      },
      transitionTimingFunction: { ds: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      backgroundImage: {
        "grid-line":
          "linear-gradient(to right, rgba(16,24,40,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(16,24,40,0.045) 1px, transparent 1px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-14px)" },
        },
        "float-slow": {
          "0%, 100%": { transform: "translateY(0) rotate(0deg)" },
          "50%": { transform: "translateY(-22px) rotate(1.5deg)" },
        },
        aurora: {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "33%": { transform: "translate3d(4%, -6%, 0) scale(1.12)" },
          "66%": { transform: "translate3d(-5%, 4%, 0) scale(0.95)" },
        },
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(calc(-50% - 0.75rem))" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "70%": { transform: "scale(1.7)", opacity: "0" },
          "100%": { opacity: "0" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "gradient-pan": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.24s cubic-bezier(0.2,0.8,0.2,1)",
        "accordion-up": "accordion-up 0.24s cubic-bezier(0.2,0.8,0.2,1)",
        float: "float 7s ease-in-out infinite",
        "float-slow": "float-slow 11s ease-in-out infinite",
        aurora: "aurora 22s ease-in-out infinite",
        marquee: "marquee var(--marquee-duration, 34s) linear infinite",
        "pulse-ring": "pulse-ring 2.4s cubic-bezier(0.2,0.8,0.2,1) infinite",
        shimmer: "shimmer 2.4s ease-in-out infinite",
        "gradient-pan": "gradient-pan 6s ease infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
