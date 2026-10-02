import { describe, expect, it, vi } from "vitest";

vi.mock("./env.js", () => ({ env: { PUBLIC_ORIGIN: "https://school.example", NODE_ENV: "production" } }));

const { assertSameOrigin } = await import("./same-origin.js");

function req(overrides: { method?: string; origin?: string; cookie?: string; host?: string }) {
  return {
    method: overrides.method ?? "POST",
    host: overrides.host ?? "school.example",
    headers: { origin: overrides.origin, cookie: overrides.cookie },
  };
}

describe("assertSameOrigin", () => {
  it("свой origin с куками — пропускает", () => {
    expect(() => assertSameOrigin(req({ origin: "https://school.example", cookie: "refresh_token=x" }))).not.toThrow();
  });

  it("origin совпадает с хостом запроса (вход по IP) — пропускает", () => {
    expect(() =>
      assertSameOrigin(req({ origin: "https://10.0.0.1", host: "10.0.0.1", cookie: "guest_session=x" })),
    ).not.toThrow();
  });

  it("чужой origin (другой порт того же хоста) с куками — 403", () => {
    expect(() =>
      assertSameOrigin(req({ origin: "https://school.example:7880", cookie: "refresh_token=x" })),
    ).toThrow(expect.objectContaining({ statusCode: 403, code: "cross_origin_request" }));
  });

  it("Origin: null с куками — 403", () => {
    expect(() => assertSameOrigin(req({ origin: "null", cookie: "refresh_token=x" }))).toThrow();
  });

  it("без кук, без Origin или безопасный метод — пропускает", () => {
    expect(() => assertSameOrigin(req({ origin: "https://evil.example" }))).not.toThrow();
    expect(() => assertSameOrigin(req({ cookie: "refresh_token=x" }))).not.toThrow();
    expect(() =>
      assertSameOrigin(req({ method: "GET", origin: "https://evil.example", cookie: "refresh_token=x" })),
    ).not.toThrow();
  });
});
