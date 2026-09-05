import { describe, expect, it } from "vitest";
import { splitIntoQuestionChunks } from "./import.js";

describe("splitIntoQuestionChunks (Э9.11, §7 ТЗ: полуавтоматический импорт — только границы вопросов)", () => {
  it("делит текст по нумерованным строкам «N.»", () => {
    const text = "1. Столица Франции?\nа) Париж\nб) Лондон\n2. 2+2=?\nа) 3\nб) 4";
    expect(splitIntoQuestionChunks(text)).toEqual([
      "1. Столица Франции?\nа) Париж\nб) Лондон",
      "2. 2+2=?\nа) 3\nб) 4",
    ]);
  });

  it("понимает и «N)», не только «N.»", () => {
    const text = "1) Первый\n2) Второй";
    expect(splitIntoQuestionChunks(text)).toEqual(["1) Первый", "2) Второй"]);
  });

  it("текст ДО первой нумерованной строки — отдельный блок, не склеен с первым вопросом", () => {
    const text = "Инструкция для ученика.\n1. Вопрос 1\n2. Вопрос 2";
    expect(splitIntoQuestionChunks(text)).toEqual(["Инструкция для ученика.", "1. Вопрос 1", "2. Вопрос 2"]);
  });

  it("без единой нумерованной строки — весь текст одним блоком (деградация, не ошибка и не пустой список)", () => {
    const text = "Просто текст без списка вопросов.\nВторая строка.";
    expect(splitIntoQuestionChunks(text)).toEqual(["Просто текст без списка вопросов.\nВторая строка."]);
  });

  it("пустой текст — пустой список, не один пустой блок", () => {
    expect(splitIntoQuestionChunks("")).toEqual([]);
    expect(splitIntoQuestionChunks("   \n  \n")).toEqual([]);
  });

  it("CRLF-переводы строк (Word/Windows) нормализуются перед разбором", () => {
    const text = "1. Первый\r\n2. Второй\r\n";
    expect(splitIntoQuestionChunks(text)).toEqual(["1. Первый", "2. Второй"]);
  });

  it("число БЕЗ пробела после точки/скобки — не считается началом вопроса (не ложное срабатывание на «1.5» внутри текста)", () => {
    const text = "Ответ: 1.5\nдалее текст без вопросов";
    expect(splitIntoQuestionChunks(text)).toEqual(["Ответ: 1.5\nдалее текст без вопросов"]);
  });

  it("пропуски в нумерации источника (1, 3, 7 — без 2/4/5/6) сохраняются как есть, не перенумеровываются", () => {
    const text = "1. Первый\n3. Третий\n7. Седьмой";
    expect(splitIntoQuestionChunks(text)).toEqual(["1. Первый", "3. Третий", "7. Седьмой"]);
  });

  it("хвостовые пустые строки внутри блока обрезаются (trim), но не пропадает содержимое", () => {
    const text = "1. Вопрос с пустыми строками\n\n\n2. Следующий";
    expect(splitIntoQuestionChunks(text)).toEqual(["1. Вопрос с пустыми строками", "2. Следующий"]);
  });
});
