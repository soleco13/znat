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
import { PageHeader } from "@/shared/ui/page-header";
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
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Тариф" />

      {s?.testMode ? (
        <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
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
        <Alert className="mb-4" role="status">
          <Clock aria-hidden />
          <AlertTitle>Оплата пока недоступна</AlertTitle>
          <AlertDescription>
            Напишите нам: <SupportLinks contacts={support} />, и мы включим тариф вручную.
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive" className="mb-4" role="alert">
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
        <Skeleton className="h-[320px] w-full rounded-[28px]" />
      )}

      {s ? <PaymentHistory items={s.payments} /> : null}

      <p className="mt-8 text-sm text-muted-foreground [text-wrap:pretty]">
        Вопросы по оплате и возврат — <SupportLinks contacts={support} />. Условия — в{" "}
        <Link to="/terms" className="font-medium text-primary hover:underline">
          пользовательском соглашении
        </Link>
        .
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

/** Главная плашка: тариф, срок, продление, автопродление. Справа — объёмный знак «Матис». */
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
  const l = s.limits;
  const rec = l.recordingHoursPerMonth;

  const status = active
    ? { label: "Активен", dot: "bg-emerald-400" }
    : expired
      ? { label: "Закончился", dot: "bg-amber-400" }
      : { label: "Бесплатный тариф", dot: "bg-white/60" };
  const title = plan && (active || expired) ? plan.name : "Старт";
  const term = active ? `Оплачен до ${dateFmt(paidUntil!)}` : expired ? `Закончился ${dateFmt(paidUntil!)}` : "Бесплатно, без срока";
  const facts = [
    l.studentsPerLesson === null ? "Ученики без ограничения" : `До ${l.studentsPerLesson} учеников в уроке`,
    rec === 0 ? "Без записи уроков" : rec === null ? "Запись без ограничения" : `Запись: ${hours(s.usage.recordingHoursThisMonth)} из ${rec} ч в этом месяце`,
  ];
  const month = amountFor(OFFER.monthlyRub, "month");
  const year = amountFor(OFFER.monthlyRub, "year");

  return (
    <section
      aria-labelledby="plan-title"
      // Свечение — фон самой плашки, а не отдельный слой поверх: текст лежит на сплошном тёмном фоне.
      style={{
        backgroundImage:
          "radial-gradient(55% 75% at 88% 35%, rgba(59,108,246,0.55), transparent 70%), radial-gradient(45% 60% at 100% 100%, rgba(124,58,237,0.38), transparent 72%), radial-gradient(40% 55% at 0% 0%, rgba(29,78,216,0.22), transparent 70%)",
      }}
      className="relative overflow-hidden rounded-[28px] bg-[#070b1f] p-6 text-white sm:p-8 md:px-12 md:py-12"
    >
      <div className="grid items-center gap-y-2 md:grid-cols-[minmax(0,1fr)_minmax(0,300px)] md:gap-x-8">
        <MarkScene className="order-first mx-auto -mb-1 w-[112px] md:order-last md:-my-6 md:mx-0 md:w-full md:max-w-[300px] md:justify-self-end" />

        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[13px] font-medium text-white/85 ring-1 ring-inset ring-white/15">
            <span className={cn("size-2 rounded-full", status.dot)} aria-hidden />
            {status.label}
          </p>
          <h2 id="plan-title" className="mt-4 text-[40px] font-black leading-none tracking-[-0.035em] sm:text-[52px]">
            {title}
          </h2>
          <p className="mt-3 text-lg font-semibold text-white/90 sm:text-xl">{term}</p>
          <p className="mt-2 text-sm text-white/60">{facts.join(" · ")}</p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <Button
              size="lg"
              className="h-12 w-full rounded-xl bg-[#3b6cf6] px-6 text-[15px] text-white shadow-none hover:bg-[#2f5ce6] sm:w-auto"
              loading={busy === "month"}
              disabled={busy !== null}
              onClick={() => onPay("month")}
            >
              {active || expired ? `Продлить на месяц — ${rub.format(month)} ₽` : `Подключить за ${rub.format(month)} ₽ в месяц`}
            </Button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => onPay("year")}
              className="group min-h-11 text-left text-sm disabled:opacity-50"
            >
              <span className="block font-semibold text-white/85 underline-offset-4 group-hover:text-white group-hover:underline">
                {busy === "year" ? "Открываем оплату…" : `За год — ${rub.format(year)}\u00a0₽, выгоднее на\u00a017%`}
              </span>
            </button>
          </div>
          {!active && !expired ? (
            <p className="mt-3 text-sm text-white/60">
              «{OFFER.name}»: до {OFFER.limits.studentsPerLesson} учеников, запись уроков, библиотека Матиса.
            </p>
          ) : null}

          <AutopayLine sub={s.subscription} canEnable={s.paymentsEnabled} onEnable={onAutopay} onCancel={onCancelAutopay} />
        </div>
      </div>
    </section>
  );
}

function AutopayLine({
  sub,
  canEnable,
  onEnable,
  onCancel,
}: {
  sub: BillingState["subscription"];
  canEnable: boolean;
  onEnable: () => void;
  onCancel: () => void;
}) {
  const link = "inline-flex min-h-11 items-center font-medium text-white underline-offset-4 hover:underline";
  let content: ReactNode;
  if (sub?.status === "active") {
    content = (
      <>
        {sub.nextChargeAt ? `Автосписание ${dateFmt(new Date(sub.nextChargeAt))}` : "Автопродление включено"} ·{" "}
        <button type="button" className={link} onClick={onCancel}>
          Отключить
        </button>
      </>
    );
  } else if (sub?.status === "pending") {
    content = (
      <>
        Автопродление: ждём подтверждения в приложении банка ·{" "}
        <button type="button" className={link} onClick={onCancel}>
          Отменить
        </button>
      </>
    );
  } else if (canEnable) {
    content = (
      <>
        {sub?.status === "past_due" ? "Последнее автосписание не прошло · " : "Автопродление выключено · "}
        <button type="button" className={link} onClick={onEnable}>
          Включить через СБП
        </button>
      </>
    );
  } else return null;
  return <p className="mt-6 border-t border-white/10 pt-2 text-sm text-white/65">{content}</p>;
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

const hoursIntl = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const hours = (h: number) => hoursIntl.format(h);

const STATUS: Record<BillingState["payments"][number]["status"], { label: string; className: string }> = {
  confirmed: { label: "Оплачено", className: "bg-emerald-50 text-emerald-700" },
  pending: { label: "Обрабатывается", className: "bg-amber-50 text-amber-700" },
  chargebacked: { label: "Возврат", className: "bg-red-50 text-red-700" },
};
const SOURCE_LABEL: Record<BillingState["payments"][number]["source"], string> = {
  once: "разовая оплата",
  autopay: "автопродление",
  manual: "подключено командой Матиса",
};

/** История платежей: дата, тариф и срок, сумма, статус. Брошенные попытки оплаты сервер не отдаёт. */
function PaymentHistory({ items }: { items: BillingState["payments"] }) {
  return (
    <section aria-labelledby="payments-title" className="mt-12">
      <h2 id="payments-title" className="mb-4 text-xl font-bold tracking-[-.02em] text-foreground">
        История платежей
      </h2>
      {items.length === 0 ? (
        <p className="rounded-[20px] border border-border bg-card px-6 py-8 text-center text-sm text-muted-foreground">Платежей пока нет.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card">
          {items.map((p) => {
            const plan = BILLING_PLANS.find((x) => x.id === p.plan);
            const st = STATUS[p.status];
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-4">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-foreground">
                    «{plan?.name ?? p.plan}» на {p.period === "year" ? "год" : "месяц"}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {dateFmt(new Date(p.date))} · {SOURCE_LABEL[p.source]}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[15px] font-semibold tabular-nums text-foreground">
                    {p.source === "manual" ? "—" : `${rub.format(p.amountRub)} ₽`}
                  </span>
                  <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", st.className)}>{st.label}</span>
                </div>
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
      <Alert variant="destructive" className="mb-4" role="alert">
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
      <Alert className="mb-4" role="status">
        <CircleCheck aria-hidden />
        <AlertTitle>Оплата прошла, тариф включён</AlertTitle>
        <AlertDescription>Письмо с подтверждением и чек придут на почту.</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert className="mb-4" role="status">
      <Clock aria-hidden />
      <AlertTitle>{waiting ? "Проверяем оплату…" : "Платёж обрабатывается"}</AlertTitle>
      <AlertDescription>Обычно это занимает до минуты. Если тариф не включится, напишите в поддержку: {support}.</AlertDescription>
    </Alert>
  );
}
