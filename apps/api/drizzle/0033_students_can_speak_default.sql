-- Микрофон учеников по умолчанию (решение владельца 2026-10-11): у всех
-- существующих уроков включаем studentsCanSpeak — ученик входит с уже
-- включённым микрофоном. Новые уроки получают true из дефолта схемы
-- (packages/shared/src/lessons.ts). Учитель может выключить флаг для урока.
UPDATE "lessons"
SET "settings" = jsonb_set(COALESCE("settings", '{}'::jsonb), '{studentsCanSpeak}', 'true'::jsonb);
