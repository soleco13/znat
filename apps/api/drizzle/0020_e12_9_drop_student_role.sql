-- Э12.9: роль `student` убрана (§1.4 план-ТЗ Э12: пользователи — только
-- персонал). Ученик аккаунта не имеет: входит по ссылке урока с введённым
-- именем, его личность — строка `lesson_participants` (kind = 'guest').
--
-- Боевых данных нет (решение №5 план-ТЗ) — оставшиеся dev-аккаунты учеников
-- сносим, иначе приведение типа ниже упадёт на несуществующем значении.
DELETE FROM "users" WHERE "role" = 'student';--> statement-breakpoint
ALTER TABLE "public"."users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."role";--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'methodist', 'teacher');--> statement-breakpoint
ALTER TABLE "public"."users" ALTER COLUMN "role" SET DATA TYPE "public"."role" USING "role"::"public"."role";
