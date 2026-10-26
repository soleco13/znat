import { z } from "zod";

import type { SchoolKind } from "./schools.js";

/**
 * Контакты поддержки (решение владельца 2026-10-26, подключение Platega).
 *
 * Школам и организациям — почта и Telegram; репетиторам с личным кабинетом
 * (`individual`) — только Telegram. Юридические обращения (персональные данные,
 * претензии, заявления правообладателей) идут на почту по тексту документов
 * сайта — это не поддержка по работе сервиса.
 */
export const SUPPORT_EMAIL = "support@matis-edu.ru";
export const SUPPORT_TELEGRAM = "@matis_manager";
export const SUPPORT_TELEGRAM_URL = "https://t.me/matis_manager";

export const supportContactsSchema = z.object({
  /** Почта поддержки; `null` — у личного кабинета репетитора её нет, только Telegram. */
  email: z.string().nullable(),
  telegram: z.string(),
  telegramUrl: z.string().url(),
});
export type SupportContacts = z.infer<typeof supportContactsSchema>;

/**
 * Контакты по виду пространства. Пока вид неизвестен (список пространств ещё
 * не загрузился), почту не показываем: лишнее лучше добавить, чем убрать.
 */
export function supportContactsFor(kind: SchoolKind | string | null | undefined, email: string = SUPPORT_EMAIL): SupportContacts {
  const org = kind === "organization" || kind === "platform";
  return { email: org ? email : null, telegram: SUPPORT_TELEGRAM, telegramUrl: SUPPORT_TELEGRAM_URL };
}
