import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FlaskConical } from "lucide-react";
import { BILLING_PLANS } from "@school/shared";

import { useAsync } from "@/shared/hooks/use-async";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { ErrorState } from "@/shared/ui/error-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { notify } from "@/shared/ui/notify";
import { completeTestPayment, getTestPayment } from "./billing-api.js";

/**
 * Тестовая платёжная форма (BILLING_TEST_MODE, 2026-10-25): стоит на месте
 * формы Platega, пока ключей нет. «Оплатить» проводит платёж тем же путём,
 * что настоящий callback, — тариф включается, деньги не списываются.
 */
const rub = new Intl.NumberFormat("ru-RU");

export function TestPayPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const kind = params.get("subscription") ? "subscription" : "payment";
  const id = params.get(kind) ?? "";
  const info = useAsync(() => getTestPayment(kind, id), [kind, id]);
  const [busy, setBusy] = useState<"success" | "fail" | null>(null);

  const finish = async (result: "success" | "fail") => {
    setBusy(result);
    try {
      await completeTestPayment({ kind, id, result });
      if (kind === "payment") navigate(`/billing?payment=${id}${result === "fail" ? "&failed=1" : ""}`, { replace: true });
      else {
        notify.success(result === "success" ? "Автопродление включено (тест)" : "Привязка отклонена (тест)");
        navigate("/billing", { replace: true });
      }
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Не удалось провести тестовую оплату");
      setBusy(null);
    }
  };

  if (info.error) return <ErrorState description={info.error} onRetry={info.reload} />;
  const i = info.data;
  const plan = BILLING_PLANS.find((p) => p.id === i?.plan);
  const every = i?.period === "year" ? "раз в год" : "раз в месяц";

  return (
    <div className="mx-auto max-w-md py-6">
      <Alert className="mb-4" role="status">
        <FlaskConical aria-hidden />
        <AlertTitle>Тестовая оплата</AlertTitle>
        <AlertDescription>Платёжная система ещё не подключена. Деньги не списываются, тариф включится как после настоящей оплаты.</AlertDescription>
      </Alert>
      <Card className="p-6">
        {!i ? (
          <Skeleton className="h-40 rounded-lg" />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Матис · {kind === "subscription" ? "подписка через СБП" : "разовая оплата"}</p>
            <h1 className="mt-1 text-xl font-bold tracking-[-.02em] text-foreground">Тариф «{plan?.name ?? i.plan}»</h1>
            <p className="mt-4 text-[34px] font-black leading-none tracking-[-.03em] text-foreground tabular-nums">
              {rub.format(i.amountRub)} ₽
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {kind === "subscription" ? `Списание ${every} до отмены` : i.period === "year" ? "За 12 месяцев" : "За 1 месяц"}
            </p>
            {i.status !== "pending" ? (
              <p className="mt-5 text-sm text-muted-foreground">Этот платёж уже обработан.</p>
            ) : (
              <div className="mt-6 flex flex-col gap-2">
                <Button size="lg" loading={busy === "success"} disabled={busy !== null} onClick={() => void finish("success")}>
                  {kind === "subscription" ? "Подтвердить привязку (тест)" : `Оплатить ${rub.format(i.amountRub)} ₽ (тест)`}
                </Button>
                <Button variant="secondary" size="lg" loading={busy === "fail"} disabled={busy !== null} onClick={() => void finish("fail")}>
                  Отклонить
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
