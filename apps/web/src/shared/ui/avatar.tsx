import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";

import { cn } from "@/lib/utils";
import { RoleMark, tintOf, type MarkRole } from "@/shared/ui/role-mark";

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn("relative flex size-10 shrink-0 overflow-hidden rounded-full", className)}
    {...props}
  />
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image ref={ref} className={cn("aspect-square size-full", className)} {...props} />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

// .avatar из дизайн-системы: светло-синий фон, синие инициалы, вес 700.
const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex size-full items-center justify-center rounded-full bg-primary-light font-bold text-primary",
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

/**
 * Аватар участника: его цвет и знак «Матис» по роли — тот же алгоритм, что у
 * плитки урока без камеры (features/room/ParticipantPlaceholder). Имя всегда
 * подписано рядом, поэтому аватар декоративный.
 */
function UserAvatar({
  colorKey,
  role,
  size = 40,
  className,
}: {
  /** Ключ цвета: `participantColorKey` участника урока или id аккаунта сотрудника. */
  colorKey: string;
  role: MarkRole;
  size?: number;
  className?: string;
}) {
  const tint = tintOf(colorKey);
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full", className)}
      style={{ width: size, height: size, backgroundColor: tint.bg, color: tint.fg }}
    >
      <RoleMark role={role} disc={Math.round(size * (role === "student" ? 0.42 : 0.5))} />
    </span>
  );
}

export { Avatar, AvatarImage, AvatarFallback, UserAvatar };
