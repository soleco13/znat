import { lessonJoinCodeSchema } from "@school/shared";
import { describe, expect, it, vi } from "vitest";

// Сервис тянет repo (БД) и чужие сервисы — здесь нужны только чистые функции ссылки.
vi.mock("./repo.js", () => ({}));
vi.mock("../materials/service.js", () => ({}));
vi.mock("../users/service.js", () => ({}));
vi.mock("../../plugins/logger.js", () => ({ logTaskFailure: vi.fn() }));

const { mintJoinToken, joinPath } = await import("./service.js");

describe("короткая ссылка урока", () => {
  it("код — 12 символов [a-z0-9] с хотя бы одной цифрой", () => {
    for (let i = 0; i < 2000; i++) {
      const code = mintJoinToken();
      expect(code).toMatch(/^[a-z0-9]{12}$/);
      expect(code).toMatch(/\d/);
      expect(lessonJoinCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it("коды не повторяются и используют весь алфавит", () => {
    const codes = new Set(Array.from({ length: 5000 }, () => mintJoinToken()));
    expect(codes.size).toBe(5000);
    const chars = new Set([...codes].join(""));
    expect(chars.size).toBe(36);
  });

  it("путь: короткий код — в корне, старый 64-hex токен — по /j/", () => {
    expect(joinPath("skkshki42pwy")).toBe("/skkshki42pwy");
    const legacy = "a".repeat(64);
    expect(joinPath(legacy)).toBe(`/j/${legacy}`);
  });
});

describe("lessonJoinCodeSchema", () => {
  it("отклоняет маршруты приложения и строки не того формата", () => {
    // Без цифры (так выглядят все маршруты), не та длина, заглавные, дефис.
    for (const s of ["login", "lessons", "registration", "abcdefghijkl", "SKKSHKI42PWY", "skkshki42pw", "skkshki42pwyz", "skk-hki42pwy"]) {
      expect(lessonJoinCodeSchema.safeParse(s).success, s).toBe(false);
    }
  });
});
