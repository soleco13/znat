import { useEffect, useState } from "react";
import type { BillingPeriod, BillingPlanId, PlatformPayment, PlatformSchool, PlatformSchoolDetail } from "@school/shared";
import { BILLING_PLANS } from "@school/shared";

import { cn } from "@/lib/utils";
import { useAsync } from "@/shared/hooks/use-async";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { ErrorState } from "@/shared/ui/error-state";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui/sheet";
import { Skeleton } from "@/shared/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { notify } from "@/shared/ui/notify";
import { extendSchool, getOverview, getPayments, getSchool, getSchools, getUsers } from "./platform-api.js";

/**
 * «Платформа» — раздел супер-админа (запрос владельца 2026-10-25): обзор,
 * все школы, платежи и пользователи сервиса. Доступ решает сервер
 * (`SUPER_ADMIN_EMAILS`), страница без доступа показывает ошибку 403.
 */
const rub = new Intl.NumberFormat("ru-RU");
const dt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" });
const dtt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const d = (s: string | null) => (s ? dt.format(new Date(s)) : "—");
const planName = (id: string | null) => BILLING_PLANS.find((p) => p.id === id)?.name ?? (id ?? "—");

const KIND: Record<string, string> = { individual: "Репетитор", organization: "Организация", platform: "Служебное" };
const ROLE: Record<string, string> = { admin: "Администратор", methodist: "Методист", teacher: "Учитель" };
const PAY_STATUS: Record<PlatformPayment["status"], { label: string; tone: "default" | "secondary" | "destructive" | "outline" }> = {
  confirmed: { label: "Оплачен", tone: "default" },
  pending: { label: "Ожидает", tone: "secondary" },
  canceled: { label: "Не прошёл", tone: "outline" },
  chargebacked: { label: "Возврат", tone: "destructive" },
};
const SUB_STATUS: Record<string, string> = {
  pending: "ждёт привязки",
  active: "включено",
  past_due: "списание не прошло",
  cancelled: "отключено",
  failed: "не привязалась",
};

function paidLabel(s: PlatformSchool) {
  if (!s.paidUntil) return <span className="text-muted-foreground">не оплачено</span>;
  const active = new Date(s.paidUntil).getTime() > Date.now();
  return (
    <span className={cn(!active && "text-muted-foreground")}>
      {planName(s.billingPlan)}, {active ? "до" : "закончилось"} {d(s.paidUntil)}
    </span>
  );
}

export function PlatformPage() {
  const overview = useAsync(getOverview, []);
  const [schoolId, setSchoolId] = useState<string | null>(null);

  if (overview.error) return <ErrorState description={overview.error} onRetry={overview.reload} />;
  const o = overview.data;
  const stats = o
    ? [
        { label: "Школ", value: rub.format(o.schools) },
        { label: "Пользователей", value: rub.format(o.users) },
        { label: "Оплачено школ", value: rub.format(o.paidSchools) },
        { label: "Подписок с автопродлением", value: rub.format(o.activeSubscriptions) },
        { label: "Выручка за 30 дней", value: `${rub.format(o.revenue30dRub)} ₽`, hint: `${o.payments30d} платежей` },
        { label: "Выручка всего", value: `${rub.format(o.revenueRub)} ₽` },
      ]
    : [];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Платформа" subtitle="Все школы, пользователи и платежи сервиса." />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {overview.loading
          ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[84px] rounded-lg" />)
          : stats.map((s) => (
              <Card key={s.label} className="px-4 py-3.5">
                <p className="text-2xl font-bold tracking-[-.02em] text-foreground tabular-nums">{s.value}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.label}</p>
                {s.hint ? <p className="text-xs text-muted-foreground">{s.hint}</p> : null}
              </Card>
            ))}
      </div>

      <Tabs defaultValue="schools">
        <TabsList>
          <TabsTrigger value="schools">Школы</TabsTrigger>
          <TabsTrigger value="payments">Платежи</TabsTrigger>
          <TabsTrigger value="users">Пользователи</TabsTrigger>
        </TabsList>
        <TabsContent value="schools" className="mt-4">
          <SchoolsTab onOpen={setSchoolId} />
        </TabsContent>
        <TabsContent value="payments" className="mt-4">
          <PaymentsTab />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UsersTab onOpenSchool={setSchoolId} />
        </TabsContent>
      </Tabs>

      <SchoolSheet id={schoolId} onClose={() => setSchoolId(null)} onChanged={overview.reload} />
    </div>
  );
}

function TableCard({ children }: { children: React.ReactNode }) {
  return <Card className="overflow-x-auto p-0">{children}</Card>;
}

function SchoolsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const s = useAsync(getSchools, []);
  if (s.error) return <ErrorState description={s.error} onRetry={s.reload} />;
  if (s.loading) return <Skeleton className="h-64 rounded-lg" />;
  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Школа</TableHead>
            <TableHead>Тип</TableHead>
            <TableHead className="text-right">Польз.</TableHead>
            <TableHead>Тариф</TableHead>
            <TableHead>Автопродление</TableHead>
            <TableHead>Создана</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(s.data ?? []).map((r) => (
            <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r.id)}>
              <TableCell>
                <button type="button" className="text-left font-medium text-foreground hover:underline" onClick={() => onOpen(r.id)}>
                  {r.name}
                </button>
                <div className="text-xs text-muted-foreground">/s/{r.slug}</div>
              </TableCell>
              <TableCell>{KIND[r.kind] ?? r.kind}</TableCell>
              <TableCell className="text-right tabular-nums">{r.users}</TableCell>
              <TableCell>{paidLabel(r)}</TableCell>
              <TableCell>{r.subscriptionStatus ? SUB_STATUS[r.subscriptionStatus] : "—"}</TableCell>
              <TableCell className="whitespace-nowrap">{d(r.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}

function PaymentsTable({ rows, showSchool = true }: { rows: PlatformPayment[]; showSchool?: boolean }) {
  if (!rows.length) return <p className="px-4 py-6 text-sm text-muted-foreground">Платежей пока нет.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Дата</TableHead>
          {showSchool ? <TableHead>Школа</TableHead> : null}
          <TableHead>Плательщик</TableHead>
          <TableHead>Тариф</TableHead>
          <TableHead>Способ</TableHead>
          <TableHead className="text-right">Сумма</TableHead>
          <TableHead>Статус</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="whitespace-nowrap">{dtt.format(new Date(p.createdAt))}</TableCell>
            {showSchool ? <TableCell>{p.schoolName}</TableCell> : null}
            <TableCell className="text-muted-foreground">{p.userEmail ?? "—"}</TableCell>
            <TableCell>
              {planName(p.plan)}, {p.period === "year" ? "год" : "месяц"}
            </TableCell>
            <TableCell>{p.providerTxId === "вручную" ? "вручную" : p.recurring ? "автопродление" : "разовая"}</TableCell>
            <TableCell className="text-right tabular-nums">{rub.format(p.amountRub)} ₽</TableCell>
            <TableCell>
              <Badge variant={PAY_STATUS[p.status].tone}>{PAY_STATUS[p.status].label}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PaymentsTab() {
  const p = useAsync(getPayments, []);
  if (p.error) return <ErrorState description={p.error} onRetry={p.reload} />;
  if (p.loading) return <Skeleton className="h-64 rounded-lg" />;
  return (
    <TableCard>
      <PaymentsTable rows={p.data ?? []} />
    </TableCard>
  );
}

function UsersTab({ onOpenSchool }: { onOpenSchool: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const u = useAsync(() => getUsers(query), [query]);
  return (
    <div className="space-y-3">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск по имени или почте"
        aria-label="Поиск пользователей"
        className="max-w-sm"
      />
      {u.error ? (
        <ErrorState description={u.error} onRetry={u.reload} />
      ) : u.loading ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Пользователь</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead>Школа</TableHead>
                <TableHead>Почта</TableHead>
                <TableHead>Последний вход</TableHead>
                <TableHead>Создан</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(u.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium text-foreground">{r.fullName}</div>
                    <div className="text-xs text-muted-foreground">{r.email}</div>
                  </TableCell>
                  <TableCell>{ROLE[r.role]}{r.isActive ? "" : " · отключён"}</TableCell>
                  <TableCell>
                    <button type="button" className="text-left hover:underline" onClick={() => onOpenSchool(r.schoolId)}>
                      {r.schoolName}
                    </button>
                  </TableCell>
                  <TableCell>{r.emailVerified ? "подтверждена" : <span className="text-muted-foreground">не подтверждена</span>}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.lastLoginAt ? dtt.format(new Date(r.lastLoginAt)) : "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{d(r.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </div>
  );
}

function SchoolSheet({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<PlatformSchoolDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<BillingPlanId>("tutor");
  const [period, setPeriod] = useState<BillingPeriod>("month");
  const [count, setCount] = useState("1");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!id) return;
    getSchool(id).then(setData, (e: unknown) => setError(e instanceof Error ? e.message : "Не удалось загрузить школу"));
  }, [id]);

  const extend = async () => {
    if (!id) return;
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 24) {
      notify.error("Срок — от 1 до 24");
      return;
    }
    setSaving(true);
    try {
      setData(await extendSchool(id, { plan, period, count: n }));
      notify.success("Тариф включён");
      onChanged();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Не удалось включить тариф");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={Boolean(id)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{data?.school.name ?? "Школа"}</SheetTitle>
          <SheetDescription>
            {data ? `${KIND[data.school.kind] ?? data.school.kind}, создана ${d(data.school.createdAt)}, /s/${data.school.slug}` : " "}
          </SheetDescription>
        </SheetHeader>
        {error ? <p className="px-4 text-sm text-destructive">{error}</p> : null}
        {!data && !error ? <Skeleton className="mx-4 h-64 rounded-lg" /> : null}
        {data ? (
          <div className="space-y-6 px-4 pb-8">
            <section>
              <h3 className="mb-2 font-semibold text-foreground">Тариф</h3>
              <p className="text-sm">{paidLabel(data.school)}</p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Select value={plan} onValueChange={(v) => setPlan(v as BillingPlanId)}>
                  <SelectTrigger className="w-40" aria-label="Тариф">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BILLING_PLANS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  inputMode="numeric"
                  aria-label="Срок"
                  className="w-20"
                />
                <Select value={period} onValueChange={(v) => setPeriod(v as BillingPeriod)}>
                  <SelectTrigger className="w-32" aria-label="Единица срока">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">месяцев</SelectItem>
                    <SelectItem value="year">лет</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={() => void extend()} loading={saving}>
                  Включить тариф вручную
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Для оплаты по договору или в подарок: срок добавляется к уже оплаченному, в истории платежей запись «вручную», 0 ₽.
              </p>
            </section>

            {data.subscriptions.length ? (
              <section>
                <h3 className="mb-2 font-semibold text-foreground">Подписки с автопродлением</h3>
                <ul className="space-y-1 text-sm">
                  {data.subscriptions.map((s) => (
                    <li key={s.id}>
                      {planName(s.plan)}, {rub.format(s.amountRub)} ₽ {s.period === "year" ? "в год" : "в месяц"} — {SUB_STATUS[s.status]}
                      {s.nextChargeAt ? `, следующее списание ${d(s.nextChargeAt)}` : ""}
                      <span className="text-muted-foreground"> · с {d(s.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section>
              <h3 className="mb-2 font-semibold text-foreground">Пользователи · {data.users.length}</h3>
              <TableCard>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Имя</TableHead>
                      <TableHead>Почта</TableHead>
                      <TableHead>Роль</TableHead>
                      <TableHead>Последний вход</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.users.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium text-foreground">{u.fullName}</TableCell>
                        <TableCell>{u.email}</TableCell>
                        <TableCell>{ROLE[u.role]}</TableCell>
                        <TableCell className="whitespace-nowrap">{u.lastLoginAt ? dtt.format(new Date(u.lastLoginAt)) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableCard>
            </section>

            <section>
              <h3 className="mb-2 font-semibold text-foreground">Платежи · {data.payments.length}</h3>
              <TableCard>
                <PaymentsTable rows={data.payments} showSchool={false} />
              </TableCard>
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
