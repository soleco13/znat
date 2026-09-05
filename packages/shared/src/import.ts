import { z } from "zod";
import { questionBlockSchema } from "./materials.js";

/** Защита от документа-бомбы (тот же принцип, что `MAX_SLIDES` у конвертера презентаций, Э4.3) — очень длинный документ не должен породить материал из тысяч блоков. */
export const IMPORT_MAX_QUESTIONS = 200;

/**
 * Границы вопросов в тексте, распознанном из Word/PDF (Э9.11, §7 ТЗ
 * «полуавтоматический импорт... распознать вопросы, дать поправить
 * руками»). Формат-независимая чистая функция — работает над уже
 * извлечённым текстом, ничего не знает про .docx/.pdf (это дело
 * `document-import.ts` в apps/api, там реальный парсинг файлов).
 *
 * МИНИМАЛЬНАЯ эвристика — осознанный выбор для первой версии, не
 * недоделанная попытка полной: распознаёт ТОЛЬКО ГРАНИЦЫ вопросов по
 * нумерованным строкам («1. …», «2) …»), не пытается угадать тип
 * вопроса, разобрать варианты ответа (а)/б)/1)/2)) или найти в тексте
 * правильный. Причина — не лень, а риск: неверно угаданный «правильный»
 * вариант в авто-распознанных данных тише всего ломает доверие к
 * материалу (никто не проверяет то, что программа уже «нашла сама»).
 * Текст вопроса целиком уходит в `open_answer`-блок как есть — методист
 * вручную меняет тип, разносит варианты и отмечает правильный в уже
 * готовом редакторе (Э9.5/9.6), не начиная с нуля, но и не доверяя
 * добавленное к готовности «под публикацию» на слово.
 *
 * Документ БЕЗ единой распознанной нумерации — НЕ ошибка и не пустой
 * результат: весь текст становится одним блоком (деградация к «нечего
 * было делить», не к «ничего не найдено»). Текст ДО первой пронумерованной
 * строки (заголовок/инструкция) — тоже отдельный блок, не склеивается
 * с первым вопросом: методист сам решает, превращать его в `rich_text`
 * или удалить.
 */
export function splitIntoQuestionChunks(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const startsQuestion = /^\s*\d+[.)]\s+/;

  const chunks: string[] = [];
  let current: string[] = [];

  function flush(): void {
    const joined = current.join("\n").trim();
    if (joined) chunks.push(joined);
    current = [];
  }

  let sawNumbered = false;
  for (const line of lines) {
    if (startsQuestion.test(line)) {
      sawNumbered = true;
      flush();
    }
    current.push(line);
  }
  flush();

  if (!sawNumbered) {
    const whole = text.trim();
    return whole ? [whole] : [];
  }
  return chunks;
}

/** Ответ `POST /materials/import` (Э9.11) — распознанные вопросы как есть, без создания/правки материала: методист добавляет их в СВОЙ открытый в редакторе черновик отдельным действием на клиенте. */
export const importedQuestionsResultSchema = z.object({
  blocks: z.array(questionBlockSchema),
  truncated: z.boolean(),
});
export type ImportedQuestionsResult = z.infer<typeof importedQuestionsResultSchema>;
