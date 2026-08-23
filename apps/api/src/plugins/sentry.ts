import * as Sentry from "@sentry/node";
import { env } from "./env.js";

/**
 * GlitchTip — self-hosted, протокол совместим со Sentry SDK (§10.10 ТЗ,
 * см. проектную заметку про MCP/observability). Без GLITCHTIP_DSN — no-op.
 */
export function initErrorReporting() {
  if (!env.GLITCHTIP_DSN) return;
  Sentry.init({
    dsn: env.GLITCHTIP_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0,
  });
}

export function reportError(error: unknown) {
  if (!env.GLITCHTIP_DSN) return;
  Sentry.captureException(error);
}
