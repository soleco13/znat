/**
 * Наполнение dev-БД минимальным набором для ручной проверки (Э12): одна
 * школа, по одному аккаунту на каждую роль ПЕРСОНАЛА (ученики аккаунтов не
 * имеют — входят по ссылке урока), пара постоянных уроков с гостевыми
 * ссылками и назначенными материалами.
 *
 * НЕ часть рантайма — инструмент разработчика, как и seed-material.ts.
 * Пароли фиксированы и годятся ТОЛЬКО для локальной разработки.
 *
 *   pnpm --filter @school/api run seed:dev
 *
 * Идемпотентно: повторный запуск не плодит дубли (сверка по email и
 * названию школы/урока), пароли перезаписываются на дефолтные.
 */
import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { and, eq } from "drizzle-orm";
import { db, pool } from "./client.js";
import { lessonMaterials, lessons, materials, schools, users } from "./schema.js";

const PASSWORD = "password123";

const ACCOUNTS = [
  { email: "admin@school.dev", fullName: "Админ Админов", role: "admin" as const },
  { email: "methodist@school.dev", fullName: "Мария Методистова", role: "methodist" as const },
  { email: "teacher@school.dev", fullName: "Тимур Учителев", role: "teacher" as const },
];

const LESSON_TITLES = ["Демо-урок: алгебра", "Демо-урок: геометрия"];

async function upsertSchool(name: string) {
  const existing = await db.select().from(schools).where(eq(schools.name, name)).limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(schools)
    .values({ name, timezone: "Europe/Moscow" })
    .returning();
  return created!;
}

async function upsertUser(
  schoolId: string,
  acc: (typeof ACCOUNTS)[number],
  passwordHash: string,
) {
  const existing = await db.select().from(users).where(eq(users.email, acc.email)).limit(1);
  if (existing[0]) {
    const [updated] = await db
      .update(users)
      .set({ passwordHash, fullName: acc.fullName, role: acc.role, isActive: true, schoolId })
      .where(eq(users.id, existing[0].id))
      .returning();
    return updated!;
  }
  const [created] = await db
    .insert(users)
    .values({
      schoolId,
      email: acc.email,
      passwordHash,
      fullName: acc.fullName,
      role: acc.role,
      emailVerifiedAt: new Date(),
    })
    .returning();
  return created!;
}

async function upsertLesson(schoolId: string, teacherId: string, title: string) {
  const existing = await db
    .select()
    .from(lessons)
    .where(and(eq(lessons.schoolId, schoolId), eq(lessons.title, title)))
    .limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(lessons)
    .values({ schoolId, teacherId, title, joinToken: randomBytes(32).toString("hex") })
    .returning();
  return created!;
}

const school = await upsertSchool("Демо-школа");
const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

const created: Record<string, string> = {};
for (const acc of ACCOUNTS) {
  const user = await upsertUser(school.id, acc, passwordHash);
  created[acc.role] = user.id;
}

const teacherId = created["teacher"]!;
const adminId = created["admin"]!;

const seededLessons: Awaited<ReturnType<typeof upsertLesson>>[] = [];
for (const title of LESSON_TITLES) {
  seededLessons.push(await upsertLesson(school.id, teacherId, title));
}

// Назначаем первому уроку все опубликованные материалы школы («домашка»).
const publishedMaterials = await db
  .select({ id: materials.id })
  .from(materials)
  .where(and(eq(materials.schoolId, school.id), eq(materials.status, "published")));
if (seededLessons[0] && publishedMaterials.length > 0) {
  await db
    .insert(lessonMaterials)
    .values(
      publishedMaterials.map((m) => ({
        lessonId: seededLessons[0]!.id,
        materialId: m.id,
        assignedBy: adminId,
      })),
    )
    .onConflictDoNothing();
}

console.log(`Школа: ${school.name} (${school.id})`);
console.log("\nАккаунты персонала (пароль у всех одинаковый):");
for (const acc of ACCOUNTS) {
  console.log(`  ${acc.role.padEnd(9)} ${acc.email.padEnd(24)} ${PASSWORD}`);
}
console.log("\nУроки (ссылка для учеников — /j/<token>):");
for (const l of seededLessons) {
  console.log(`  ${l.title.padEnd(26)} /j/${l.joinToken}`);
}
console.log(
  `\nНазначено материалов первому уроку: ${seededLessons[0] ? publishedMaterials.length : 0}`,
);
await pool.end();
