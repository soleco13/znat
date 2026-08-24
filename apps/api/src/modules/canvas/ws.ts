import type { IncomingMessage } from "node:http";
import type { FastifyInstance } from "fastify";
import { hocuspocus } from "./hocuspocus.js";

/**
 * Hocuspocus v4 требует веб-стандартный `Request`, а не Node-шный
 * `IncomingMessage` (проверено чтением RELEASE_NOTES_V4.md и исходников
 * `@hocuspocus/server` — доки Context7 для этого места неполные, см.
 * заметки Э3.1 в docs/CURRENT_STAGE.md). `@fastify/websocket` даёт нам
 * только `request.raw` (`IncomingMessage`), поэтому конвертируем вручную.
 */
function toWebRequest(raw: IncomingMessage): Request {
  const host = raw.headers.host ?? "localhost";
  const url = new URL(raw.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((v) => headers.append(key, v));
    } else {
      headers.set(key, value);
    }
  }
  return new Request(url, { headers });
}

/**
 * Hocuspocus смонтирован в тот же Fastify-сервер на `/collab`, не отдельным
 * процессом (Э3.1, §3.4/§4.1.1 ТЗ). `hocuspocus.handleConnection()` НЕ
 * подписывается на события сокета сама — в отличие от встроенного класса
 * `Server` (который слушает свой отдельный порт, нам не подходит), при
 * ручной интеграции вызывающий код обязан сам прокидывать `message`/`close`
 * в возвращённый `ClientConnection` (см. RELEASE_NOTES_V4.md, раздел
 * "Custom handleConnection Integrations", и `Server.ts` самого пакета как
 * образец для ws-адаптера).
 */
export default async function canvasWsRoutes(app: FastifyInstance) {
  app.get("/collab", { websocket: true }, async (socket, request) => {
    const clientConnection = hocuspocus.handleConnection(socket, toWebRequest(request.raw));

    socket.on("message", (data: Buffer) => {
      clientConnection.handleMessage(data);
    });

    socket.on("close", (code: number, reason: Buffer) => {
      clientConnection.handleClose({ code, reason: reason.toString() });
    });

    socket.on("error", (err: Error) => {
      request.log.warn({ err }, "collab ws error");
    });
  });
}
