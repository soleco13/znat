import { timingSafeEqual } from "node:crypto";
import { env } from "../../plugins/env.js";
import { AppError } from "../../plugins/errors.js";

/**
 * Клиент Platega (https://docs.platega.io): создание платёжной ссылки и
 * проверка статуса транзакции. Авторизация — заголовки X-MerchantId и
 * X-Secret; те же заголовки Platega присылает в callback.
 */
export function plategaConfigured(): boolean {
  return Boolean(env.PLATEGA_MERCHANT_ID && env.PLATEGA_SECRET);
}

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-MerchantId": env.PLATEGA_MERCHANT_ID ?? "",
    "X-Secret": env.PLATEGA_SECRET ?? "",
  };
}

const base = () => env.PLATEGA_API_URL.replace(/\/+$/, "");

export async function createTransaction(input: {
  amountRub: number;
  description: string;
  returnUrl: string;
  failedUrl: string;
  orderId: string;
  userId: string;
  userName: string;
}): Promise<{ transactionId: string; url: string }> {
  const res = await fetch(`${base()}/v2/transaction/process`, {
    method: "POST",
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      paymentDetails: { amount: input.amountRub, currency: "RUB" },
      description: input.description,
      return: input.returnUrl,
      failedUrl: input.failedUrl,
      payload: input.orderId,
      orderId: input.orderId,
      metadata: { userId: input.userId, userName: input.userName },
    }),
  });
  if (!res.ok) {
    throw new AppError(502, "payment_provider_error", "Платёжная система не ответила — попробуйте ещё раз через минуту");
  }
  const data = (await res.json()) as { transactionId?: string; url?: string };
  if (!data.transactionId || !data.url) {
    throw new AppError(502, "payment_provider_error", "Платёжная система не ответила — попробуйте ещё раз через минуту");
  }
  return { transactionId: data.transactionId, url: data.url };
}

/** Статус транзакции у Platega: перепроверка перед продлением тарифа. */
export async function getTransactionStatus(transactionId: string): Promise<string | null> {
  const res = await fetch(`${base()}/transaction/${encodeURIComponent(transactionId)}`, {
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { status?: string };
  return data.status ?? null;
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Callback пришёл от Platega: заголовки совпадают с нашими ключами. */
export function isAuthenticCallback(merchantId: unknown, secret: unknown): boolean {
  if (!plategaConfigured() || typeof merchantId !== "string" || typeof secret !== "string") return false;
  return same(merchantId, env.PLATEGA_MERCHANT_ID!) && same(secret, env.PLATEGA_SECRET!);
}
