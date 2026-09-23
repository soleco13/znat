/**
 * Э14.1 — проверка ИНН/ОГРН при регистрации ООО: ТОЛЬКО формат и контрольная
 * сумма (локальный алгоритм ФНС), без обращения к ЕГРЮЛ/DaData (решено
 * заранее — отлавливает опечатки, не подтверждает реальное существование
 * организации). Чистые функции, используются и на бэке (Zod `.refine`), и
 * на фронте (live-валидация формы) — одна реализация.
 */

function digitsOnly(value: string): number[] | null {
  if (!/^\d+$/.test(value)) return null;
  return value.split("").map(Number);
}

function checksum(digits: number[], weights: number[]): number {
  const sum = weights.reduce((acc, w, i) => acc + w * (digits[i] ?? 0), 0);
  return (sum % 11) % 10;
}

/** ИНН юрлица (ООО) — 10 цифр, 1 контрольная. */
export function validateInn10(value: string): boolean {
  const digits = digitsOnly(value);
  if (!digits || digits.length !== 10) return false;
  const weights = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  return checksum(digits, weights) === digits[9];
}

/** ИНН физлица/ИП — 12 цифр, 2 контрольные. */
export function validateInn12(value: string): boolean {
  const digits = digitsOnly(value);
  if (!digits || digits.length !== 12) return false;
  const weights11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const weights12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  return (
    checksum(digits, weights11) === digits[10] && checksum(digits, weights12) === digits[11]
  );
}

/** Диспетчер по длине строки: 10 цифр — юрлицо, 12 — физлицо/ИП. */
export function validateInn(value: string): boolean {
  if (/^\d{10}$/.test(value)) return validateInn10(value);
  if (/^\d{12}$/.test(value)) return validateInn12(value);
  return false;
}

/** ОГРН юрлица — 13 цифр, последняя = (первые 12 как число) mod 11 mod 10. */
export function validateOgrn13(value: string): boolean {
  const digits = digitsOnly(value);
  if (!digits || digits.length !== 13) return false;
  const first12 = BigInt(value.slice(0, 12));
  const check = Number(first12 % 11n % 10n);
  return check === digits[12];
}

/** ОГРНИП ИП — 15 цифр, последняя = (первые 14 как число) mod 13 mod 10. */
export function validateOgrnip15(value: string): boolean {
  const digits = digitsOnly(value);
  if (!digits || digits.length !== 15) return false;
  const first14 = BigInt(value.slice(0, 14));
  const check = Number(first14 % 13n % 10n);
  return check === digits[14];
}

/** Диспетчер по длине строки: 13 цифр — юрлицо, 15 — ИП. */
export function validateOgrn(value: string): boolean {
  if (/^\d{13}$/.test(value)) return validateOgrn13(value);
  if (/^\d{15}$/.test(value)) return validateOgrnip15(value);
  return false;
}
