import { describe, expect, it } from "vitest";
import { redactUrl } from "./log-redact.js";

describe("redactUrl", () => {
  it("вырезает access-токен из адреса сокета урока, сохраняя остальные параметры", () => {
    expect(redactUrl("/ws?lessonId=abc&token=eyJhbGciOi.payload.sig")).toBe(
      "/ws?lessonId=abc&token=%5Bredacted%5D",
    );
  });

  it("вырезает recorder-токен и подпись ссылки на файл", () => {
    expect(redactUrl("/egress?lessonId=a&recorderToken=x")).toBe("/egress?lessonId=a&recorderToken=%5Bredacted%5D");
    expect(redactUrl("/files/k?exp=1&sig=abc")).toBe("/files/k?exp=1&sig=%5Bredacted%5D");
  });

  it("адрес без секретов не меняет", () => {
    expect(redactUrl("/api/v1/lessons/1?page=2")).toBe("/api/v1/lessons/1?page=2");
    expect(redactUrl("/health")).toBe("/health");
  });
});
