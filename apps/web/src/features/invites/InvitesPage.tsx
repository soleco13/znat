import { useState, type FormEvent } from "react";
import { Copy, Mail, RotateCw, Ticket, Trash2 } from "lucide-react";
import type { CreateInviteResponse, InviteSummary, Role } from "@school/shared";

import { ApiError } from "@/shared/api-client";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { EmptyState } from "@/shared/ui/empty-state";
import { ErrorState } from "@/shared/ui/error-state";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { PageHeader } from "@/shared/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { notify } from "@/shared/ui/notify";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";
import { createInvite, listInvites, resendInvite, revokeInvite } from "./invites-api.js";

const ROLE_LABEL: Record<Role, string> = {
  admin: "Администратор",
  methodist: "Методист",
  teacher: "Учитель",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function inviteStatus(invite: InviteSummary): { label: string; variant: "default" | "secondary" | "destructive" } {
  if (invite.revokedAt) return { label: "Отозвано", variant: "destructive" };
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    return { label: "Истекло", variant: "secondary" };
  }
  if (invite.maxUses != null && invite.useCount >= invite.maxUses) {
    return { label: invite.email ? "Принято" : "Исчерпано", variant: "secondary" };
  }
  return { label: "Активно", variant: "default" };
}

async function copyInviteLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    notify.success("Ссылка приглашения скопирована");
  } catch {
    notify.error("Не удалось скопировать ссылку");
  }
}

/**
 * Э14.2 — приглашения в пространство (§ план-ТЗ Э14): только по ссылке от
 * админа, не открытый список/поиск. Сырой код показывается РОВНО ОДИН РАЗ
 * (в диалоге сразу после создания) — хранится только хэш, в списке ниже
 * его нет и уже не будет.
 */
export function InvitesPage() {
  const invites = useAsync(() => listInvites(), []);

  const [role, setRole] = useState<Role>("teacher");
  const [maxUses, setMaxUses] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("30");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreateInviteResponse | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<InviteSummary | null>(null);
  const [email, setEmail] = useState("");
  const [emailRole, setEmailRole] = useState<Role>("teacher");
  const [sending, setSending] = useState(false);
  const [resending, setResending] = useState<string | null>(null);

  // Э15.2: приглашение на почту — одноразовое, 14 дней, принять может только этот адрес.
  async function onSendEmail(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      const invite = await createInvite({ role: emailRole, email: email.trim() });
      if (invite.emailed) {
        notify.success(`Приглашение отправлено на ${email.trim()}`);
        setEmail("");
      } else {
        notify.error("Приглашение создано, но письмо не ушло — нажмите «Отправить ещё раз» в списке");
      }
      invites.reload();
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : "Не удалось отправить приглашение");
    } finally {
      setSending(false);
    }
  }

  async function onResend(invite: InviteSummary) {
    setResending(invite.id);
    try {
      await resendInvite(invite.id);
      notify.success(`Письмо отправлено ещё раз на ${invite.email}`);
      invites.reload();
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : "Не удалось отправить письмо");
    } finally {
      setResending(null);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const invite = await createInvite({
        role,
        maxUses: maxUses ? Number(maxUses) : undefined,
        expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
      });
      setCreated(invite);
      invites.reload();
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : "Не удалось создать приглашение");
    } finally {
      setSubmitting(false);
    }
  }

  async function onConfirmRevoke() {
    if (!revokeTarget) return;
    try {
      await revokeInvite(revokeTarget.id);
      notify.success("Приглашение отозвано");
      invites.reload();
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : "Не удалось отозвать приглашение");
    } finally {
      setRevokeTarget(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Приглашения"
        subtitle="Пригласите учителя или методиста по почте или по ссылке. Если у человека уже есть аккаунт в Матисе, второй заводить не нужно."
      />
      <Card className="mb-4 p-6">
        <h2 className="mb-4 font-semibold text-foreground">По почте</h2>
        <form onSubmit={onSendEmail} className="flex flex-wrap items-end gap-4">
          <div className="flex min-w-[240px] flex-1 flex-col gap-1.5">
            <Label htmlFor="invite-email">Почта</Label>
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              placeholder="teacher@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-email-role">Роль</Label>
            <Select value={emailRole} onValueChange={(v) => setEmailRole(v as Role)}>
              <SelectTrigger id="invite-email-role" className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="teacher">Учитель</SelectItem>
                <SelectItem value="methodist">Методист</SelectItem>
                <SelectItem value="admin">Администратор</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" loading={sending} disabled={!email.trim()}>
            <Mail aria-hidden />
            Отправить приглашение
          </Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">Ссылка в письме одноразовая и действует 14 дней.</p>
      </Card>

      <Card className="mb-6 p-6">
        <h2 className="mb-4 font-semibold text-foreground">По ссылке</h2>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-role">Роль</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger id="invite-role" className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="teacher">Учитель</SelectItem>
                <SelectItem value="methodist">Методист</SelectItem>
                <SelectItem value="admin">Администратор</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-max-uses">Лимит использований</Label>
            <Input
              id="invite-max-uses"
              type="number"
              min={1}
              placeholder="Без лимита"
              className="w-[160px]"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-expires">Действует, дней</Label>
            <Input
              id="invite-expires"
              type="number"
              min={1}
              placeholder="Без срока"
              className="w-[160px]"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
            />
          </div>
          <Button type="submit" loading={submitting}>
            Создать приглашение
          </Button>
        </form>
      </Card>

      {invites.loading ? (
        <CenteredSpinner label="Загружаем приглашения…" />
      ) : invites.error ? (
        <ErrorState description={invites.error} />
      ) : !invites.data?.items.length ? (
        <EmptyState
          icon={Ticket}
          title="Приглашений пока нет"
          description="Создайте первое приглашение выше, чтобы пригласить учителя или методиста в своё пространство."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Кому</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead>Использовано</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Истекает</TableHead>
                <TableHead>Создано</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.data.items.map((invite) => {
                const status = inviteStatus(invite);
                return (
                  <TableRow key={invite.id}>
                    <TableCell className="max-w-[16rem] truncate">
                      {invite.email ?? <span className="text-muted-foreground">по ссылке</span>}
                    </TableCell>
                    <TableCell>{ROLE_LABEL[invite.role]}</TableCell>
                    <TableCell>
                      {invite.useCount}
                      {invite.maxUses != null ? ` / ${invite.maxUses}` : ""}
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(invite.expiresAt)}</TableCell>
                    <TableCell>{formatDateTime(invite.createdAt)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {invite.email && (status.label === "Активно" || status.label === "Истекло") ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Отправить ещё раз"
                          title="Отправить ещё раз"
                          loading={resending === invite.id}
                          onClick={() => void onResend(invite)}
                        >
                          <RotateCw className="size-4" aria-hidden />
                        </Button>
                      ) : null}
                      {status.label === "Активно" ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Отозвать приглашение"
                          onClick={() => setRevokeTarget(invite)}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={Boolean(created)} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Приглашение создано</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Отправьте эту ссылку тому, кого приглашаете. Она больше нигде не отображается — если
            потеряете, придётся создать новое приглашение.
          </p>
          {created ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/50 p-3">
              <code className="min-w-0 flex-1 truncate text-sm">{created.url}</code>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Скопировать ссылку"
                onClick={() => copyInviteLink(created.url)}
              >
                <Copy className="size-4" aria-hidden />
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(revokeTarget)} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отозвать приглашение?</AlertDialogTitle>
            <AlertDialogDescription>
              Ссылка сразу перестанет работать. Уже зарегистрированные по ней аккаунты не
              пострадают.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmRevoke}>Отозвать</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
