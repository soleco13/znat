#!/usr/bin/env bash
set -euo pipefail

# Учебное восстановление с секундомером (Э0.10 ТЗ, гейт Э0).
# Разворачивает ПОСЛЕДНИЙ бэкап из restic в одноразовый scratch-контейнер
# Postgres (не трогая боевую БД) и печатает время восстановления (RTO).
#
# Запускать периодически (не только один раз "для галочки") — план явно
# требует цифру RTO, а не просто наличие бэкапов.

SCRATCH_CONTAINER=school_restore_drill
SCRATCH_PORT=55432

START_TS=$(date +%s)

echo "==> restic restore последнего снапшота во временную папку"
RESTORE_DIR="$(mktemp -d)"
restic restore latest --target "$RESTORE_DIR"

DUMP_FILE="$(find "$RESTORE_DIR" -name 'school_dev_*.dump' | sort | tail -n1)"
if [[ -z "$DUMP_FILE" ]]; then
  echo "Дамп не найден в восстановленном снапшоте" >&2
  exit 1
fi
echo "==> Найден дамп: ${DUMP_FILE}"

echo "==> Поднимаем одноразовый Postgres на порту ${SCRATCH_PORT}"
docker rm -f "$SCRATCH_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$SCRATCH_CONTAINER" \
  -e POSTGRES_USER=school -e POSTGRES_PASSWORD=school -e POSTGRES_DB=school_dev \
  -p "127.0.0.1:${SCRATCH_PORT}:5432" \
  postgres:17 >/dev/null

echo "==> Ждём готовности Postgres"
until docker exec "$SCRATCH_CONTAINER" pg_isready -U school -d school_dev >/dev/null 2>&1; do
  sleep 1
done

echo "==> Восстанавливаем дамп"
docker exec -i "$SCRATCH_CONTAINER" pg_restore -U school -d school_dev --no-owner < "$DUMP_FILE"

ROW_COUNT=$(docker exec -i "$SCRATCH_CONTAINER" \
  psql -U school -d school_dev -tAc "select count(*) from users;" | tr -d '[:space:]')

END_TS=$(date +%s)
RTO=$((END_TS - START_TS))

echo "=================================================="
echo "Восстановление завершено за ${RTO} секунд (RTO)."
echo "Строк в users после восстановления: ${ROW_COUNT}"
echo "=================================================="

echo "==> Уборка"
docker rm -f "$SCRATCH_CONTAINER" >/dev/null
rm -rf "$RESTORE_DIR"
