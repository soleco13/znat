#!/usr/bin/env bash
set -euo pipefail

# Бэкапы (Э0.10 ТЗ): pg_dump раз в сутки + restic на вторую площадку.
# Требует переменных окружения (см. .env на сервере):
#   RESTIC_REPOSITORY, RESTIC_PASSWORD — куда и чем шифровать (restic init один раз заранее)
#   RESTIC_SSH_KEY (опционально) — если репозиторий по sftp/rest поверх SSH
#
# Правило 3-2-1: дамп БД + /data/assets кладём в /data/backups (копия 1, локально),
# затем restic отправляет их на вторую площадку (копия 2, вне основной, шифрованная).
#
# ВНИМАНИЕ: это логический дамп (pg_dump), не непрерывная WAL-архивация.
# Непрерывный PITR (wal-g/pgBackRest continuous archiving) — известный пробел,
# требует настройки archive_command на реальном сервере и второй площадки;
# не настраивался в этой сессии из-за отсутствия доступа к боевой инфраструктуре.

BACKUP_DIR=/data/backups
STAMP="$(date -u +%Y%m%d_%H%M%S)"
DUMP_FILE="${BACKUP_DIR}/school_dev_${STAMP}.dump"

mkdir -p "$BACKUP_DIR"

echo "==> pg_dump -> ${DUMP_FILE}"
docker compose exec -T postgres \
  pg_dump -U school -d school_dev --format=custom --compress=9 \
  > "$DUMP_FILE"

echo "==> restic backup (дамп + assets)"
restic backup "$BACKUP_DIR" /data/assets \
  --tag "school-platform" \
  --host "$(hostname)"

echo "==> restic forget (хранить 14 ежедневных, 8 еженедельных, 6 ежемесячных)"
restic forget --keep-daily 14 --keep-weekly 8 --keep-monthly 6 --prune

echo "==> Удаление локальных дампов старше 3 дней (в restic они уже есть)"
find "$BACKUP_DIR" -name "school_dev_*.dump" -mtime +3 -delete

echo "==> Готово: ${DUMP_FILE}"
