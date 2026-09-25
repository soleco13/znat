import {
  Megaphone,
  MicOff,
  MonitorUp,
  MoreHorizontal,
  PenLine,
  Pin,
  PinOff,
  UserX,
  Video,
} from "lucide-react";
import type { ParticipantSnapshot } from "@school/shared";

import { UserAvatar } from "@/shared/ui/avatar";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

type PermissionKey = "canDraw" | "canSpeak" | "canPublishVideo" | "canShareScreen";

const PERMISSION_ITEMS = [
  { key: "canSpeak", icon: Megaphone, grant: "Дать слово", revoke: "Забрать слово" },
  { key: "canDraw", icon: PenLine, grant: "Разрешить рисовать", revoke: "Запретить рисовать" },
  { key: "canShareScreen", icon: MonitorUp, grant: "Разрешить демонстрацию", revoke: "Запретить демонстрацию" },
  { key: "canPublishVideo", icon: Video, grant: "Разрешить камеру", revoke: "Запретить камеру" },
] as const;

const ITEM = "h-9 gap-2.5 rounded-[10px] px-2.5 text-sm [&>svg]:text-muted-foreground";

/** Контекстное меню участника: закрепление, мьют и права — одним списком действий. */
export function ParticipantMenu({
  participant,
  hasMedia,
  onTogglePermission,
  onMute,
  onTogglePin,
  onRemove,
}: {
  participant: ParticipantSnapshot;
  /** До подключения LiveKit мьют/пин недоступны. */
  hasMedia: boolean;
  onTogglePermission: (userId: string, key: PermissionKey, value: boolean) => void;
  onMute: (userId: string) => void;
  onTogglePin: (userId: string, pinned: boolean) => void;
  onRemove: (participant: ParticipantSnapshot) => void;
}) {
  const p = participant;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0 text-text-3"
          aria-label={`Действия — ${p.fullName}`}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[264px] rounded-2xl p-1.5 shadow-lg">
        <DropdownMenuLabel className="mb-1 flex items-center gap-2 border-b border-border px-2.5 pb-2 pt-2.5 font-normal">
          <UserAvatar name={p.fullName} size={28} />
          <span className="truncate text-sm font-semibold">{p.fullName}</span>
        </DropdownMenuLabel>
        {hasMedia && p.kind === "guest" ? (
          <DropdownMenuItem className={ITEM} onSelect={() => onTogglePin(p.userId, !p.pinned)}>
            {p.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
            {p.pinned ? "Открепить со стейджа" : "Закрепить на стейдже"}
          </DropdownMenuItem>
        ) : null}
        {hasMedia && p.permissions.canSpeak ? (
          <DropdownMenuItem className={ITEM} onSelect={() => onMute(p.userId)}>
            <MicOff aria-hidden />
            Заглушить
          </DropdownMenuItem>
        ) : null}
        {PERMISSION_ITEMS.map(({ key, icon: Icon, grant, revoke }) => {
          const granted = p.permissions[key];
          return (
            <DropdownMenuItem
              key={key}
              className={ITEM}
              onSelect={() => onTogglePermission(p.userId, key, !granted)}
            >
              <Icon aria-hidden />
              {granted ? revoke : grant}
            </DropdownMenuItem>
          );
        })}
        {p.kind === "guest" ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={`${ITEM} text-danger focus:text-danger [&>svg]:text-danger`}
              onSelect={() => onRemove(p)}
            >
              <UserX aria-hidden />
              Удалить из урока
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
