import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { CircleAlert, CircleCheck, Clock } from "lucide-react";
import { BILLING_PLANS, PUBLIC_BILLING_PLANS, YEAR_MONTHS_CHARGED, supportContactsFor, type BillingPeriod, type BillingState } from "@school/shared";

import { cn } from "@/lib/utils";
import { ApiError } from "@/shared/api-client";
import { useAsync } from "@/shared/hooks/use-async";
import { MarkScene } from "@/shared/mark3d/MarkScene";
import { SupportLinks } from "@/shared/SupportContacts";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { ErrorState } from "@/shared/ui/error-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { cancelSubscription, getBillingState, startCheckout, startSubscription } from "./billing-api.js";

/**
 * «Тариф» репетитора (решение владельца 2026-11-24): одна плашка — какой тариф
 * и до какого числа, кнопка продления и автопродление; ниже — история
 * платежей. Плашка — в духе сайтов платёжных сервисов (тёмная, со свечением
 * и объёмным знаком «Матис» с лендинга).
 *
 * Путь оплаты прежний: «Продлить» → платёжная форма Platega → возврат сюда
 * (`?payment=<id>`), страница опрашивает статус, пока callback не подтвердит.
 * Автопродление — только с отдельным явным согласием (галочка в окне).
 */
const rub = new Intl.NumberFormat("ru-RU");
const dateIntl = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
/** «24 марта 2027» — без «г.». */
const dateFmt = (d: Date) => dateIntl.format(d).replace(/\s*г\.$/, "");
const amountFor = (monthly: number, period: BillingPeriod) => (period === "year" ? monthly * YEAR_MONTHS_CHARGED : monthly);

/** Тариф, который продаётся репетитору онлайн. */
const OFFER = PUBLIC_BILLING_PLANS[0]!;

export function BillingPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const returnedPayment = params.get("payment");
  const returnedFailed = params.get("failed") === "1";
  const state = useAsync(getBillingState, []);
  const [busy, setBusy] = useState<BillingPeriod | "autopay" | null>(null);
  const [autopayOpen, setAutopayOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
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

  const go = (url: string) => {
    // Тестовая форма — своя страница: переходим без перезагрузки.
    const u = new URL(url, window.location.origin);
    if (u.pathname === "/billing/test-pay") navigate(u.pathname + u.search);
    else window.location.assign(url);
  };

  const fail = (e: unknown, fallback: string) => {
    if (e instanceof ApiError && e.code === "payments_unavailable") setUnavailable(true);
    else setError(e instanceof Error ? e.message : fallback);
    setBusy(null);
  };

  const pay = async (period: BillingPeriod) => {
    setError(null);
    setUnavailable(false);
    setBusy(period);
    try {
      go((await startCheckout({ plan: OFFER.id, period })).url);
    } catch (e) {
      fail(e, "Не удалось начать оплату");
    }
  };

  const subscribe = async (period: BillingPeriod) => {
    setError(null);
    setUnavailable(false);
    setBusy("autopay");
    try {
      go((await startSubscription({ plan: OFFER.id, period, autopayConsent: true })).url);
    } catch (e) {
      setAutopayOpen(false);
      fail(e, "Не удалось включить автопродление");
    }
  };

  const cancelAutopay = async () => {
    setCancelling(true);
    try {
      state.setData(await cancelSubscription());
      setConfirmCancel(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отключить автопродление");
    } finally {
      setCancelling(false);
    }
  };

  // «Тариф» — только у репетитора в личном кабинете; в школе раздела нет (сервер отвечает 403).
  if (state.errorStatus === 403) return <Navigate to="/lessons" replace />;
  if (state.error) return <ErrorState description={state.error} onRetry={state.reload} />;

  const s = state.data;
  const support = s?.support ?? supportContactsFor("individual");
  const paidUntil = s?.paidUntil ? new Date(s.paidUntil) : null;

  return (
    <div className="mx-auto w-full max-w-[880px] pb-16 sm:pt-6">
      <h1 className="font-display text-[30px] font-extrabold leading-[1.1] tracking-[-0.035em] text-foreground">Тариф</h1>

      {s?.testMode ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="size-4" aria-hidden />
          Тестовый режим: оплата проходит на тестовой форме, деньги не списываются.
        </p>
      ) : null}

      {returnedPayment ? (
        <ReturnBanner
          failed={returnedFailed || last?.status === "canceled"}
          confirmed={last?.id === returnedPayment && last.status === "confirmed"}
          waiting={waiting}
          support={<SupportLinks contacts={support} />}
          onClose={() => setParams({}, { replace: true })}
        />
      ) : null}

      {unavailable ? (
        <Alert className="mt-4" role="status">
          <Clock aria-hidden />
          <AlertTitle>Оплата пока недоступна</AlertTitle>
          <AlertDescription>
            Напишите нам: <SupportLinks contacts={support} />, и мы включим тариф вручную.
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive" className="mt-4" role="alert">
          <CircleAlert aria-hidden />
          <AlertTitle>Не получилось</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {s ? (
        <PlanCard
          state={s}
          paidUntil={paidUntil}
          busy={busy}
          onPay={(p) => void pay(p)}
          onAutopay={() => setAutopayOpen(true)}
          onCancelAutopay={() => setConfirmCancel(true)}
        />
      ) : (
        <Skeleton className="mt-7 h-[360px] w-full rounded-[28px]" />
      )}

      {s ? <PaymentHistory items={s.payments} /> : null}

      <p className="mt-6 text-[13px] text-text-3">
        Вопросы по оплате — <SupportLinks contacts={support} />
      </p>

      <AutopayDialog open={autopayOpen} busy={busy === "autopay"} onOpenChange={setAutopayOpen} onSubscribe={(p) => void subscribe(p)} />

      <AlertDialog open={confirmCancel} onOpenChange={(v) => !v && setConfirmCancel(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отключить автопродление?</AlertDialogTitle>
            <AlertDialogDescription>
              Новых списаний не будет. Тариф работает до конца оплаченного срока{paidUntil ? `, до ${dateFmt(paidUntil)}` : ""}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Оставить</AlertDialogCancel>
            <AlertDialogAction onClick={() => void cancelAutopay()} disabled={cancelling}>
              Отключить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Главная плашка (макет владельца «Тариф», 2026-11-24): что за тариф, до
 * какого числа, одна кнопка продления и автопродление строкой. Справа —
 * объёмный знак «Матис» с лендинга.
 */
function PlanCard({
  state: s,
  paidUntil,
  busy,
  onPay,
  onAutopay,
  onCancelAutopay,
}: {
  state: BillingState;
  paidUntil: Date | null;
  busy: BillingPeriod | "autopay" | null;
  onPay: (period: BillingPeriod) => void;
  onAutopay: () => void;
  onCancelAutopay: () => void;
}) {
  const plan = BILLING_PLANS.find((p) => p.id === s.plan);
  const active = Boolean(plan && paidUntil && paidUntil.getTime() > Date.now());
  const expired = Boolean(plan && paidUntil && !active);
  const sub = s.subscription;
  const price = `${rub.format(amountFor(OFFER.monthlyRub, "month"))} ₽`;

  const title = plan && (active || expired) ? plan.name : "Старт";
  const term = active ? `Активен до ${dateFmt(paidUntil!)}` : expired ? `Закончился ${dateFmt(paidUntil!)}` : "Бесплатно, без срока";
  const note =
    sub?.status === "active"
      ? `Продлится автоматически — ${rub.format(sub.amountRub)} ₽ через СБП`
      : sub?.status === "pending"
        ? "Автопродление ждёт подтверждения в приложении банка"
        : sub?.status === "past_due"
          ? "Последнее автосписание не прошло"
          : active
            ? "Автопродление выключено"
            : expired
              ? `Продлите, чтобы снова принимать до ${OFFER.limits.studentsPerLesson} учеников`
              : `До ${s.limits.studentsPerLesson ?? "—"} учеников в уроке. В «${OFFER.name}» — до ${OFFER.limits.studentsPerLesson}, запись и библиотека`;

  const secondary =
    sub?.status === "active" || sub?.status === "pending"
      ? { label: sub.status === "active" ? "Отключить автопродление" : "Отменить автопродление", onClick: onCancelAutopay }
      : s.paymentsEnabled && (active || expired)
        ? { label: "Включить автопродление", onClick: onAutopay }
        : null;

  return (
    <section
      aria-labelledby="plan-title"
      className="relative mt-7 grid min-h-[360px] items-center overflow-hidden rounded-[28px] px-7 pb-10 pt-6 text-white shadow-[0_30px_60px_-24px_rgba(11,18,38,0.45)] sm:px-[52px] sm:py-12 md:grid-cols-[minmax(0,1fr)_300px]"
      style={{ background: "radial-gradient(120% 120% at 85% 40%, #1b3a9a 0%, #0f1d4d 38%, #0b1226 72%)" }}
    >
      <div className="relative order-last flex flex-col md:order-first">
        <span className="text-[13px] font-medium text-white/60">Ваш тариф</span>
        <h2 id="plan-title" className="mt-2.5 font-display text-[44px] font-extrabold leading-none tracking-[-0.045em] sm:text-[52px]">
          {title}
        </h2>
        <p className="mt-[22px] text-[17px] font-medium tracking-[-0.01em]">{term}</p>
        <p className="mt-1 text-sm text-white/60 [text-wrap:pretty]">{note}</p>

        <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3.5">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => onPay("month")}
            className="h-12 rounded-full bg-white px-[26px] text-[15px] font-semibold text-[#0b1226] transition-transform duration-200 hover:-translate-y-px disabled:opacity-60"
          >
            {busy === "month" ? "Открываем оплату…" : active || expired ? `Продлить · ${price}` : `Подключить «${OFFER.name}» · ${price}`}
          </button>
          {secondary ? (
            <button type="button" onClick={secondary.onClick} className="h-12 text-sm font-medium text-white/60 transition-colors hover:text-white">
              {secondary.label}
            </button>
          ) : null}
        </div>
      </div>

      {/* Свечение за знаком и тень на «полу» — как в макете; сам знак — 3D с лендинга. */}
      <div aria-hidden className="relative mx-auto flex size-[200px] items-center justify-center md:size-[300px]">
        <div className="absolute inset-[12%] rounded-full bg-[radial-gradient(circle,rgba(96,165,250,0.55)_0%,transparent_68%)] blur-2xl" />
        <div className="absolute inset-x-[26%] bottom-[6%] h-[18px] rounded-full bg-[radial-gradient(rgba(0,0,0,0.55)_0%,transparent_70%)] blur-md" />
        <MarkScene className="relative w-[88%]" />
      </div>
    </section>
  );
}

/** Включение автопродления: период и отдельное явное согласие на автосписания. */
function AutopayDialog({
  open,
  busy,
  onOpenChange,
  onSubscribe,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (v: boolean) => void;
  onSubscribe: (period: BillingPeriod) => void;
}) {
  const [period, setPeriod] = useState<BillingPeriod>("month");
  const [consent, setConsent] = useState(false);
  useEffect(() => {
    if (open) setConsent(false);
  }, [open]);
  const amount = amountFor(OFFER.monthlyRub, period);
  const opt = (v: BillingPeriod, label: string) => (
    <button
      type="button"
      aria-pressed={period === v}
      onClick={() => setPeriod(v)}
      className={cn(
        "flex-1 rounded-lg border px-4 py-3 text-left text-sm transition-colors",
        period === v ? "border-primary bg-primary-light font-semibold text-foreground" : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Автопродление через СБП</DialogTitle>
          <DialogDescription>Тариф «{OFFER.name}» будет продлеваться сам, списание — в начале каждого периода.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2" role="group" aria-label="Период">
          {opt("month", `Каждый месяц — ${rub.format(amountFor(OFFER.monthlyRub, "month"))} ₽`)}
          {opt("year", `Каждый год — ${rub.format(amountFor(OFFER.monthlyRub, "year"))} ₽`)}
        </div>
        <label className="flex items-start gap-2.5 text-sm text-foreground">
          <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
          <span>
            Согласен на автоматическое списание {rub.format(amount)} ₽ {period === "year" ? "раз в год" : "раз в месяц"} через СБП до отмены.
            Отключить можно в любой момент на этой странице.
          </span>
        </label>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button loading={busy} disabled={!consent || busy} onClick={() => onSubscribe(period)}>
            Подписаться — {rub.format(amount)} ₽
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_NOTE: Partial<Record<BillingState["payments"][number]["status"], string>> = {
  pending: "обрабатывается",
  chargebacked: "возврат",
};

/** История платежей: дата, тариф и срок, сумма. Брошенные попытки оплаты сервер не отдаёт. */
function PaymentHistory({ items }: { items: BillingState["payments"] }) {
  return (
    <section aria-labelledby="payments-title" className="mt-[72px]">
      <h2 id="payments-title" className="mb-2.5 font-display text-[19px] font-extrabold tracking-[-0.025em] text-foreground">
        История платежей
      </h2>
      {items.length === 0 ? (
        <p className="border-b border-border py-5 text-[15px] text-muted-foreground">Платежей пока нет.</p>
      ) : (
        <ul>
          {items.map((p) => {
            const plan = BILLING_PLANS.find((x) => x.id === p.plan);
            const extra = p.source === "manual" ? "подключено командой Матиса" : STATUS_NOTE[p.status];
            return (
              <li
                key={p.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 border-b border-border py-5 sm:grid-cols-[150px_minmax(0,1fr)_auto]"
              >
                <span className="col-start-1 row-start-2 text-sm tabular-nums text-muted-foreground sm:row-start-1">{dateFmt(new Date(p.date))}</span>
                <span className="col-start-1 row-start-1 min-w-0 text-[15px] font-medium text-foreground sm:col-start-2">
                  {plan?.name ?? p.plan}, {p.period === "year" ? "год" : "месяц"}
                  {extra ? <span className="font-normal text-muted-foreground"> · {extra}</span> : null}
                </span>
                <span className="col-start-2 row-span-2 row-start-1 whitespace-nowrap text-right text-[15px] font-semibold tabular-nums text-foreground sm:col-start-3 sm:row-span-1">
                  {p.source === "manual" ? "—" : `${rub.format(p.amountRub)} ₽`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
  support: ReactNode;
  onClose: () => void;
}) {
  if (failed) {
    return (
      <Alert variant="destructive" className="mt-4" role="alert">
        <CircleAlert aria-hidden />
        <AlertTitle>Оплата не прошла</AlertTitle>
        <AlertDescription>
          Деньги не списаны. Попробуйте ещё раз или напишите в поддержку: {support}.{" "}
          <button type="button" className="font-medium underline" onClick={onClose}>
            Скрыть
          </button>
        </AlertDescription>
      </Alert>
    );
  }
  if (confirmed) {
    return (
      <Alert className="mt-4" role="status">
        <CircleCheck aria-hidden />
        <AlertTitle>Оплата прошла, тариф включён</AlertTitle>
        <AlertDescription>Письмо с подтверждением придёт на почту.</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert className="mt-4" role="status">
      <Clock aria-hidden />
      <AlertTitle>{waiting ? "Проверяем оплату…" : "Платёж обрабатывается"}</AlertTitle>
      <AlertDescription>Обычно это занимает до минуты. Если тариф не включится, напишите в поддержку: {support}.</AlertDescription>
    </Alert>
  );
}
