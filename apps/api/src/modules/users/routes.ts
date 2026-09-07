import type { FastifyInstance } from "fastify";
import {
  createUserRequestSchema,
  updateUserRequestSchema,
  listUsersQuerySchema,
} from "@school/shared";
import * as usersService from "./service.js";

export default async function usersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // Все роуты модуля — администрирование школы, только admin (Э12: учётные
  // записи есть только у персонала, групп/классов учеников больше нет).
  await app.register(async (adminApp) => {
    adminApp.addHook("preHandler", adminApp.requireRole("admin"));

    adminApp.get("/users", async (request, reply) => {
      const query = listUsersQuerySchema.parse(request.query);
      const { rows, total } = await usersService.listUsers(request.user.schoolId, query);
      return reply.send({ items: rows, total, page: query.page, pageSize: query.pageSize });
    });

    adminApp.post("/users", async (request, reply) => {
      const body = createUserRequestSchema.parse(request.body);
      const user = await usersService.createUser(request.user.schoolId, body);
      return reply.status(201).send(user);
    });

    adminApp.patch<{ Params: { id: string } }>("/users/:id", async (request, reply) => {
      const body = updateUserRequestSchema.parse(request.body);
      const user = await usersService.updateUser(request.user.schoolId, request.params.id, body);
      return reply.send(user);
    });

  });
}
