import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerRoomMessage } from "@school/shared";
import { verifyAccessToken } from "../auth/service.js";
import { roomEvents } from "./events.js";
import * as roomsService from "./service.js";

const PING_INTERVAL_MS = 20_000;

const querySchema = z.object({
  token: z.string().min(1),
  lessonId: z.string().uuid(),
});

export default async function roomsWsRoutes(app: FastifyInstance) {
  app.get("/ws", { websocket: true }, async (socket, request) => {
    const parsedQuery = querySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      socket.close(4000, "invalid_query");
      return;
    }
    const { token, lessonId } = parsedQuery.data;

    let userId: string;
    try {
      const payload = await verifyAccessToken(token);
      userId = payload.sub;
    } catch {
      socket.close(4001, "invalid_token");
      return;
    }

    const self = await roomsService.attachSocket(lessonId, userId);
    if (!self) {
      socket.close(4003, "not_joined");
      return;
    }

    const send = (message: ServerRoomMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    send({ type: "presence", participants: (await roomsService.listParticipantsSnapshot(lessonId)) });

    const onEvent = (message: ServerRoomMessage) => send(message);
    roomEvents.on(lessonId, onEvent);

    const pingTimer = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping();
    }, PING_INTERVAL_MS);

    socket.on("pong", () => {
      void roomsService.touchHeartbeat(lessonId, userId);
    });

    socket.on("close", () => {
      clearInterval(pingTimer);
      roomEvents.off(lessonId, onEvent);
      void roomsService.markDisconnected(lessonId, userId);
    });

    socket.on("error", (err: Error) => {
      request.log.warn({ err, lessonId, userId }, "room ws error");
    });
  });
}
