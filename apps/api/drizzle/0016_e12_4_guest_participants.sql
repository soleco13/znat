CREATE TYPE "public"."participant_kind" AS ENUM('staff', 'guest');--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_participants" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "guest_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "author_name" text;--> statement-breakpoint
ALTER TABLE "lesson_participants" ADD COLUMN "kind" "participant_kind" DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_participants" ADD COLUMN "guest_id" uuid;--> statement-breakpoint
ALTER TABLE "lesson_participants" ADD COLUMN "display_name" text;--> statement-breakpoint
CREATE INDEX "lesson_participants_lesson_guest_idx" ON "lesson_participants" USING btree ("lesson_id","guest_id");