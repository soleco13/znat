#!/usr/bin/env bash
set -euo pipefail

# Деплой на боевой сервер (Э0.8 ТЗ). Запускать из корня репозитория на сервере.
# Проверяет активные уроки перед перезапуском контейнеров — иначе можно
# оборвать урок в процессе. --force пропускает эту проверку.

cd "$(dirname "$0")"

FORCE=false
if [[ "${1:-}" == "--force" ]]; then
  FORCE=true
fi

echo "==> git pull"
git pull --ff-only

if [[ "$FORCE" == false ]]; then
  echo "==> Проверка активных уроков"
  LIVE_COUNT=$(docker compose exec -T postgres \
    psql -U school -d school_dev -tAc "select count(*) from lessons where status = 'live';" \
    2>/dev/null || echo "0")
  LIVE_COUNT="${LIVE_COUNT//[[:space:]]/}"
  if [[ "$LIVE_COUNT" =~ ^[0-9]+$ ]] && [[ "$LIVE_COUNT" -gt 0 ]]; then
    echo "ОТМЕНЕНО: сейчас идёт $LIVE_COUNT активных урок(ов)."
    echo "Дождись окончания или запусти с флагом --force, чтобы перезапустить принудительно."
    exit 1
  fi
else
  echo "==> --force: проверка активных уроков пропущена"
fi

echo "==> docker compose build"
docker compose build

echo "==> Применение миграций"
docker compose run --rm app node apps/api/dist/db/migrate.js

echo "==> docker compose up -d"
docker compose up -d

echo "==> Готово. Статус контейнеров:"
docker compose ps
