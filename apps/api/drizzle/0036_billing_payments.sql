CREATE TYPE "public"."payment_status" AS ENUM('pending', 'confirmed', 'canceled', 'chargebacked');--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"user_id" uuid,
	"plan" text NOT NULL,
	"period" text NOT NULL,
	"amount_rub" integer NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'platega' NOT NULL,
	"provider_tx_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "payments_provider_tx_id_unique" UNIQUE("provider_tx_id")
);
--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "billing_plan" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "paid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_school_idx" ON "payments" USING btree ("school_id","created_at");