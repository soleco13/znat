import { useState } from "react";
import { Users } from "lucide-react";
import type { Role, UpdateUserRequest, UserResponse } from "@school/shared";

import { apiFetch, ApiError } from "@/shared/api-client";
import { useAuthStore } from "@/shared/auth-store";
import { useAsync } from "@/shared/hooks/use-async";
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
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { EmptyState } from "@/shared/ui/empty-state";
import { ErrorState } from "@/shared/ui/error-state";
import { PageHeader } from "@/shared/ui/page-header";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { notify } from "@/shared/ui/notify";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

/**
 * Э15.2 — участники школы (docs/roles §4.1, §8.5): роли набором (учитель и
 * методист совмещаются, администратор — отдельно) и прекращение членства.
 * Исключённый теряет доступ к школе, его аккаунт, личный кабинет и
 * материалы школы сохраняются. Защита «последнего администратора» — на сервере.
 */
const ROLE: Record<Role, string> = { admin: "Администратор", teacher: "Учитель", methodist: "Методист" };
const dt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const listMembers = () => apiFetch<{ items: UserResponse[]; total: number }>("/users?pageSize=200");
const patchMember = (id: string, body: UpdateUserRequest) =>
  apiFetch<UserResponse>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export function MembersPage() {
  const members = useAsync(listMembers, []);
  const myId = useAuthStore((s) => s.user?.id);
  const [editing, setEditing] = useState<UserResponse | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [excluding, setExcluding] = useState<UserResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const openRoles = (u: UserResponse) => {
    setEditing(u);
    setRoles(u.roles.length ? u.roles : [u.role]);
  };
  const toggle = (r: Role, on: boolean) => {
    if (r === "admin") setRoles(on ? ["admin"] : []);
    else setRoles((prev) => (on ? [...prev.filter((x) => x !== "admin"), r] : prev.filter((x) => x !== r)));
  };

  async function save(id: string, body: UpdateUserRequest, done: string) {
    setBusy(true);
    try {
      await patchMember(id, body);
      notify.success(done);
      members.reload();
      setEditing(null);
      setExcluding(null);
    } catch (e) {
      notify.error(e instanceof ApiError ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Участники"
        subtitle="Учителя, методисты и администраторы школы. Пригласить нового участника можно в разделе «Приглашения»."
      />
      {members.loading ? (
        <CenteredSpinner label="Загружаем участников…" />
      ) : members.error ? (
        <ErrorState description={members.error} onRetry={members.reload} />
      ) : !members.data?.items.length ? (
        <EmptyState icon={Users} title="Участников пока нет" description="Пригласите учителей в разделе «Приглашения»." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Участник</TableHead>
                <TableHead>Роли</TableHead>
                <TableHead>Последний вход</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data.items.map((u) => {
                const r = u.roles.length ? u.roles : [u.role];
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">
                        {u.fullName}
                        {u.id === myId ? <span className="text-muted-foreground"> (вы)</span> : null}
                      </div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {r.map((x) => (
                          <Badge key={x} variant="secondary">
                            {ROLE[x]}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{u.lastLoginAt ? dt.format(new Date(u.lastLoginAt)) : "—"}</TableCell>
                    <TableCell>{u.isActive ? "В школе" : <span className="text-muted-foreground">Исключён</span>}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {u.isActive ? (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => openRoles(u)}>
                            Роли
                          </Button>
                          {u.id !== myId ? (
                            <Button variant="ghost" size="sm" onClick={() => setExcluding(u)}>
                              Исключить
                            </Button>
                          ) : null}
                        </>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => void save(u.id, { isActive: true }, "Участник возвращён в школу")}>
                          Вернуть
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Роли: {editing?.fullName}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {(["teacher", "methodist", "admin"] as Role[]).map((r) => (
              <label key={r} className="flex items-start gap-2.5 text-sm">
                <Checkbox checked={roles.includes(r)} onCheckedChange={(v) => toggle(r, v === true)} className="mt-0.5" />
                <span>
                  <span className="font-medium text-foreground">{ROLE[r]}</span>
                  <span className="block text-xs text-muted-foreground">
                    {r === "teacher"
                      ? "Ведёт уроки в назначенных аудиториях, видит записи своих уроков"
                      : r === "methodist"
                        ? "Создаёт и редактирует материалы школы, без записей уроков"
                        : "Полный доступ к школе; не совмещается с другими ролями"}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Отмена
            </Button>
            <Button
              loading={busy}
              disabled={!roles.length}
              onClick={() => editing && void save(editing.id, { roles }, "Роли сохранены")}
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(excluding)} onOpenChange={(v) => !v && setExcluding(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Исключить {excluding?.fullName} из школы?</AlertDialogTitle>
            <AlertDialogDescription>
              Доступ к аудиториям, материалам и записям школы закроется. Аккаунт, личный кабинет и материалы школы
              сохранятся, вернуть участника можно здесь же.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => excluding && void save(excluding.id, { isActive: false }, "Участник исключён")}>
              Исключить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
