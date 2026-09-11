CREATE TABLE "material_annotations" (
	"activity_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"strokes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_annotations_activity_id_participant_id_pk" PRIMARY KEY("activity_id","participant_id")
);
--> statement-breakpoint
ALTER TABLE "material_annotations" ADD CONSTRAINT "material_annotations_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_annotations" ADD CONSTRAINT "material_annotations_participant_id_lesson_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."lesson_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_annotations" ADD CONSTRAINT "material_annotations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;