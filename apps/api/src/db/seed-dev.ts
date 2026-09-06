/**
 * Наполнение dev-БД минимальным набором для ручной проверки: одна школа,
 * по одному аккаунту на каждую роль, группа и запланированный урок.
 * НЕ часть рантайма — инструмент разработчика, как и seed-material.ts.
 * Пароли фиксированы и годятся ТОЛЬКО для локальной разработки.
 *
 *   pnpm --filter @school/api run seed:dev
 *
 * Идемпотентно: повторный запуск не плодит дубли (сверка по email и
 * названию школы/группы), пароли перезаписываются на дефолтные.
 */
import argon2 from "argon2";
import { and, eq } from "drizzle-orm";
import { db, pool } from "./client.js";
import { groupMembers, groups, lessons, schools, users } from "./schema.js";

const PASSWORD = "password123";

const ACCOUNTS = [
  { email: "admin@school.dev", fullName: "Админ Админов", role: "admin" as const },
  { email: "methodist@school.dev", fullName: "Мария Методистова", role: "methodist" as const },
  { email: "teacher@school.dev", fullName: "Тимур Учителев", role: "teacher" as const },
  { email: "student1@school.dev", fullName: "Стас Первый", role: "student" as const },
  { email: "student2@school.dev", fullName: "Соня Вторая", role: "student" as const },
];

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
    .values({ schoolId, email: acc.email, passwordHash, fullName: acc.fullName, role: acc.role })
    .returning();
  return created!;
}

async function upsertGroup(schoolId: string, name: string) {
  const existing = await db
    .select()
    .from(groups)
    .where(and(eq(groups.schoolId, schoolId), eq(groups.name, name)))
    .limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(groups)
    .values({ schoolId, name, grade: 9, academicYear: "2026/2027" })
    .returning();
  return created!;
}

const school = await upsertSchool("Демо-школа");
const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

const created: Record<string, string> = {};
for (const acc of ACCOUNTS) {
  const user = await upsertUser(school.id, acc, passwordHash);
  created[acc.role === "student" ? acc.email : acc.role] = user.id;
}

const group = await upsertGroup(school.id, "9А");
const studentIds = (
  await db.select().from(users).where(eq(users.schoolId, school.id))
)
  .filter((u) => u.role === "student")
  .map((u) => u.id);
for (const userId of studentIds) {
  await db
    .insert(groupMembers)
    .values({ groupId: group.id, userId })
    .onConflictDoNothing();
}

const teacherId = created["teacher"]!;
const existingLesson = await db
  .select()
  .from(lessons)
  .where(and(eq(lessons.groupId, group.id), eq(lessons.title, "Демо-урок")))
  .limit(1);
if (!existingLesson[0]) {
  await db.insert(lessons).values({
    schoolId: school.id,
    groupId: group.id,
    teacherId,
    title: "Демо-урок",
    subject: "Математика",
    startsAt: new Date(Date.now() + 60 * 60 * 1000),
    durationMin: 45,
  });
}

console.log(`Школа: ${school.name} (${school.id})`);
console.log(`Группа: ${group.name}, учеников в ней: ${studentIds.length}`);
console.log("\nАккаунты (пароль у всех одинаковый):");
for (const acc of ACCOUNTS) {
  console.log(`  ${acc.role.padEnd(9)} ${acc.email.padEnd(22)} ${PASSWORD}`);
}
await pool.end();
