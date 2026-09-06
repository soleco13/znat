-- Э12.5 (§1.3 план-ТЗ): личность отвечающего на задание — строка участника
-- урока (`lesson_participants`), а не `users.id`. Задание всегда на уроке,
-- режим `homework` и группы у активностей убраны.
--
-- Боевых данных нет (решение пользователя, §9 план-ТЗ). Старые ответы и
-- домашние активности (если остались в dev-БД) несовместимы с новой моделью
-- идентичности — чистим до смены схемы, чтобы NOT NULL / FK не упали.
DELETE FROM "responses";--> statement-breakpoint
DELETE FROM "activities" WHERE "lesson_id" IS NULL;--> statement-breakpoint
ALTER TABLE "responses" RENAME COLUMN "user_id" TO "participant_id";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_group_id_groups_id_fk";
--> statement-breakpoint
ALTER TABLE "responses" DROP CONSTRAINT "responses_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "activities_group_idx";--> statement-breakpoint
DROP INDEX "responses_activity_user_idx";--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "lesson_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_participant_id_lesson_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."lesson_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "responses_activity_participant_idx" ON "responses" USING btree ("activity_id","participant_id");--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "group_id";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "mode";--> statement-breakpoint
DROP TYPE "public"."activity_mode";
