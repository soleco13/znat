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

- [ ] Э0.1 Монорепо pnpm: apps/web, apps/api, packages/shared, dependency-cruiser
- [ ] Э0.2 docker-compose.yml: app, postgres, redis, caddy
- [ ] Э0.3 Drizzle: schools, users, groups, group_members, lessons + миграции
- [ ] Э0.4 Auth: Argon2id, access JWT 15 мин, refresh httpOnly-cookie, RBAC
- [ ] Э0.5 StorageAdapter + LocalFS, S3Adapter-заглушка
- [ ] Э0.6 CRUD пользователей/групп/уроков, CSV-импорт класса
- [ ] Э0.7 Каркас фронта: роутинг, тема, layout, api-client
- [ ] Э0.8 Сервер: ufw, SSH, Caddy+Let's Encrypt, deploy.sh
- [ ] Э0.9 GitHub Actions + push-зеркало
- [ ] Э0.10 Бэкапы wal-g + restic, учебное восстановление
- [ ] Э0.11 Мониторинг: Prometheus, Grafana, Loki, GlitchTip, ntfy, UptimeRobot

## Гейт Э0

- 200 одновременных HTTP-сессий (логин + список уроков)
- p95 ответа API < 200 мс
- RAM процесса app < 1 ГБ
- восстановление из бэкапа на чистой машине выполнено, время записано
