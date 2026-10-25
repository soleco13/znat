import type { FastifyInstance } from "fastify";
import {
  createUserRequestSchema,
  updateUserRequestSchema,
  listUsersQuerySchema,
} from "@school/shared";
import type { Role } from "@school/shared";
import * as billingService from "../billing/service.js";
import * as usersService from "./service.js";

/**
 * Э15.6: каждая новая для участника роль (и все роли при возврате
 * исключённого) должна уместиться в лимит тарифа.
 */
async function assertSeats(schoolId: string, id: string, patch: { role?: Role; roles?: Role[]; isActive?: boolean }) {
  const target = patch.roles ?? (patch.role ? [patch.role] : null);
  if (!target && patch.isActive !== true) return;
  const current = await usersService.getMemberRoles(schoolId, id);
  if (!current) return;
  const restoring = patch.isActive === true && current.removed;
  for (const role of target ?? current.roles) {
    if (restoring || !current.roles.includes(role)) await billingService.assertRoleSeat(schoolId, role);
  }
}

export default async function usersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // Все роуты модуля — администрирование школы, только admin (Э12: учётные
  // записи есть только у персонала, групп/классов учеников больше нет).
  await app.register(async (adminApp) => {
    adminApp.addHook("preHandler", adminApp.requireRole("admin"));

    adminApp.get("/users", async (request, reply) => {
      const query = listUsersQuerySchema.parse(request.query);
      const { rows, total } = await usersService.listUsers(request.user.schoolId, query);
      return reply.send({ items: rows.map(usersService.toUserResponse), total, page: query.page, pageSize: query.pageSize });
    });

    adminApp.post("/users", async (request, reply) => {
      const body = createUserRequestSchema.parse(request.body);
      await billingService.assertRoleSeat(request.user.schoolId, body.role);
      const user = await usersService.createUser(request.user.schoolId, body);
      return reply.status(201).send(usersService.toUserResponse(user));
    });

    adminApp.patch<{ Params: { id: string } }>("/users/:id", async (request, reply) => {
      const body = updateUserRequestSchema.parse(request.body);
      await assertSeats(request.user.schoolId, request.params.id, body);
      const user = await usersService.updateUser(request.user.schoolId, request.params.id, body);
      return reply.send(usersService.toUserResponse(user));
    });

  });
}
