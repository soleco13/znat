ALTER TABLE "responses" ADD COLUMN "rubric_scores" jsonb;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "comment" text;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "submitted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "responses_manual_queue_idx" ON "responses" USING btree ("submitted","auto_graded","graded_by");