CREATE TYPE "public"."school_kind" AS ENUM('individual', 'organization');--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verification_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "slug" text DEFAULT 'space-' || substr(gen_random_uuid()::text, 1, 8) NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "kind" "school_kind" DEFAULT 'individual' NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "inn" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "ogrn" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
-- Э14.1: существующие аккаунты созданы до концепции подтверждения почты
-- (только админом, вручную) — считаются доверенными, помечаем подтверждёнными
-- задним числом, чтобы login() не начал внезапно блокировать их.
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_verification_tokens_user_idx" ON "email_verification_tokens" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_slug_unique" UNIQUE("slug");