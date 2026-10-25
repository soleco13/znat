import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, CircleAlert, CircleCheck, Clock } from "lucide-react";
import { BILLING_PLANS, YEAR_MONTHS_CHARGED, type BillingPeriod, type BillingPlanId } from "@school/shared";

import { cn } from "@/lib/utils";
import { ApiError } from "@/shared/api-client";
import { useAsync } from "@/shared/hooks/use-async";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { ErrorState } from "@/shared/ui/error-state";
import { PageHeader } from "@/shared/ui/page-header";
import { Skeleton } from "@/shared/ui/skeleton";
import { getBillingState, startCheckout } from "./billing-api.js";

/**
 * Тариф и оплата (Platega, 2026-10-25). Путь покупки: тариф → цена →
 * «Оплатить» → платёжная форма Platega → возврат сюда (`?payment=<id>`),
 * пока callback не подтвердит платёж, страница опрашивает статус. Пока
 * ключей Platega нет, кнопка кликается и показывает заглушку (требование
 * платёжной системы к пути покупки).
 */
const rub = new Intl.NumberFormat("ru-RU");
const dateIntl = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
/** «25 ноября 2026 г.» без переноса «г.» на отдельную строку. */
const dateFmt = { format: (d: Date) => dateIntl.format(d).replace(/ г\.$/, "\u00a0г.") };

const amountFor = (monthly: number, period: BillingPeriod) => (period === "year" ? monthly * YEAR_MONTHS_CHARGED : monthly);

export function BillingPage() {
  const [params, setParams] = useSearchParams();
  const returnedPayment = params.get("payment");
  const returnedFailed = params.get("failed") === "1";
  const state = useAsync(getBillingState, []);
  // С лендинга приходят `?plan=…&period=…` — сохраняем выбранный период.
  const [period, setPeriod] = useState<BillingPeriod>(() => (params.get("period") === "year" ? "year" : "month"));
  const [busy, setBusy] = useState<BillingPlanId | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // После возврата с платёжной формы ждём callback: опрос раз в 3 с, до минуты.
  const last = state.data?.lastPayment;
  const waiting = Boolean(returnedPayment && !returnedFailed && last?.id === returnedPayment && last.status === "pending");
  useEffect(() => {
    if (!waiting) return;
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      state.reload();
      if (n >= 20) clearInterval(t);
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  const pay = async (plan: BillingPlanId) => {
    setError(null);
    setUnavailable(false);
    setBusy(plan);
    try {
      const { url } = await startCheckout({ plan, period });
      window.location.assign(url);
    } catch (e) {
      if (e instanceof ApiError && e.code === "payments_unavailable") setUnavailable(true);
      else setError(e instanceof Error ? e.message : "Не удалось начать оплату");
      setBusy(null);
    }
  };

  if (state.error) return <ErrorState description={state.error} onRetry={state.reload} />;

  const s = state.data;
  const support = s?.supportEmail ?? "support@matis-edu.ru";
  const paidUntil = s?.paidUntil ? new Date(s.paidUntil) : null;
  const active = paidUntil && paidUntil.getTime() > Date.now();
  const currentPlan = BILLING_PLANS.find((p) => p.id === s?.plan);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Тариф и оплата" subtitle="Оплата разовая, на месяц или на год, без автопродления." />

      {returnedPayment ? (
        <ReturnBanner
          failed={returnedFailed || last?.status === "canceled"}
          confirmed={last?.id === returnedPayment && last.status === "confirmed"}
          waiting={waiting}
          support={support}
          onClose={() => setParams({}, { replace: true })}
        />
      ) : null}

      {state.loading ? (
        <Skeleton className="mb-6 h-16 w-full rounded-lg" />
      ) : (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <p className="text-sm text-muted-foreground">Текущий тариф</p>
            <p className="font-semibold text-foreground">
              {active && currentPlan
                ? `«${currentPlan.name}», оплачено до ${dateFmt.format(paidUntil)}`
                : paidUntil && currentPlan
                  ? `«${currentPlan.name}», оплата закончилась ${dateFmt.format(paidUntil)}`
                  : "Пробный период, тариф ещё не оплачен"}
            </p>
          </div>
          <PeriodSwitch value={period} onChange={setPeriod} />
        </Card>
      )}

      {unavailable ? (
        <Alert className="mb-6" role="status">
          <Clock aria-hidden />
          <AlertTitle>Оплата пока недоступна</AlertTitle>
          <AlertDescription>
            Мы подключаем платёжную систему. Напишите на{" "}
            <a className="font-medium text-primary hover:underline" href={`mailto:${support}`}>
              {support}
            </a>
            , и мы включим тариф вручную.
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive" className="mb-6" role="alert">
          <CircleAlert aria-hidden />
          <AlertTitle>Не удалось начать оплату</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {BILLING_PLANS.map((p) => {
          const amount = amountFor(p.monthlyRub, period);
          const isCurrent = active && s?.plan === p.id;
          return (
            <Card key={p.id} className={cn("flex flex-col p-6", isCurrent && "border-primary")}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-xl font-bold tracking-[-.02em] text-foreground">{p.name}</h2>
                {isCurrent ? <span className="text-xs font-medium text-primary">Ваш тариф</span> : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{p.tagline}</p>
              <p className="mt-5 flex items-baseline gap-1.5">
                <span className="text-[34px] font-black leading-none tracking-[-.03em] text-foreground tabular-nums">
                  {rub.format(amount)} ₽
                </span>
                <span className="text-sm text-muted-foreground">{period === "year" ? "за 12 месяцев" : "в месяц"}</span>
              </p>
              <p className="mt-1 h-5 text-xs text-muted-foreground">
                {period === "year" ? `${rub.format(Math.round(amount / 12))} ₽ в месяц, 2 месяца в подарок` : ""}
              </p>
              <ul className="mt-5 flex-1 space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-sm text-foreground">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
              <Button className="mt-6 w-full" size="lg" loading={busy === p.id} disabled={busy !== null} onClick={() => void pay(p.id)}>
                {isCurrent ? "Продлить" : "Оплатить"} {rub.format(amount)} ₽
              </Button>
            </Card>
          );
        })}
      </div>

      <Card className="mt-4 flex flex-wrap items-center justify-between gap-3 px-6 py-5">
        <div>
          <h2 className="font-bold text-foreground">Сеть</h2>
          <p className="text-sm text-muted-foreground">Несколько школ, свой сервер и домен. Цена по договорённости.</p>
        </div>
        <Button variant="secondary" asChild>
          <a href={`mailto:${support}?subject=${encodeURIComponent("Тариф «Сеть»")}`}>Обсудить внедрение</a>
        </Button>
      </Card>

      <p className="mt-6 text-sm text-muted-foreground [text-wrap:pretty]">
        После оплаты тариф включается сразу, чек приходит на почту. Деньги за неиспользованные дни можно вернуть по
        заявлению на <a className="font-medium text-primary hover:underline" href={`mailto:${support}`}>{support}</a>.
        Условия — в{" "}
        <Link to="/terms" className="font-medium text-primary hover:underline">
          пользовательском соглашении
        </Link>
        .
      </p>
    </div>
  );
}

function PeriodSwitch({ value, onChange }: { value: BillingPeriod; onChange: (v: BillingPeriod) => void }) {
  const opt = (v: BillingPeriod, label: string) => (
    <button
      type="button"
      aria-pressed={value === v}
      onClick={() => onChange(v)}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        value === v ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Период оплаты" className="inline-flex rounded-lg bg-muted p-1">
      {opt("month", "Месяц")}
      {opt("year", "Год −17%")}
    </div>
  );
}

function ReturnBanner({
  failed,
  confirmed,
  waiting,
  support,
  onClose,
}: {
  failed: boolean;
  confirmed: boolean;
  waiting: boolean;
  support: string;
  onClose: () => void;
}) {
  if (failed) {
    return (
      <Alert variant="destructive" className="mb-6" role="alert">
        <CircleAlert aria-hidden />
        <AlertTitle>Оплата не прошла</AlertTitle>
        <AlertDescription>
          Деньги не списаны. Попробуйте ещё раз или напишите на {support}.{" "}
          <button type="button" className="font-medium underline" onClick={onClose}>
            Скрыть
          </button>
        </AlertDescription>
      </Alert>
    );
  }
  if (confirmed) {
    return (
      <Alert className="mb-6" role="status">
        <CircleCheck aria-hidden />
        <AlertTitle>Оплата прошла, тариф включён</AlertTitle>
        <AlertDescription>Чек придёт на почту.</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert className="mb-6" role="status">
      <Clock aria-hidden />
      <AlertTitle>{waiting ? "Проверяем оплату…" : "Платёж обрабатывается"}</AlertTitle>
      <AlertDescription>
        Обычно это занимает до минуты. Если тариф не включится, напишите на {support}.
      </AlertDescription>
    </Alert>
  );
}
