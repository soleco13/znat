CREATE TYPE "public"."deck_status" AS ENUM('pending', 'converting', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "deck_slides" (
	"deck_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"image_storage_key" text NOT NULL,
	"thumb_storage_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"text_layer" jsonb,
	CONSTRAINT "deck_slides_deck_id_index_pk" PRIMARY KEY("deck_id","index")
);
--> statement-breakpoint
CREATE TABLE "decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"source_storage_key" text NOT NULL,
	"source_sha256" text NOT NULL,
	"source_name" text NOT NULL,
	"title" text NOT NULL,
	"status" "deck_status" DEFAULT 'pending' NOT NULL,
	"slide_count" integer DEFAULT 0 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deck_slides" ADD CONSTRAINT "deck_slides_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decks_lesson_idx" ON "decks" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "decks_school_sha_idx" ON "decks" USING btree ("school_id","source_sha256");