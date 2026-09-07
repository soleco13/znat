-- Э12.9: группы/классы учеников убраны (§0, §2 решение №2 план-ТЗ Э12).
-- Ученик не учётная запись и ни в какой группе не состоит — вход по ссылке
-- урока с введённым именем. Боевых данных нет (решение №5), сносим как есть.
--
-- Порядок важен: DROP TABLE ... CASCADE снимает и FK со стороны lessons,
-- поэтому отдельный DROP CONSTRAINT идёт с IF EXISTS.
DROP TABLE IF EXISTS "group_members" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "groups" CASCADE;--> statement-breakpoint
ALTER TABLE "lessons" DROP CONSTRAINT IF EXISTS "lessons_group_id_groups_id_fk";--> statement-breakpoint
ALTER TABLE "lessons" DROP COLUMN IF EXISTS "group_id";
