import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Check, CircleAlert, CircleCheck, Clock } from "lucide-react";
import { BILLING_PLANS, DEDICATED_PLAN_FROM_RUB, DEDICATED_PLAN_PUBLIC, PUBLIC_BILLING_PLANS, YEAR_MONTHS_CHARGED, supportContactsFor, type BillingPeriod, type BillingPlanId, type BillingState } from "@school/shared";

import { cn } from "@/lib/utils";
import { ApiError } from "@/shared/api-client";
import { useAsync } from "@/shared/hooks/use-async";
import { useAuthStore } from "@/shared/auth-store";
import { SupportLinks } from "@/shared/SupportContacts";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { ErrorState } from "@/shared/ui/error-state";
import { PageHeader } from "@/shared/ui/page-header";
import { Skeleton } from "@/shared/ui/skeleton";
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
import { Checkbox } from "@/shared/ui/checkbox";
import { cancelSubscription, getBillingState, startCheckout, startSubscription } from "./billing-api.js";

/**
 * Тариф и оплата (Platega, 2026-10-25). Два способа: разовая оплата и
 * автопродление через СБП (отдельное согласие на автосписания, отключение
 * здесь же, в один шаг). Путь покупки: тариф → цена →
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
  const navigate = useNavigate();
  const returnedPayment = params.get("payment");
  const returnedFailed = params.get("failed") === "1";
  const state = useAsync(getBillingState, []);
  // Репетитор (учитель личного пространства) — один, без участников: строки про учителей и методистов ему не нужны.
  const isTutor = useAuthStore((st) => st.user?.role) === "teacher";
  // С лендинга приходят `?plan=…&period=…` — сохраняем выбранный период.
  const [period, setPeriod] = useState<BillingPeriod>(() => (params.get("period") === "year" ? "year" : "month"));
  const [busy, setBusy] = useState<BillingPlanId | null>(null);
  const [mode, setMode] = useState<"once" | "autopay">("once");
  const [consent, setConsent] = useState(false);
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

  const pay = async (plan: BillingPlanId) => {
    setError(null);
    setUnavailable(false);
    setBusy(plan);
    try {
      const { url } =
        mode === "autopay"
          ? await startSubscription({ plan, period, autopayConsent: true })
          : await startCheckout({ plan, period });
      // Тестовая форма — своя страница: переходим без перезагрузки и без привязки к домену из настроек.
      const u = new URL(url, window.location.origin);
      if (u.pathname === "/billing/test-pay") navigate(u.pathname + u.search);
      else window.location.assign(url);
    } catch (e) {
      if (e instanceof ApiError && e.code === "payments_unavailable") setUnavailable(true);
      else setError(e instanceof Error ? e.message : "Не удалось начать оплату");
      setBusy(null);
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

  if (state.error) return <ErrorState description={state.error} onRetry={state.reload} />;

  const s = state.data;
  // Пока состояние не пришло — только Telegram: почту репетиторам не показываем (решение владельца 2026-10-26).
  const support = s?.support ?? supportContactsFor("individual");
  const paidUntil = s?.paidUntil ? new Date(s.paidUntil) : null;
  const active = paidUntil && paidUntil.getTime() > Date.now();
  const currentPlan = BILLING_PLANS.find((p) => p.id === s?.plan);
  const sub = s?.subscription ?? null;
  const subPlan = BILLING_PLANS.find((p) => p.id === sub?.plan);
  const autopayOn = sub?.status === "active";

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Тариф и оплата" subtitle="Разовая оплата на месяц или год, или автопродление через СБП." />

      {s?.testMode ? (
        <Alert className="mb-6" role="status">
          <Clock aria-hidden />
          <AlertTitle>Тестовый режим оплаты</AlertTitle>
          <AlertDescription>Платёжная система ещё не подключена: оплата проходит на тестовой форме, деньги не списываются.</AlertDescription>
        </Alert>
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
                  : "Бесплатный минимум — тариф не оплачен"}
            </p>
          </div>
          <PeriodSwitch value={period} onChange={setPeriod} />
        </Card>
      )}

      {s ? <LimitsCard state={s} tutor={isTutor} /> : null}

      {sub && subPlan ? (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <p className="text-sm text-muted-foreground">Автопродление через СБП</p>
            <p className="font-semibold text-foreground">
              {sub.status === "active"
                ? `Включено: ${rub.format(sub.amountRub)} ₽ ${sub.period === "year" ? "раз в год" : "раз в месяц"}${sub.nextChargeAt ? `, следующее списание ${dateFmt.format(new Date(sub.nextChargeAt))}` : ""}`
                : sub.status === "pending"
                  ? "Ждём подтверждения привязки в приложении банка"
                  : "Последнее списание не прошло, автопродление остановлено"}
            </p>
          </div>
          {sub.status !== "past_due" ? (
            <Button variant="secondary" onClick={() => setConfirmCancel(true)}>
              Отключить автопродление
            </Button>
          ) : null}
        </Card>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ModeSwitch value={mode} onChange={setMode} />
        {mode === "autopay" ? (
          <span className="text-sm text-muted-foreground">Только через СБП. Списание в начале каждого периода.</span>
        ) : null}
      </div>
      {mode === "autopay" && !autopayOn ? (
        <label className="mb-6 flex items-start gap-2.5 text-sm text-foreground">
          <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
          <span>
            Согласен на автоматическое списание стоимости выбранного тарифа {period === "year" ? "раз в год" : "раз в месяц"}{" "}
            через СБП до отмены. Отключить автопродление можно в любой момент на этой странице или по ссылке из письма о
            списании.
          </span>
        </label>
      ) : null}

      {unavailable ? (
        <Alert className="mb-6" role="status">
          <Clock aria-hidden />
          <AlertTitle>Оплата пока недоступна</AlertTitle>
          <AlertDescription>
            Мы подключаем платёжную систему. Напишите нам: <SupportLinks contacts={support} />, и мы включим тариф
            вручную.
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* Временно только открытые тарифы: школьные скрыты из-за лимита Platega 19 000 ₽ на платёж (2026-10-28). */}
        {PUBLIC_BILLING_PLANS.map((p) => {
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
              <Button
                className="mt-6 w-full"
                size="lg"
                loading={busy === p.id}
                disabled={busy !== null || (mode === "autopay" && (!consent || autopayOn))}
                onClick={() => void pay(p.id)}
              >
                {mode === "autopay"
                  ? autopayOn
                    ? "Автопродление уже включено"
                    : `Подписаться: ${rub.format(amount)} ₽ ${period === "year" ? "в год" : "в месяц"}`
                  : `${isCurrent ? "Продлить" : "Оплатить"} ${rub.format(amount)} ₽`}
              </Button>
            </Card>
          );
        })}
      </div>

      {/* Школа или организация: тарифы для школ пока подключаем вручную, без онлайн-оплаты. */}
      {support.email ? (
        <Card className="mt-4 px-6 py-5">
          <h2 className="font-bold text-foreground">Тарифы для школ</h2>
          <p className="mt-1 text-sm text-muted-foreground [text-wrap:pretty]">
            Подключаем по запросу: подберём объём под ваше расписание и включим тариф вручную. Напишите нам:{" "}
            <SupportLinks contacts={support} />.
          </p>
        </Card>
      ) : null}

      {DEDICATED_PLAN_PUBLIC ? (
      <Card className="mt-4 flex flex-wrap items-center justify-between gap-3 px-6 py-5">
        <div>
          <h2 className="font-bold text-foreground">Выделенный</h2>
          <p className="text-sm text-muted-foreground">
            Свои серверы для вашей школы, домен и связка с CRM. От {rub.format(DEDICATED_PLAN_FROM_RUB)} ₽ в месяц, по договору.
          </p>
        </div>
        <Button variant="secondary" asChild>
          {support.email ? (
            <a href={`mailto:${support.email}?subject=${encodeURIComponent("Тариф «Выделенный»")}`}>Обсудить внедрение</a>
          ) : (
            <a href={support.telegramUrl} target="_blank" rel="noreferrer">
              Написать в Telegram
            </a>
          )}
        </Button>
      </Card>
      ) : null}

      <p className="mt-6 text-sm text-muted-foreground [text-wrap:pretty]">
        Ученико-час — час, который один ученик провёл на уроке. Если часы тарифа закончились, уроки не прерываются: мы
        напишем и предложим тариф побольше или 1 000 ученико-часов за 3 490 ₽.
      </p>
      <p className="mt-3 text-sm text-muted-foreground [text-wrap:pretty]">
        После оплаты тариф включается сразу, чек приходит на почту. При отключении автопродления оплаченный срок
        сохраняется. Деньги за неиспользованные дни можно вернуть по
        заявлению в поддержку: <SupportLinks contacts={support} />.
        Условия — в{" "}
        <Link to="/terms" className="font-medium text-primary hover:underline">
          пользовательском соглашении
        </Link>
        .
      </p>
      <AlertDialog open={confirmCancel} onOpenChange={(v) => !v && setConfirmCancel(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отключить автопродление?</AlertDialogTitle>
            <AlertDialogDescription>
              Новых списаний не будет. Тариф работает до конца оплаченного срока
              {paidUntil ? `, до ${dateFmt.format(paidUntil)}` : ""}.
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

/** Э15.6: что даёт тариф сейчас (или бесплатный минимум) и сколько занято. */
function LimitsCard({ state, tutor }: { state: BillingState; tutor: boolean }) {
  const { limits: l, usage: u } = state;
  const rec = l.recordingHoursPerMonth;
  // Оранжевым — только то, что упёрлось в лимит и мешает работать.
  const rows: { label: string; value: string; over?: boolean }[] = [
    {
      label: "Аудитории",
      value:
        l.rooms === null
          ? `${u.rooms}, без ограничения`
          : u.rooms > l.rooms
            ? `${u.rooms} из ${l.rooms}: для уроков открыты первые ${l.rooms}`
            : `${u.rooms} из ${l.rooms}`,
      over: l.rooms !== null && u.rooms > l.rooms,
    },
    ...(tutor
      ? []
      : [
          {
            label: "Учителя",
            value: l.teachers === null ? `${u.teachers}, без ограничения` : `${u.teachers} из ${l.teachers}`,
            over: l.teachers !== null && u.teachers > l.teachers,
          },
          {
            label: "Методисты",
            value: l.methodists === null ? `${u.methodists}, без ограничения` : l.methodists === 0 ? "нет в тарифе" : `${u.methodists} из ${l.methodists}`,
          },
        ]),
    { label: "Учеников в уроке", value: l.studentsPerLesson === null ? "без ограничения" : `до ${l.studentsPerLesson}` },
    {
      label: "Запись уроков",
      value: rec === null ? "без ограничения" : rec === 0 ? "нет в тарифе" : `${hoursFmt.format(u.recordingHoursThisMonth)} из ${rec} ч в этом месяце`,
      over: rec !== null && rec > 0 && u.recordingHoursThisMonth >= rec,
    },
    ...(rec === 0 || l.recordingRetentionDays === null
      ? []
      : [{ label: "Хранение записей", value: `${l.recordingRetentionDays} дней` }]),
    { label: "Библиотека Матиса", value: l.matisLibrary ? "есть" : "нет в тарифе" },
  ];
  return (
    <Card className="mb-6 px-5 py-4">
      <h2 className="mb-3 text-sm text-muted-foreground">Что доступно сейчас</h2>
      <dl className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 border-b border-border pb-2 sm:block sm:border-0 sm:pb-0">
            <dt className="text-sm text-muted-foreground">{r.label}</dt>
            <dd className={cn("text-sm font-semibold tabular-nums text-foreground", r.over && "text-warning")}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

const hoursFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

function ModeSwitch({ value, onChange }: { value: "once" | "autopay"; onChange: (v: "once" | "autopay") => void }) {
  const opt = (v: "once" | "autopay", label: string) => (
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
    <div role="group" aria-label="Способ оплаты" className="inline-flex rounded-lg bg-muted p-1">
      {opt("once", "Разовая оплата")}
      {opt("autopay", "Автопродление")}
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
  support: ReactNode;
  onClose: () => void;
}) {
  if (failed) {
    return (
      <Alert variant="destructive" className="mb-6" role="alert">
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
        Обычно это занимает до минуты. Если тариф не включится, напишите в поддержку: {support}.
      </AlertDescription>
    </Alert>
  );
}
