/**
 * Служебное пространство сервиса «Матис» (`schools.kind = 'platform'`):
 * его опубликованные материалы видны в библиотеке всех пространств (вкладка
 * «Матис», `materials/service.ts`). Не часть рантайма — ручной инструмент.
 *
 *   pnpm --filter @school/api run seed:platform -- <email> <password> [ФИО]
 *
 * Идемпотентно: пространство заводится один раз (повторный запуск находит
 * его по `kind`), админ — по email (пароль при повторе обновляется). Этот
 * админ входит обычным логином и готовит материалы Матиса в редакторе:
 * создать → опубликовать, как методист в любой школе.
 */
import argon2 from "argon2";
import { and, asc, eq } from "drizzle-orm";
import { db, pool } from "./client.js";
import { schools, users } from "./schema.js";

const [email, password, fullNameArg] = process.argv.slice(2).filter((a) => a !== "--");
if (!email || !password) {
  console.error("Использование: seed:platform -- <email> <password> [ФИО]");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Пароль — не короче 8 символов.");
  process.exit(1);
}
const fullName = fullNameArg ?? "Команда Матиса";

let [platform] = await db
  .select({ id: schools.id, name: schools.name })
  .from(schools)
  .where(eq(schools.kind, "platform"))
  .orderBy(asc(schools.createdAt))
  .limit(1);

if (!platform) {
  [platform] = await db
    .insert(schools)
    .values({ name: "Матис", slug: "matis", kind: "platform" })
    .returning({ id: schools.id, name: schools.name });
  console.log(`Пространство «Матис» создано: ${platform!.id}`);
} else {
  console.log(`Пространство «Матис» уже есть: ${platform.id}`);
}

const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
const [existing] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);

if (existing && existing.schoolId !== platform!.id) {
  console.error(`Пользователь ${email} уже состоит в другом пространстве — укажите другой email.`);
  await pool.end();
  process.exit(1);
}

if (existing) {
  await db
    .update(users)
    .set({ passwordHash, fullName, role: "admin", isActive: true })
    .where(and(eq(users.id, existing.id), eq(users.schoolId, platform!.id)));
  console.log(`Админ Матиса обновлён: ${email}`);
} else {
  await db.insert(users).values({
    schoolId: platform!.id,
    email: email.toLowerCase(),
    passwordHash,
    fullName,
    role: "admin",
    emailVerifiedAt: new Date(),
  });
  console.log(`Админ Матиса создан: ${email}`);
}

await pool.end();
