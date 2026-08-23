import { importUsersRowSchema, type ImportUsersRow } from "@school/shared";
import { AppError } from "../../plugins/errors.js";

const EXPECTED_HEADER = ["email", "fullName", "role", "password"];

/**
 * Минимальный парсер: без экранированных кавычек и запятых внутри полей.
 * Формат для CSV-импорта класса контролируется администратором, не внешними данными.
 */
export function parseUsersCsv(content: string): ImportUsersRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new AppError(400, "empty_csv", "CSV-файл пуст");
  }

  const header = lines[0]!.split(",").map((h) => h.trim());
  if (header.join(",") !== EXPECTED_HEADER.join(",")) {
    throw new AppError(
      400,
      "invalid_csv_header",
      `Ожидались колонки: ${EXPECTED_HEADER.join(", ")}`,
    );
  }

  return lines.slice(1).map((line, index) => {
    const cells = line.split(",").map((c) => c.trim());
    const [email, fullName, role, password] = cells;
    const parsed = importUsersRowSchema.safeParse({ email, fullName, role, password });
    if (!parsed.success) {
      throw new AppError(400, "invalid_csv_row", `Строка ${index + 2}: ${parsed.error.message}`);
    }
    return parsed.data;
  });
}
