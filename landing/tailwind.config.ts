import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

/**
 * Дизайн-система «Матис» (Shkola / AutoCheck) — те же токены, что в
 * apps/web/tailwind.config.js. Значения приходят из src/index.css.
 * Лендинг добавляет только типографическую шкалу (text-caption … text-display):
 * один источник размеров вместо десятка «13.5px / 15.5px / 16.5px».
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
          ink: "var(--c-success-ink)",
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
        danger: { DEFAULT: "var(--c-danger)", light: "var(--c-danger-light)" },
        warn: { DEFAULT: "var(--c-warn)", light: "var(--c-warn-light)" },
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
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      /* Шкала ~1.25: подпись → текст → лид → h3 → h2 → дисплей. */
      fontSize: {
        caption: ["13px", { lineHeight: "1.45" }],
        small: ["15px", { lineHeight: "1.6" }],
        body: ["17px", { lineHeight: "1.6" }],
        lead: ["20px", { lineHeight: "1.55" }],
        h3: ["26px", { lineHeight: "1.15", letterSpacing: "-0.025em", fontWeight: "700" }],
        h2: ["clamp(2.125rem, 1.4rem + 2.4vw, 3.25rem)", { lineHeight: "1.05", letterSpacing: "-0.035em", fontWeight: "800" }],
        display: ["clamp(2.75rem, 1rem + 5.6vw, 5.5rem)", { lineHeight: "1.02", letterSpacing: "-0.035em", fontWeight: "800" }],
      },
      maxWidth: { content: "1120px" },
      letterSpacing: {
        tightest: "-0.035em",
        head: "var(--tracking-head)",
      },
      transitionTimingFunction: { ds: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.24s cubic-bezier(0.2,0.8,0.2,1)",
        "accordion-up": "accordion-up 0.24s cubic-bezier(0.2,0.8,0.2,1)",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
