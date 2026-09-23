#!/usr/bin/env bash
set -euo pipefail

# Бэкапы (Э0.10 ТЗ): pg_dump раз в сутки + restic на вторую площадку.
# Запускать из корня репозитория (systemd: WorkingDirectory). Переменные:
#   BACKUP_DIR — куда класть дампы (по умолчанию /var/backups/znat)
#   RESTIC_REPOSITORY, RESTIC_PASSWORD — вторая площадка (restic init один раз заранее).
#     Не заданы — делается только локальный дамп, с предупреждением: он лежит
#     на том же диске и от потери сервера не спасает.
#
# ВНИМАНИЕ: это логический дамп (pg_dump), не непрерывная WAL-архивация
# (PITR через wal-g/pgBackRest — известный пробел).

cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-/var/backups/znat}"
STAMP="$(date -u +%Y%m%d_%H%M%S)"
DUMP_FILE="${BACKUP_DIR}/school_dev_${STAMP}.dump"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "==> pg_dump -> ${DUMP_FILE}"
docker compose exec -T postgres \
  pg_dump -U school -d school_dev --format=custom --compress=9 \
  > "$DUMP_FILE.partial"

# Пустой или битый дамп хуже отсутствующего — его примут за бэкап.
docker compose exec -T postgres pg_restore --list < "$DUMP_FILE.partial" > /dev/null
mv "$DUMP_FILE.partial" "$DUMP_FILE"
echo "    размер: $(du -h "$DUMP_FILE" | cut -f1)"

if [[ -n "${RESTIC_REPOSITORY:-}" ]]; then
  ASSETS_DIR=$(docker volume inspect znat_assets_data --format '{{ .Mountpoint }}')
  echo "==> restic backup (дамп + assets из $ASSETS_DIR)"
  restic backup "$BACKUP_DIR" "$ASSETS_DIR" --tag "school-platform" --host "$(hostname)"

  echo "==> restic forget (14 ежедневных, 8 еженедельных, 6 ежемесячных)"
  restic forget --keep-daily 14 --keep-weekly 8 --keep-monthly 6 --prune

  KEEP_LOCAL_DAYS=3
else
  echo "ВНИМАНИЕ: RESTIC_REPOSITORY не задан — только локальный дамп на этом же диске," >&2
  echo "          файлы уроков (assets) не копируются. От потери сервера это не спасает." >&2
  KEEP_LOCAL_DAYS=14
fi

echo "==> Удаление локальных дампов старше ${KEEP_LOCAL_DAYS} дней"
find "$BACKUP_DIR" -name "school_dev_*.dump" -mtime +"$KEEP_LOCAL_DAYS" -delete
find "$BACKUP_DIR" -name "*.partial" -mmin +60 -delete

echo "==> Готово: ${DUMP_FILE}"
