import { useMemo, type ReactNode } from "react";
import { supportContactsFor, type SupportContacts } from "@school/shared";
import { Send, Mail } from "lucide-react";

import { useSpaces } from "./SpaceSwitcher.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

const linkClass = "font-medium text-primary hover:underline";

/** Контакты по виду текущего пространства: репетитору — только Telegram, пока вид неизвестен — тоже. */
export function useSupportContacts(): SupportContacts {
  const spaces = useSpaces();
  const kind = spaces.find((s) => s.active)?.kind;
  return useMemo(() => supportContactsFor(kind), [kind]);
}

/** Контакты в строку для текста: «Telegram @matis_manager или support@matis-edu.ru». */
export function SupportLinks({ contacts }: { contacts: SupportContacts }): ReactNode {
  return (
    <>
      <a className={linkClass} href={contacts.telegramUrl} target="_blank" rel="noreferrer">
        Telegram {contacts.telegram}
      </a>
      {contacts.email ? (
        <>
          {" "}
          или{" "}
          <a className={linkClass} href={`mailto:${contacts.email}`}>
            {contacts.email}
          </a>
        </>
      ) : null}
    </>
  );
}

/** Окно «Поддержка»: кто куда пишет. Открывается из меню учителя и шапки администратора. */
export function SupportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const contacts = useSupportContacts();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Поддержка</DialogTitle>
          <DialogDescription>
            Вопросы по работе сервиса, оплате, возврату и тарифам.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-3 text-sm">
          <li className="flex items-center gap-3">
            <Send className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <a className={linkClass} href={contacts.telegramUrl} target="_blank" rel="noreferrer">
              Telegram {contacts.telegram}
            </a>
          </li>
          {contacts.email ? (
            <li className="flex items-center gap-3">
              <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <a className={linkClass} href={`mailto:${contacts.email}`}>
                {contacts.email}
              </a>
            </li>
          ) : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
