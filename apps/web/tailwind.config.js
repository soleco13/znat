/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Палитра из дизайн-системы Shkola/AutoCheck (claude.ai/design,
      // проект 385aa818-0231-4b1a-bcf1-b73fa54f90bb, colors_and_type.css).
      // Значения — CSS-переменные из src/index.css, единый источник правды.
      colors: {
        primary: {
          DEFAULT: "var(--c-primary)",
          hover: "var(--c-primary-hover)",
          light: "var(--c-primary-light)",
          muted: "var(--c-primary-muted)",
        },
        teal: { DEFAULT: "var(--c-teal)", light: "var(--c-teal-light)" },
        cyan: "var(--c-cyan)",
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
        appbg: "var(--c-bg)",
        border: { DEFAULT: "var(--c-border-solid)", soft: "var(--c-border)" },
        danger: { DEFAULT: "var(--c-danger)", light: "var(--c-danger-light)" },
        warn: { DEFAULT: "var(--c-warn)", light: "var(--c-warn-light)" },
        success: { DEFAULT: "var(--c-success)", light: "var(--c-success-light)" },
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        sm: "var(--radius-sm)",
        lg: "var(--radius-lg)",
        pill: "var(--radius-pill)",
      },
    },
  },
  plugins: [],
};
