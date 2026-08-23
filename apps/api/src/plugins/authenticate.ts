import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AccessTokenPayload } from "@school/shared";
import { verifyAccessToken } from "../modules/auth/service.js";
import { AppError } from "./errors.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: AccessTokenPayload;
  }
}

export default fp(async function authenticatePlugin(app: FastifyInstance) {
  app.decorate("authenticate", async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError(401, "missing_token", "Отсутствует access-токен");
    }
    const token = header.slice("Bearer ".length);
    try {
      request.user = await verifyAccessToken(token);
    } catch {
      throw new AppError(401, "invalid_token", "Недействительный или просроченный access-токен");
    }
  });
});
