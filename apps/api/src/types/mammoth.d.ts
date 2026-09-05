/**
 * `mammoth` не публикует свои типы и не имеет `@types/mammoth` в
 * DefinitelyTyped (Э9.11, проверено — пакет отсутствует в реестре).
 * Минимальная декларация ровно под то, что реально используется
 * (`document-import.ts`, `extractRawText({buffer})`) — не полный API.
 */
declare module "mammoth" {
  export interface RawTextResult {
    value: string;
    messages: unknown[];
  }
  export function extractRawText(input: { buffer: Buffer }): Promise<RawTextResult>;
}
