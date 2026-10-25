import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Role } from "@school/shared";
import { AppError } from "./errors.js";
import { rolesOf } from "./roles.js";

declare module "fastify" {
  interface FastifyInstance {
    requireRole: (...roles: Role[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async function rbacPlugin(app: FastifyInstance) {
  app.decorate("requireRole", (...roles: Role[]) => {
    return async (request: FastifyRequest) => {
      if (!request.user) {
        throw new AppError(401, "missing_token", "Требуется аутентификация");
      }
      // Э15.1: роли — набором в выбранном пространстве (учитель + методист).
      if (!rolesOf(request.user).some((r) => roles.includes(r))) {
        throw new AppError(403, "forbidden", "Недостаточно прав для этого действия");
      }
    };
  });
});
