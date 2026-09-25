import { describe, expect, it } from "vitest";
import { getProxyFilePath } from "./service.js";

describe("getProxyFilePath (X-Accel-Redirect для Caddy)", () => {
  it("отдаёт путь от корня тома хранилища", () => {
    expect(getProxyFilePath("school-1/abc.png")).toBe("/school-1/abc.png");
    expect(getProxyFilePath("recordings/s/l/r.mp4")).toBe("/recordings/s/l/r.mp4");
  });

  it("экранирует символы, которые Caddy иначе разобрал бы как часть URI", () => {
    expect(getProxyFilePath("s/a b?#.png")).toBe("/s/a%20b%3F%23.png");
  });

  it("не выпускает за пределы тома", () => {
    expect(() => getProxyFilePath("../etc/passwd")).toThrow();
    expect(() => getProxyFilePath("s/../../etc/passwd")).toThrow();
    expect(() => getProxyFilePath("/etc/passwd")).toThrow();
    expect(() => getProxyFilePath("s//a.png")).toThrow();
  });
});
