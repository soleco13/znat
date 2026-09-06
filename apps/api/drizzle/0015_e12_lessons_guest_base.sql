-- Э12: gen_random_bytes() для дефолта lessons.join_token (бэкфилл существующих
-- строк). Токен в рантайме всё равно генерирует приложение крипто-стойко.
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE TABLE "lesson_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"assigned_by" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_materials_lesson_material_idx" UNIQUE("lesson_id","material_id")
);
--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "group_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "subject" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "starts_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "duration_min" SET DEFAULT 60;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "join_token" text DEFAULT encode(gen_random_bytes(24), 'hex') NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_materials" ADD CONSTRAINT "lesson_materials_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_materials" ADD CONSTRAINT "lesson_materials_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_materials" ADD CONSTRAINT "lesson_materials_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_join_token_unique" UNIQUE("join_token");