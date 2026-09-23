import type { FastifyRequest } from "fastify";

/** Параметры адреса, которые дают доступ сами по себе: access/recorder-токены WS и подпись ссылок на файлы. */
const SECRET_QUERY_PARAMS = ["token", "recorderToken", "sig"];

/** Токен в `/ws?token=…` иначе целиком оседал в логах при каждом подключении к уроку. */
export function redactUrl(url: string): string {
  const q = url.indexOf("?");
  if (q === -1) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  let changed = false;
  for (const name of SECRET_QUERY_PARAMS) {
    if (params.has(name)) {
      params.set(name, "[redacted]");
      changed = true;
    }
  }
  return changed ? `${url.slice(0, q)}?${params.toString()}` : url;
}

export function serializeRequest(request: FastifyRequest) {
  return {
    method: request.method,
    url: redactUrl(request.url),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}
