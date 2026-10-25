import type { FastifyInstance } from "fastify";
import {
  billingStateSchema,
  checkoutRequestSchema,
  checkoutResponseSchema,
  plategaCallbackSchema,
  subscribeRequestSchema,
  testPaymentCompleteSchema,
  testPaymentInfoSchema,
} from "@school/shared";
import { z } from "zod";
import { AppError } from "../../plugins/errors.js";
import * as service from "./service.js";
import { isAuthenticCallback } from "./platega.js";
import * as usersService from "../users/service.js";

/** Тарифы и оплата: страница «Тариф» (администратор пространства) и callback Platega. */
export default async function billingRoutes(app: FastifyInstance) {
  // Callback без входа. Ключи X-MerchantId/X-Secret: если пришли — должны
  // совпасть; без них принимаем только смену статуса подписки (её Platega
  // может прислать без ключей, а статус мы всё равно берём из API Platega).
  app.post("/billing/platega/callback", async (request, reply) => {
    const merchant = request.headers["x-merchantid"];
    const secret = request.headers["x-secret"];
    const sentKeys = merchant !== undefined || secret !== undefined;
    const authenticated = isAuthenticCallback(merchant, secret);
    if (sentKeys && !authenticated) throw new AppError(401, "unauthorized", "Неверная подпись callback");
    const raw = (request.body ?? {}) as Record<string, unknown>;
    // Platega присылает поля то как `id`, то как `Id`.
    const body = plategaCallbackSchema.parse(
      Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.charAt(0).toLowerCase() + k.slice(1), v])),
    );
    await service.handleCallback(body, authenticated);
    return reply.send({ ok: true });
  });

  // Тариф и оплата — только администратор пространства (репетитор в своём
  // кабинете или админ школы); учителя и методисты школы о тарифе не знают.
  await app.register(async (staff) => {
    staff.addHook("preHandler", staff.authenticate);
    staff.addHook("preHandler", staff.requireRole("admin"));

    staff.get("/billing", async (request, reply) => {
      return reply.send(billingStateSchema.parse(await service.getState(request.user)));
    });

    staff.get("/billing/test/info", async (request, reply) => {
      const q = z.object({ kind: z.enum(["payment", "subscription"]), id: z.string().uuid() }).parse(request.query);
      return reply.send(testPaymentInfoSchema.parse(await service.testInfo(request.user, q.kind, q.id)));
    });

    staff.post("/billing/test/complete", async (request, reply) => {
      await service.testComplete(request.user, testPaymentCompleteSchema.parse(request.body));
      return reply.send(billingStateSchema.parse(await service.getState(request.user)));
    });

    staff.post("/billing/subscribe", async (request, reply) => {
      const body = subscribeRequestSchema.parse(request.body);
      return reply.send(checkoutResponseSchema.parse(await service.subscribe(request.user, body)));
    });

    staff.post("/billing/subscription/cancel", async (request, reply) => {
      await service.cancelAutopay(request.user);
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
