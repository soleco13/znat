-- Экспериментальная запись уроков (docs/experimental-recording.md): только
-- новые типы и таблицы, существующие (`recordings` и др.) не меняются. Откат
-- метода — удалить строки lesson_recording_modes или очистить
-- RECORDING_EXPERIMENTAL_SCHOOL_IDS; таблицы основной записи не затронуты.
CREATE TYPE "public"."lesson_recording_mode" AS ENUM('egress', 'experimental', 'both');--> statement-breakpoint
CREATE TYPE "public"."raw_recording_status" AS ENUM('requested', 'recording', 'finalizing', 'queued_for_render', 'rendering', 'verifying', 'ready', 'failed', 'aborted', 'deleted');--> statement-breakpoint
CREATE TABLE "lesson_recording_modes" (
	"lesson_id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"mode" "lesson_recording_mode" NOT NULL,
	"set_by" uuid,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_recording_journal" (
	"recording_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"ts_ms" bigint NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb,
	"data" "bytea",
	CONSTRAINT "raw_recording_journal_recording_id_seq_pk" PRIMARY KEY("recording_id","seq")
);
--> statement-breakpoint
CREATE TABLE "raw_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"started_by" uuid NOT NULL,
	"livekit_room" text NOT NULL,
	"status" "raw_recording_status" DEFAULT 'requested' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"recorder_lease_id" uuid,
	"recorder_worker" text,
	"recorder_heartbeat_at" timestamp with time zone,
	"recorder_stats" jsonb,
	"stop_requested_at" timestamp with time zone,
	"render_attempts" integer DEFAULT 0 NOT NULL,
	"render_lease_id" uuid,
	"render_worker" text,
	"render_heartbeat_at" timestamp with time zone,
	"render_step" text,
	"render_metrics" jsonb,
	"recording_dir" text NOT NULL,
	"output_key" text NOT NULL,
	"compare_recording_id" uuid,
	"last_error" text,
	"duration_sec" double precision,
	"size_bytes" bigint,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"raw_expires_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "lesson_recording_modes" ADD CONSTRAINT "lesson_recording_modes_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_recording_modes" ADD CONSTRAINT "lesson_recording_modes_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_recording_modes" ADD CONSTRAINT "lesson_recording_modes_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_recording_journal" ADD CONSTRAINT "raw_recording_journal_recording_id_raw_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."raw_recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_recordings" ADD CONSTRAINT "raw_recordings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_recordings" ADD CONSTRAINT "raw_recordings_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_recordings" ADD CONSTRAINT "raw_recordings_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_recordings" ADD CONSTRAINT "raw_recordings_compare_recording_id_recordings_id_fk" FOREIGN KEY ("compare_recording_id") REFERENCES "public"."recordings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "raw_recordings_lesson_idx" ON "raw_recordings" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "raw_recordings_status_idx" ON "raw_recordings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_recordings_one_active_per_lesson" ON "raw_recordings" USING btree ("lesson_id") WHERE status IN ('requested', 'recording');