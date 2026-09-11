import type { Role } from "@school/shared";

import { useAuthStore } from "@/shared/auth-store";
import { useGuestSessionStore } from "@/features/guest/guest-session-store";

/**
 * Э12.6 — нормализованная личность участника урока на фронте: персонал
 * (аккаунт из `auth-store`) либо гость-ученик (введённое имя + `guestId`
 * из `guest-session-store`). `id` совпадает с presence-ключом и
 * LiveKit-identity (`ParticipantSnapshot.userId`), по нему `RoomPage`
 * находит себя в списке участников.
 */
export interface RoomIdentity {
  id: string;
  kind: "staff" | "guest";
  role: Role | null;
  name: string;
}

export function useRoomIdentity(): RoomIdentity | null {
  const user = useAuthStore((s) => s.user);
  const guest = useGuestSessionStore((s) => s.session);

  // Гостевая сессия приоритетнее staff-сессии в том же браузере: если
  // человек открыл ссылку ученика (`/j/:token`) и получил гостевую личность
  // для этого урока, он на уроке как ученик — даже если в этой же вкладке
  // он ещё и залогинен сотрудником. Иначе `apiFetch` слал бы staff-Bearer,
  // сервер по нему делал бы staff-actor, и ученик оказывался бы «админом»:
  // управлял чужой камерой/микрофоном и видел свою плитку с чужим именем.
  // `api-client#guestMode` при этом гасит staff-Bearer, `RequireRoomAccess`
  // сверяет, что гостевая сессия — именно этого урока.
  if (guest) {
    return { id: guest.guestId, kind: "guest", role: null, name: guest.name };
  }
  if (user) {
    return { id: user.id, kind: "staff", role: user.role, name: user.fullName };
  }
  return null;
}
