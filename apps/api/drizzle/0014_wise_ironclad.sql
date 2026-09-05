CREATE TYPE "public"."recording_status" AS ENUM('starting', 'recording', 'processing', 'ready', 'failed', 'aborted', 'deleted');--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"started_by" uuid NOT NULL,
	"egress_id" text NOT NULL,
	"status" "recording_status" DEFAULT 'starting' NOT NULL,
	"storage_key" text,
	"duration_sec" integer,
	"size_bytes" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "recordings_egress_id_unique" UNIQUE("egress_id")
);
--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recordings_lesson_idx" ON "recordings" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "recordings_retention_idx" ON "recordings" USING btree ("status","expires_at");