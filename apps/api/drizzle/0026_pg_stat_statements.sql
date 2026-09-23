-- Статистика запросов для поиска медленных мест под нагрузкой урока (нужен shared_preload_libraries в docker-compose.yml).
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
