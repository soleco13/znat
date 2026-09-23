import { describe, expect, it } from "vitest";
import {
  validateInn,
  validateInn10,
  validateInn12,
  validateOgrn,
  validateOgrn13,
  validateOgrnip15,
} from "./inn-ogrn.js";

describe("validateInn10 (ИНН юрлица)", () => {
  it("принимает реальные валидные ИНН (Сбербанк, Яндекс)", () => {
    expect(validateInn10("7707083893")).toBe(true);
    expect(validateInn10("7736207543")).toBe(true);
  });

  it("отклоняет опечатку в контрольной цифре", () => {
    expect(validateInn10("7707083894")).toBe(false);
  });

  it("отклоняет неверную длину и нецифровые символы", () => {
    expect(validateInn10("770708389")).toBe(false);
    expect(validateInn10("770708389a")).toBe(false);
  });
});

describe("validateInn12 (ИНН физлица/ИП)", () => {
  it("принимает валидный ИНН физлица", () => {
    expect(validateInn12("500100732259")).toBe(true);
  });

  it("отклоняет опечатку во второй контрольной цифре", () => {
    expect(validateInn12("500100732258")).toBe(false);
  });
});

describe("validateInn (диспетчер по длине)", () => {
  it("выбирает 10- или 12-значный алгоритм по длине строки", () => {
    expect(validateInn("7707083893")).toBe(true);
    expect(validateInn("500100732259")).toBe(true);
  });

  it("отклоняет всё, что не 10 и не 12 цифр", () => {
    expect(validateInn("12345")).toBe(false);
  });
});

describe("validateOgrn13 (ОГРН юрлица)", () => {
  it("принимает реальные валидные ОГРН (Сбербанк, Яндекс)", () => {
    expect(validateOgrn13("1027700132195")).toBe(true);
    expect(validateOgrn13("1027700229193")).toBe(true);
  });

  it("отклоняет опечатку в контрольной цифре", () => {
    expect(validateOgrn13("1027700132196")).toBe(false);
  });
});

describe("validateOgrnip15 (ОГРНИП)", () => {
  it("принимает валидный ОГРНИП", () => {
    expect(validateOgrnip15("304776000321207")).toBe(true);
  });

  it("отклоняет опечатку в контрольной цифре", () => {
    expect(validateOgrnip15("304776000321208")).toBe(false);
  });
});

describe("validateOgrn (диспетчер по длине)", () => {
  it("выбирает 13- или 15-значный алгоритм по длине строки", () => {
    expect(validateOgrn("1027700132195")).toBe(true);
    expect(validateOgrn("304776000321207")).toBe(true);
  });

  it("отклоняет неверную длину", () => {
    expect(validateOgrn("123")).toBe(false);
  });
});
