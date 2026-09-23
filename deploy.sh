#!/usr/bin/env bash
set -euo pipefail

# Деплой на боевой сервер (Э0.8 ТЗ). Запускать из корня репозитория на сервере.
# Проверяет активные уроки перед перезапуском контейнеров — иначе можно
# оборвать урок в процессе. --force пропускает эту проверку.

cd "$(dirname "$0")"

# Базовый compose-файл + прод-оверлей с раскладкой ядер (Э4.2, §10.3 ТЗ).
# Локальная разработка использует только базовый файл без COMPOSE_FILE.
export COMPOSE_FILE="docker-compose.yml:docker-compose.prod.yml"

FORCE=false
if [[ "${1:-}" == "--force" ]]; then
  FORCE=true
fi

echo "==> git pull"
git pull --ff-only

if [[ -f .env.egress ]] && ! command -v setfacl >/dev/null; then
  echo "ОТМЕНЕНО: нужен setfacl для прав на записи уроков — apt-get install -y acl"
  exit 1
fi

if [[ "$FORCE" == false ]]; then
  echo "==> Проверка активных уроков"
  # Статуса урока в Postgres нет (урок постоянный, Э12) — живое состояние
  # только в Redis presence. Прежний SQL по несуществующей колонке молча
  # давал «0 уроков», и деплой рвал идущий урок. Не смогли проверить —
  # не деплоим (fail-closed).
  if ! ROOM_KEYS=$(docker compose exec -T redis redis-cli --scan --pattern 'room:*:participants'); then
    echo "ОТМЕНЕНО: не удалось проверить активные уроки (Redis недоступен)."
    echo "Запусти с флагом --force, если уверен, что уроков нет."
    exit 1
  fi
  LIVE_COUNT=0
  for key in $ROOM_KEYS; do
    if docker compose exec -T redis redis-cli HVALS "$key" | grep -q '"connected":true'; then
      LIVE_COUNT=$((LIVE_COUNT + 1))
    fi
  done
  if [[ "$LIVE_COUNT" -gt 0 ]]; then
    echo "ОТМЕНЕНО: сейчас идёт $LIVE_COUNT активных урок(ов) — перезапуск оборвёт их."
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

# Запись на этом же хосте (`.env.egress`, см. docker-compose.egress.yml):
# egress пишет файлы под uid 1001, app удаляет их под uid 999 — без ACL
# удаление записи падает с EACCES. `d:` — права наследуют и будущие файлы;
# накатываем при каждом деплое, потому что пересозданный том их теряет.
if [[ -f .env.egress ]]; then
  ASSETS_DIR=$(docker volume inspect znat_assets_data --format '{{ .Mountpoint }}')
  echo "==> ACL на $ASSETS_DIR для app (999) и egress (1001)"
  setfacl -R -m u:999:rwx -m d:u:999:rwx -m u:1001:rwx -m d:u:1001:rwx "$ASSETS_DIR"
fi

echo "==> Готово. Статус контейнеров:"
docker compose ps
