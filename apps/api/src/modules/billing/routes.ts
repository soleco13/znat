import type { FastifyInstance } from "fastify";
import { billingStateSchema, checkoutRequestSchema, checkoutResponseSchema, plategaCallbackSchema } from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import * as service from "./service.js";
import { isAuthenticCallback } from "./platega.js";
import * as usersService from "../users/service.js";

/** Тарифы и оплата: страница «Тариф» (любой сотрудник школы) и callback Platega. */
export default async function billingRoutes(app: FastifyInstance) {
  // Callback без входа: подлинность — по заголовкам X-MerchantId/X-Secret.
  app.post("/billing/platega/callback", async (request, reply) => {
    if (!isAuthenticCallback(request.headers["x-merchantid"], request.headers["x-secret"])) {
      throw new AppError(401, "unauthorized", "Неверная подпись callback");
    }
    const body = plategaCallbackSchema.parse(request.body);
    await service.handleCallback(body);
    return reply.send({ ok: true });
  });

  await app.register(async (staff) => {
    staff.addHook("preHandler", staff.authenticate);

    staff.get("/billing", async (request, reply) => {
      return reply.send(billingStateSchema.parse(await service.getState(request.user)));
    });

    staff.post("/billing/checkout", async (request, reply) => {
      const body = checkoutRequestSchema.parse(request.body);
      const me = await usersService.getUserForAuth(request.user.schoolId, request.user.sub);
      if (!me) throw new AppError(401, "unauthorized", "Войдите заново");
      return reply.send(checkoutResponseSchema.parse(await service.checkout(request.user, me.email, body)));
    });
  });
}
