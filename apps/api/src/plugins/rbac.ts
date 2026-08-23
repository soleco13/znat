import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Role } from "@school/shared";
import { AppError } from "./errors.js";

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
      if (!roles.includes(request.user.role)) {
        throw new AppError(403, "forbidden", "Недостаточно прав для этого действия");
      }
    };
  });
});
