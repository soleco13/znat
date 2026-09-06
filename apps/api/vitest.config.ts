import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_URL: "postgres://school:school@localhost:5432/school_test",
      REDIS_URL: "redis://localhost:6379",
      JWT_ACCESS_SECRET: "test-access-secret-at-least-32-characters",
      JWT_REFRESH_SECRET: "test-refresh-secret-at-least-32-characters",
      JWT_GUEST_SECRET: "test-guest-secret-at-least-32-characters",
      COOKIE_SECRET: "test-cookie-secret-at-least-32-characters",
      STORAGE_HMAC_SECRET: "test-storage-hmac-secret-at-least-32-chars",
      LIVEKIT_API_SECRET: "test-livekit-api-secret",
    },
  },
});
