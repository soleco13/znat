import { describe, expect, it } from "vitest";
import { parseUsersCsv } from "./csv.js";

describe("parseUsersCsv", () => {
  it("parses valid rows", () => {
    const csv = [
      "email,fullName,role,password",
      "student1@school.test,Иван Иванов,student,password123",
      "teacher1@school.test,Мария Петрова,teacher,password123",
    ].join("\n");

    const rows = parseUsersCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ email: "student1@school.test", role: "student" });
    expect(rows[1]).toMatchObject({ email: "teacher1@school.test", role: "teacher" });
  });

  it("rejects a wrong header", () => {
    const csv = "name,mail\nx,y";
    expect(() => parseUsersCsv(csv)).toThrow(/Ожидались колонки/);
  });

  it("rejects a row with invalid role", () => {
    const csv = ["email,fullName,role,password", "x@school.test,X,superadmin,password123"].join("\n");
    expect(() => parseUsersCsv(csv)).toThrow();
  });

  it("rejects an empty file", () => {
    expect(() => parseUsersCsv("")).toThrow(/пуст/);
  });
});
