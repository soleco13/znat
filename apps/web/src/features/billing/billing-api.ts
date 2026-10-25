import type { BillingState, CheckoutRequest, CheckoutResponse } from "@school/shared";
import { apiFetch } from "../../shared/api-client.js";

export function getBillingState(): Promise<BillingState> {
  return apiFetch<BillingState>("/billing");
}

export function startCheckout(body: CheckoutRequest): Promise<CheckoutResponse> {
  return apiFetch<CheckoutResponse>("/billing/checkout", { method: "POST", body: JSON.stringify(body) });
}

export function startSubscription(body: import("@school/shared").SubscribeRequest): Promise<CheckoutResponse> {
  return apiFetch<CheckoutResponse>("/billing/subscribe", { method: "POST", body: JSON.stringify(body) });
}

export function cancelSubscription(): Promise<BillingState> {
  return apiFetch<BillingState>("/billing/subscription/cancel", { method: "POST" });
}
