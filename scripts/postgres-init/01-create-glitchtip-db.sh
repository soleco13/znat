#!/usr/bin/env bash
set -euo pipefail

# Выполняется автоматически Postgres-образом при первом старте (пустой /var/lib/postgresql/data).
# Заводит отдельную БД для GlitchTip (Э0.11) на том же инстансе Postgres —
# без отдельного контейнера БД под мониторинг.

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
  SELECT 'CREATE DATABASE glitchtip OWNER ${POSTGRES_USER}'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'glitchtip')\gexec
EOSQL
