import nodemailer from "nodemailer";
import { env } from "../../plugins/env.js";

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
  await sendMail({
    to,
    subject: "Подтверждение почты",
    text: `Чтобы подтвердить почту и активировать аккаунт, перейдите по ссылке: ${verifyLink}\n\nСсылка действует 24 часа.`,
    html: `<p>Чтобы подтвердить почту и активировать аккаунт, перейдите по ссылке:</p><p><a href="${verifyLink}">${verifyLink}</a></p><p>Ссылка действует 24 часа.</p>`,
  });
}
