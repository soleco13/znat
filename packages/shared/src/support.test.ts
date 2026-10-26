import { describe, expect, it } from "vitest";

import { SUPPORT_EMAIL, SUPPORT_TELEGRAM, SUPPORT_TELEGRAM_URL, supportContactsFor } from "./support.js";

describe("supportContactsFor", () => {
  it("школе и организации — почта и Telegram", () => {
    for (const kind of ["organization", "platform"] as const) {
      expect(supportContactsFor(kind)).toEqual({ email: SUPPORT_EMAIL, telegram: SUPPORT_TELEGRAM, telegramUrl: SUPPORT_TELEGRAM_URL });
    }
  });

  it("репетитору с личным кабинетом — только Telegram", () => {
    expect(supportContactsFor("individual")).toEqual({ email: null, telegram: "@matis_manager", telegramUrl: "https://t.me/matis_manager" });
  });

  it("вид неизвестен — только Telegram, почту не показываем", () => {
    expect(supportContactsFor(undefined).email).toBeNull();
    expect(supportContactsFor(null).email).toBeNull();
    expect(supportContactsFor("что-то новое").email).toBeNull();
  });

  it("адрес почты можно переопределить настройкой сервера", () => {
    expect(supportContactsFor("organization", "help@example.ru").email).toBe("help@example.ru");
  });
});
