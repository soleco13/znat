import { Hocuspocus, type onAuthenticatePayload } from "@hocuspocus/server";
import { z } from "zod";
import { AppError } from "../../plugins/errors.js";
import { verifyAccessToken } from "../auth/service.js";
import * as lessonsService from "../lessons/service.js";
import * as usersService from "../users/service.js";

const documentNameSchema = z.string().uuid();

/**
 * Проверяет права на lesson_id при подключении к Yjs-документу холста (Э3.1,
 * §3.4 ТЗ). documentName у Hocuspocus — это lessonId напрямую (`Y.Doc` один
 * на урок, отдельный namespace-префикс не нужен — коллизий имён документов
 * быть не может).
 *
 * Логика прав ролей намеренно ДУБЛИРУЕТ rooms/service.ts#assertMembership, а
 * не переиспользует её: canvas не должен зависеть от rooms (это
 * presence/WS-модуль, а не владелец правил доступа к уроку), а правило
 * модульности CLAUDE.md запрещает модулю тянуть чужой repo.ts — здесь
 * используются только публичные сервисы lessons/users, как и в rooms.
 */
export async function authenticateCanvasConnection(
  payload: Pick<onAuthenticatePayload, "token" | "documentName">,
): Promise<{ userId: string; role: string }> {
  const parsedLessonId = documentNameSchema.safeParse(payload.documentName);
  if (!parsedLessonId.success) {
    throw new AppError(400, "invalid_document", "Некорректный идентификатор урока");
  }
  const lessonId = parsedLessonId.data;

  const user = await verifyAccessToken(payload.token);
  const lesson = await lessonsService.getLesson(user.schoolId, lessonId);

  if (user.role === "admin") {
    return { userId: user.sub, role: user.role };
  }
  if (user.role === "teacher") {
    if (lesson.teacherId !== user.sub) {
      throw new AppError(403, "forbidden", "Вы не ведёте этот урок");
    }
    return { userId: user.sub, role: user.role };
  }
  if (user.role === "student") {
    const isMember = await usersService.isGroupMember(lesson.groupId, user.sub);
    if (!isMember) {
      throw new AppError(403, "forbidden", "Вы не состоите в группе этого урока");
    }
    return { userId: user.sub, role: user.role };
  }
  throw new AppError(403, "forbidden", "Роль не допускается к участию в уроке");
}

/**
 * Единственный экземпляр Hocuspocus на процесс, монтируется в тот же
 * Fastify-сервер на `/collab` (см. canvas/ws.ts), не отдельным процессом —
 * жёсткое требование §3.4/§4.1.1 ТЗ.
 *
 * Персистентность Y.Doc в Postgres (onLoadDocument/onStoreDocument) —
 * Э3.2, здесь намеренно не реализована: до неё документ живёт только в
 * памяти процесса и теряется при рестарте, это ожидаемо для Э3.1.
 */
export const hocuspocus = new Hocuspocus({
  onAuthenticate: authenticateCanvasConnection,
});
