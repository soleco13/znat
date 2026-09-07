ALTER TABLE "lessons" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "lessons" DROP COLUMN "started_at";--> statement-breakpoint
ALTER TABLE "lessons" DROP COLUMN "ended_at";--> statement-breakpoint
DROP TYPE "public"."lesson_status";