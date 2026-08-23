import { z } from "zod";

// Данные для подключения к LiveKit-комнате урока — выдаются вместе с join
// (POST /lessons/:id/join), отдельного эндпоинта нет (§8.1 ТЗ).
export const mediaConnectionSchema = z.object({
  token: z.string(),
  url: z.string(),
});
export type MediaConnection = z.infer<typeof mediaConnectionSchema>;
