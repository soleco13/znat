import type { FastifyInstance } from "fastify";
import {
  createUserRequestSchema,
  updateUserRequestSchema,
  listUsersQuerySchema,
  createGroupRequestSchema,
  addGroupMembersRequestSchema,
} from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import * as usersService from "./service.js";

export default async function usersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", app.requireRole("admin"));

  app.get("/users", async (request, reply) => {
    const query = listUsersQuerySchema.parse(request.query);
    const { rows, total } = await usersService.listUsers(request.user.schoolId, query);
    return reply.send({ items: rows, total, page: query.page, pageSize: query.pageSize });
  });

  app.post("/users", async (request, reply) => {
    const body = createUserRequestSchema.parse(request.body);
    const user = await usersService.createUser(request.user.schoolId, body);
    return reply.status(201).send(user);
  });

  app.patch<{ Params: { id: string } }>("/users/:id", async (request, reply) => {
    const body = updateUserRequestSchema.parse(request.body);
    const user = await usersService.updateUser(request.user.schoolId, request.params.id, body);
    return reply.send(user);
  });

  app.post("/users/import", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      throw new AppError(400, "no_file", "CSV-файл не передан");
    }
    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(chunk as Buffer);
    }
    const content = Buffer.concat(chunks).toString("utf-8");
    const result = await usersService.importUsersFromCsv(request.user.schoolId, content);
    return reply.send(result);
  });

  app.get("/groups", async (request, reply) => {
    const rows = await usersService.listGroups(request.user.schoolId);
    return reply.send({ items: rows });
  });

  app.post("/groups", async (request, reply) => {
    const body = createGroupRequestSchema.parse(request.body);
    const group = await usersService.createGroup(request.user.schoolId, body);
    return reply.status(201).send(group);
  });

  app.post<{ Params: { id: string } }>("/groups/:id/members", async (request, reply) => {
    const body = addGroupMembersRequestSchema.parse(request.body);
    await usersService.addGroupMembers(request.user.schoolId, request.params.id, body.userIds);
    return reply.status(204).send();
  });
}
