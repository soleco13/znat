import type { FastifyInstance } from "fastify";
import { listMaterialsQuerySchema, materialSummarySchema } from "@school/shared";
import * as materialsService from "./service.js";

/**
 * Библиотека материалов (Э9.1, §7.2/§8 ТЗ). Только admin/methodist/teacher —
 * ученик не листает библиотеку напрямую, материал доходит до него только
 * через выдачу (`activities`, Э8.6). `materialSummarySchema.parse` на выходе
 * — тот же паттерн, что у `GroupResponse` (Э8.11): типизированный ответ API,
 * не сырые строки БД (в частности `createdAt`/`updatedAt` — `Date` → ISO-строка).
 */
export default async function materialsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get(
    "/materials",
    { preHandler: app.requireRole("admin", "methodist", "teacher") },
    async (request, reply) => {
      const query = listMaterialsQuerySchema.parse(request.query);
      const rows = await materialsService.listMaterials(request.user, query);
      const items = rows.map((row) =>
        materialSummarySchema.parse({
          ...row,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }),
      );
      return reply.send({ items });
    },
  );
}
