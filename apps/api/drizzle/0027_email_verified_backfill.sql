-- Вход теперь требует подтверждённую почту. Аккаунты, которым письмо
-- подтверждения никогда не отправлялось (созданы админом или сидом), считаем
-- подтверждёнными — иначе они потеряли бы доступ.
UPDATE "users" SET "email_verified_at" = "created_at"
WHERE "email_verified_at" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "email_verification_tokens" t WHERE t."user_id" = "users"."id");--> statement-breakpoint
-- Email хранится в нижнем регистре. Если два аккаунта отличаются только
-- регистром букв, второй не трогаем — его разберёт админ вручную.
UPDATE "users" u SET "email" = lower(u."email")
WHERE u."email" <> lower(u."email")
  AND NOT EXISTS (SELECT 1 FROM "users" o WHERE o."id" <> u."id" AND o."email" = lower(u."email"));
