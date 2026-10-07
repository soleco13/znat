# Логи и разбор проблем на уроке

Цель: если у одного человека на уроке пропало видео, WebSocket или доска —
найти причину по логу, без угадывания.

## Где лежат логи

| Что | Где | Сколько хранится |
|---|---|---|
| API (JSON, одна строка = событие) | `/var/log/znat/api.log` на хосте (+ `docker compose logs app`) | 7 дней / до 200 МБ на файл (`/etc/logrotate.d/znat`) |
| Медиасервер | `docker compose logs livekit` | пока жив контейнер (json-log) |
| Браузер | приходит в лог API событием `client_event` | как лог API |

`docker compose logs app` теряется при каждом пересоздании контейнера —
разбирать по файлу.

## Поля каждой строки

`time` (ISO-8601 UTC), `level` (`debug/info/warn/error/fatal`), `service`,
`env`, `version` (коммит сборки), `event`, `msg`, плюс контекст запроса:

| Поле | Что это |
|---|---|
| `requestId` | id HTTP-запроса; из `X-Request-Id` браузера или новый UUID; возвращается заголовком. При 500 — тот же `errorId` в ответе. |
| `clientSessionId` | вкладка браузера (новая при каждой загрузке страницы). Есть у запросов API, WS-подключений (`cs`) и клиентских событий. |
| `userId`, `schoolId` | персонал (после проверки токена) |
| `lessonId` | урок |
| `participantId` | userId персонала или guestId ученика. **Он же LiveKit identity** и ключ presence. |
| `connId`, `channel` | одно WS-подключение: `room` (события урока), `board` (доска), `recorder` |

Пароли, токены, куки, `Authorization` вырезаются (`[redacted]`), токен ссылки
урока в URL — `/j/[redacted]`, email — только `emailHash`.

## События

Сервер: `auth_success` / `auth_failure` (`method`: password, refresh,
guest_link; `reason`), `lesson_join_started` / `_success` / `_failed`
(`durationMs`, `reason`), `livekit_token_created` (`identity`, `livekitRoom`,
`canPublishSources`), `livekit_participant_joined` / `_left`
(`disconnectReason` — взгляд медиасервера), `websocket_connected` /
`_reconnect` / `_rejected` (`reason`) / `_disconnected` (`closeCode`,
`durationMs`), `whiteboard_sync_started` / `_failed` (`stage`: auth, load),
`whiteboard_store_failed`, `whiteboard_update_rejected`, `request_rejected`
(любой 4xx с `code`), `request_failed` (5xx со стеком), `db_query_slow` /
`db_query_failed` (SQL без параметров), `db_pool_error`,
`background_task_failed` (`task`), `process_unhandled_rejection` /
`process_uncaught_exception`, `http_request` (одна строка на запрос).

Браузер (`event: client_event`, имя в `clientEvent`, время браузера в
`clientTs`): `livekit_connection_started` / `_connected` /
`_connection_failed` / `_reconnecting` / `_reconnected` / `_disconnected`
(`reason`), `websocket_disconnected` (`closeCode`, `connectedMs`, `online`) /
`websocket_reconnect`, `whiteboard_sync_started` / `_synced` (`durationMs`) /
`_sync_failed` (`stage`: auth, stall) / `_disconnected`, `pdf_load_started` /
`pdf_loaded` / `pdf_load_failed` (`stage`, `status`), `client_error`.

## Рецепты

Все события одного ученика на уроке (participantId — из списка участников
или из `lesson_join_success`):

```sh
grep '"participantId":"<guestId>"' /var/log/znat/api.log | jq -c '{time,event,clientEvent,reason,closeCode,durationMs,connId}'
```

Вся вкладка (запросы + WS + браузер), если известен clientSessionId:

```sh
grep '"clientSessionId":"<id>"' /var/log/znat/api.log | jq -c '{time,event,clientEvent,requestId,statusCode,reason}'
```

Цепочка «вход → медиа»: `lesson_join_success` → `livekit_token_created`
(identity) → клиентский `livekit_connected` → `livekit_participant_joined`
(медиасервер). Чего нет в цепочке — там и сломалось. Медиасервер о том же
человеке: `docker compose logs livekit | grep <identity>`.

Пропало видео: `livekit_reconnecting` / `livekit_disconnected` (`reason`) у
клиента и `livekit_participant_left` (`disconnectReason`) у сервера;
`online:false` — пропала сеть у самого ученика.

Пропала доска: `websocket_disconnected` с `channel:"board"` (код закрытия),
`whiteboard_sync_failed` (`stage`), `whiteboard_update_rejected`.

Ошибка 500 у пользователя: `errorId` из ответа = `requestId`:

```sh
grep '"requestId":"<errorId>"' /var/log/znat/api.log
```

Медленно: `db_query_slow` с тем же `requestId`, `http_request` с
`durationMs`, метрика `db_pool_connections{state="waiting"}`.
