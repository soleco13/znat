# Текущий этап: Э0 — Скелет и эксплуатация

Начато: 2026-08-23

## Стоп-лист Э0

```
НЕ делать на этом этапе:
- никакого LiveKit, WebRTC, медиа
- никаких WebSocket
- никакой доски, Yjs, Excalidraw
- никаких заданий и материалов
- никакой красивой вёрстки — только работающие формы
- никаких аватарок, тем оформления, анимаций
- не заводить таблицы materials/activities/responses (они в Э8)
```

## Задачи

- [x] Э0.1 Монорепо pnpm: apps/web, apps/api, packages/shared, dependency-cruiser
- [x] Э0.2 docker-compose.yml: app, postgres, redis, caddy — написан, **не проверен
      `docker compose up`**: в этом окружении нет Docker (ни в bash, ни в PowerShell).
      Нужно поднять руками и подтвердить.
- [x] Э0.3 Drizzle: schools, users, groups, group_members, lessons + миграции
      (`apps/api/drizzle/0000_gifted_ink.sql` сгенерирован и вычитан)
- [x] Э0.4 Auth: Argon2id, access JWT 15 мин, refresh httpOnly-cookie с ротацией
      и отзывом всей цепочки при повторном использовании токена, RBAC
- [x] Э0.5 StorageAdapter + LocalFS (HMAC-подписанные ссылки), S3Adapter-заглушка
- [x] Э0.6 CRUD пользователей/групп/уроков, CSV-импорт класса
- [x] Э0.7 Каркас фронта: роутинг, layout, api-client с автоматическим рефрешем
      токена. Шрифты — системный стек, самохостед webfont ещё не добавлен (TODO)
- [~] Э0.8 Сервер: `scripts/server-setup.sh` (ufw/SSH), `Caddyfile.prod`,
      `deploy.sh` (с проверкой активных уроков) — написаны, **не выполнялись**:
      нет доступа к реальному серверу/домену. Нужны данные от пользователя.
- [~] Э0.9 `.github/workflows/ci.yml` и `mirror.yml` — написаны, **не запускались**:
      нет GitHub-репозитория/секретов в этой сессии.
- [~] Э0.10 `scripts/backup.sh` + `scripts/restore-drill.sh` (systemd timer) —
      написаны. Это логический pg_dump + restic, **не непрерывная WAL-архивация**
      (wal-g/pgBackRest continuous archiving) — известный пробел, нужен реальный
      сервер и вторая площадка, чтобы настроить и прогнать restore-drill по-настоящему.
- [x] Э0.11 Мониторинг: `docker-compose.monitoring.yml` (Prometheus + alerts,
      postgres/redis exporters, Alertmanager → ntfy, Grafana с провижном
      дашборда, Loki + Promtail, GlitchTip на общем postgres/redis) — написан,
      не запускался (см. Э0.2). UptimeRobot — внешний сервис, нужен аккаунт
      пользователя и публичный домен.

## Известные пробелы (нужны от пользователя)

1. **Docker/docker-compose не установлен в этой среде** — `docker-compose.yml`,
   `docker-compose.monitoring.yml`, `Dockerfile` не запускались вживую. Нужно
   поднять `docker compose up` руками и подтвердить, что всё стартует.
2. **Реального сервера/домена нет** — Э0.8 (ufw/SSH/Let's Encrypt/deploy.sh),
   учебное восстановление на «чистой машине», UptimeRobot требуют доступа
   к арендованному серверу (§10.1 ТЗ) и домена.
3. **Второй площадки для бэкапов нет** — `RESTIC_REPOSITORY`/`RESTIC_PASSWORD`
   не заданы, restore-drill не прогонялся по-настоящему, RTO не измерен.
4. **GitHub-репозитория нет** — CI и push-зеркало не проверялись в бою.
5. Node локально v20.18, план требует Node 22 — для `pnpm install`/`build`
   это не помешало (только warning), но стоит обновить перед реальным CI/деплоем.
6. Self-hosted webfont не добавлен — используется системный шрифтовой стек
   (не CDN, так что правилу независимости не противоречит, но не то, что описано в §10.10 как "свой шрифт").

## Гейт Э0

- 200 одновременных HTTP-сессий (логин + список уроков) — **не прогонялся**
  (нужен `docker compose up` + k6/autocannon)
- p95 ответа API < 200 мс — метрика инструментирована (`/metrics`,
  `HighApiLatencyP95` в Prometheus), но не измерена под нагрузкой
- RAM процесса app < 1 ГБ — инструментировано (`AppMemoryHigh`), не измерено
- восстановление из бэкапа на чистой машине выполнено, время записано —
  **не выполнено**, см. пробел №3
