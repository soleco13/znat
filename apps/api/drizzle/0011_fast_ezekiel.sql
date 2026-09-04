CREATE TYPE "public"."material_status" AS ENUM('draft', 'review', 'published');--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "title" text NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "subject" text NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "grades" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "status" "material_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "materials_school_status_idx" ON "materials" USING btree ("school_id","status");--> statement-breakpoint
CREATE INDEX "materials_school_subject_idx" ON "materials" USING btree ("school_id","subject");