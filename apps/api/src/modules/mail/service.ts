import nodemailer from "nodemailer";
import { env } from "../../plugins/env.js";
import { renderEmail } from "./template.js";

/**
 * Э14.1 — отправка почты через собственный SMTP-релей на этом же сервере
 * (§1.2 ТЗ: бесплатно, не критический путь урока, замена — просто другой
 * хост в `SMTP_*`). Инфраструктурный модуль без `repo.ts`/`routes.ts` —
 * только импортируемая возможность, как `storage`-адаптер.
 */
const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
});

export async function sendMail(input: { to: string; subject: string; html: string; text: string }) {
  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
}

export async function sendVerificationEmail(to: string, verifyLink: string) {
  const subject = "Подтвердите почту в Матисе";
  const { html, text } = renderEmail(
    {
      subject,
      preheader: "Один шаг до входа в аккаунт: подтвердите адрес почты.",
      heading: "Подтвердите почту",
      paragraphs: ["Нажмите кнопку, чтобы подтвердить адрес и войти в Матис."],
      button: { label: "Подтвердить почту", url: verifyLink },
      note: "Ссылка действует 24 часа. Если вы не регистрировались в Матисе, просто удалите это письмо.",
    },
    env.PUBLIC_ORIGIN,
  );
  await sendMail({ to, subject, html, text });
}

export async function sendPasswordResetEmail(to: string, resetLink: string) {
  const subject = "Сброс пароля в Матисе";
  const { html, text } = renderEmail(
    {
      subject,
      preheader: "Ссылка для нового пароля действует 1 час.",
      heading: "Задайте новый пароль",
      paragraphs: ["Мы получили запрос на сброс пароля от вашего аккаунта в Матисе."],
      button: { label: "Задать новый пароль", url: resetLink },
      note: "Ссылка действует 1 час. Если вы не запрашивали сброс, ничего не делайте: пароль останется прежним.",
    },
    env.PUBLIC_ORIGIN,
  );
  await sendMail({ to, subject, html, text });
}

/** Э15.2 — приглашение в школу на почту. */
export async function sendInviteEmail(
  to: string,
  input: { schoolName: string; roleLabel: string; inviterName: string | null; url: string; expiresAt: Date | null },
) {
  const subject = `Приглашение в «${input.schoolName}» в Матисе`;
  const until = input.expiresAt
    ? `Приглашение действует до ${input.expiresAt.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}. `
    : "";
  const { html, text } = renderEmail(
    {
      subject,
      preheader: `Вас приглашают в роли ${input.roleLabel}.`,
      heading: `Приглашение в «${input.schoolName}»`,
      paragraphs: [
        `${input.inviterName ? `${input.inviterName} приглашает` : "Вас приглашают"} вас в школу «${input.schoolName}» в роли ${input.roleLabel}.`,
        "Если у вас уже есть аккаунт в Матисе, войдите в него: школа добавится к вашему кабинету, второй аккаунт не нужен.",
      ],
      button: { label: "Принять приглашение", url: input.url },
      note: `${until}Если вы не ждали этого письма, просто удалите его.`,
    },
    env.PUBLIC_ORIGIN,
  );
  await sendMail({ to, subject, html, text });
}
