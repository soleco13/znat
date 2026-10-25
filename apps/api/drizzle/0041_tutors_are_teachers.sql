-- Э15.3 (docs/roles §5): индивидуальный репетитор — учитель своего личного
-- пространства; администратор есть только у школ.
UPDATE "memberships" m SET "roles" = ARRAY['teacher']::role[]
FROM "schools" s
WHERE s."id" = m."school_id" AND s."kind" = 'individual' AND 'admin' = ANY(m."roles");
--> statement-breakpoint
UPDATE "users" u SET "role" = 'teacher'
FROM "schools" s
WHERE s."id" = u."school_id" AND s."kind" = 'individual' AND u."role" = 'admin';
