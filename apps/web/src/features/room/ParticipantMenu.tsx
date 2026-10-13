import {
  GraduationCap,
  Megaphone,
  MicOff,
  MonitorUp,
  MoreHorizontal,
  PenLine,
  Pin,
  PinOff,
  UserX,
  Video,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useParams } from "react-router-dom";
import type { ParticipantSnapshot } from "@school/shared";

import { UserAvatar } from "@/shared/ui/avatar";
import { markRoleOf, participantColorKey } from "@/shared/ui/role-mark";
import { cn } from "@/lib/utils";
import { Button } from "@/shared/ui/button";
import { Slider } from "@/shared/ui/slider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { useParticipantVolumeStore } from "./participant-volume.js";

type PermissionKey = "canDraw" | "canSpeak" | "canPublishVideo" | "canShareScreen";

const PERMISSION_ITEMS = [
  { key: "canSpeak", icon: Megaphone, grant: "Дать слово", revoke: "Забрать слово" },
  { key: "canDraw", icon: PenLine, grant: "Разрешить рисовать", revoke: "Запретить рисовать" },
  { key: "canShareScreen", icon: MonitorUp, grant: "Разрешить демонстрацию", revoke: "Запретить демонстрацию" },
  { key: "canPublishVideo", icon: Video, grant: "Разрешить камеру", revoke: "Запретить камеру" },
] as const;

const ITEM = "h-9 gap-2.5 rounded-[10px] px-2.5 text-sm [&>svg]:text-muted-foreground";

/**
 * Контекстное меню участника: громкость у себя, закрепление, мьют, права и
 * права учителя — одним списком действий. Открывается из списка участников
 * и кнопкой «⋯» на плитке камеры.
 *  - громкость — любому участнику для чужих плиток (`showVolume`);
 *  - управление — учителю урока, админу и гостю с правами учителя (`manage`);
 *  - «Сделать учителем» — только админу и только внешнему участнику.
 */
export function ParticipantMenu({
  participant,
  hasMedia,
  manage = true,
  showVolume = false,
  canGrantTeacher = false,
  trigger = "list",
  onTogglePermission,
  onMute,
  onTogglePin,
  onRemove,
  onSetCohost,
}: {
  participant: ParticipantSnapshot;
  /** До подключения LiveKit мьют/пин/громкость недоступны. */
  hasMedia: boolean;
  manage?: boolean;
  showVolume?: boolean;
  canGrantTeacher?: boolean;
  /** `tile` — круглая кнопка поверх видео. */
  trigger?: "list" | "tile";
  onTogglePermission: (userId: string, key: PermissionKey, value: boolean) => void;
  onMute: (userId: string) => void;
  onTogglePin: (userId: string, pinned: boolean) => void;
  onRemove: (participant: ParticipantSnapshot) => void;
  onSetCohost?: (userId: string, cohost: boolean) => void;
}) {
  const p = participant;
  const { id: lessonId } = useParams<{ id: string }>();
  const volume = useParticipantVolumeStore((s) => s.volumes.get(p.userId) ?? 1);
  const setVolume = useParticipantVolumeStore((s) => s.setVolume);
  const volumeVisible = showVolume && hasMedia;
  const teacherGrantVisible = canGrantTeacher && p.kind === "guest" && Boolean(onSetCohost);
  if (!manage && !volumeVisible && !teacherGrantVisible) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {trigger === "tile" ? (
          <button
            type="button"
            aria-label={`Действия — ${p.fullName}`}
            className={cn(
              "flex size-7 items-center justify-center rounded-full bg-[rgba(16,24,40,.72)] text-white transition-opacity",
              "hover:bg-[rgba(16,24,40,.9)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
              "data-[state=open]:opacity-100",
            )}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0 text-text-3"
            aria-label={`Действия — ${p.fullName}`}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[264px] rounded-lg p-1.5 shadow-lg">
        <DropdownMenuLabel className="mb-1 flex items-center gap-2 border-b border-border px-2.5 pb-2 pt-2.5 font-normal">
          <UserAvatar colorKey={participantColorKey(p, lessonId)} role={markRoleOf(p.kind, p.role)} size={28} />
          <span className="truncate text-sm font-semibold">{p.fullName}</span>
        </DropdownMenuLabel>
        {volumeVisible ? (
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <button
              type="button"
              onClick={() => setVolume(p.userId, volume > 0 ? 0 : 1)}
              aria-label={volume > 0 ? "Выключить звук у себя" : "Включить звук"}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              {volume > 0 ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
            </button>
            <Slider
              value={[Math.round(volume * 100)]}
              min={0}
              max={100}
              step={5}
              onValueChange={([v]) => setVolume(p.userId, (v ?? 100) / 100)}
              aria-label={`Громкость — ${p.fullName}`}
            />
            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-text-3">{Math.round(volume * 100)}%</span>
          </div>
        ) : null}
        {manage ? (
          <>
            {volumeVisible ? <DropdownMenuSeparator /> : null}
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
          </>
        ) : null}
        {teacherGrantVisible ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={ITEM} onSelect={() => onSetCohost?.(p.userId, !p.cohost)}>
              <GraduationCap aria-hidden />
              {p.cohost ? "Забрать права учителя" : "Выдать права учителя"}
            </DropdownMenuItem>
          </>
        ) : null}
        {manage && p.kind === "guest" ? (
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
