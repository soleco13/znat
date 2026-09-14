import type { FastifyInstance } from "fastify";
import { TrackSource, WebhookReceiver } from "livekit-server-sdk";
import { env } from "../../plugins/env.js";
import * as roomsService from "./service.js";
import * as recordingsService from "../recordings/service.js";

/**
 * LiveKit сам зовёт этот эндпоинт (Э2.7, §10.5 ТЗ, https://docs.livekit.io/home/server/webhooks).
 * Не защищён нашим `app.authenticate` (это не пользовательская сессия) —
 * подлинность подтверждается подписанным JWT в заголовке `Authorization`,
 * который проверяет сам `WebhookReceiver` по тому же `LIVEKIT_API_KEY/SECRET`,
 * что и выдача токенов участникам.
 */
const receiver = new WebhookReceiver(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

export default async function livekitWebhookRoutes(app: FastifyInstance) {
  await app.register(async (scope) => {
    // WebhookReceiver сверяет sha256 тела запроса с хэшем внутри JWT — ему
    // нужна сырая POST-строка, а не объект, распарсенный дефолтным JSON-парсером
    // Fastify. LiveKit шлёт вебхуки с Content-Type: application/webhook+json
    // именно чтобы штатные JSON-парсеры фреймворков их не трогали (подтверждено
    // через Context7 по официальной документации). Парсер зарегистрирован в
    // изолированном под-плагине — на остальные роуты приложения не влияет.
    scope.addContentTypeParser("application/webhook+json", { parseAs: "string" }, (_req, body, done) => {
      done(null, body);
    });

    scope.post<{ Body: string }>("/webhooks/livekit", async (request, reply) => {
      let event;
      try {
        event = await receiver.receive(request.body, request.headers.authorization);
      } catch (err) {
        request.log.warn({ err }, "livekit webhook: подпись не подтверждена");
        return reply.status(401).send();
      }

      const roomName = event.room?.name;
      const userId = event.participant?.identity;

      if (event.event === "participant_left" && roomName && userId) {
        await roomsService.handleParticipantLeftWebhook(roomName, userId);
      } else if (event.event === "room_finished" && roomName) {
        await roomsService.handleRoomFinishedWebhook(roomName);
      } else if (event.event === "track_published" && roomName && userId && event.track?.source === TrackSource.SCREEN_SHARE) {
        // Э7.2/Э7.3: приоритет учителю на демонстрацию экрана + автопереход в Лекцию.
        await roomsService.handleScreenShareStartedWebhook(roomName, userId);
      } else if (event.event === "track_unpublished" && roomName && event.track?.source === TrackSource.SCREEN_SHARE) {
        await roomsService.handleScreenShareStoppedWebhook(roomName, userId);
      } else if (
        (event.event === "egress_started" ||
          event.event === "egress_updated" ||
          event.event === "egress_ended") &&
        event.egressInfo
      ) {
        // Э10: статус записи едет от egress ко строке recordings через вебхук.
        await recordingsService.applyEgressWebhook(event.egressInfo);
      }

      return reply.status(200).send();
    });
  });
}
