# Экспериментальная запись уроков (raw-дорожки + журнал + отложенная сборка)

Статус: **прототип для сравнения с Egress**. Основная запись — по-прежнему
LiveKit Egress Room Composite (`recordings/service.ts`), метод по умолчанию.

## 1. Аудит (2026-10-12) — что есть в коде

Жизненный цикл текущей записи:

1. Учитель жмёт «Запись» → `POST /lessons/:id/recordings` →
   `startLessonRecording()` (права, `RECORDING_ENABLED`, настройка школы,
   «одна активная на урок») → `egress.startRoomRecording()` (Room Composite,
   шаблон `/egress`, recorder-токен в query) → строка `recordings`
   (`starting`) → WS `recording_status` (баннер согласия).
2. Статус едет вебхуками `egress_started/updated/ended` →
   `applyEgressWebhook()` → `applyEgressEvent()` (терминальный не
   откатывается, `ready` ставит длительность/размер/ретеншн, обложка ffmpeg).
3. Стоп: `POST …/stop` → `stopEgress` → `processing`, дальше вебхук.
4. Файл: `recordings/<school>/<lesson>/<id>.mp4` в `STORAGE_ROOT`, выдача
   только presigned `/files/...`; ретеншн — часовой свип.

Найденные дефекты основной записи:

- `reconcileRecording()` нигде не вызывается — потерянный вебхук оставляет
  запись в `starting/recording/processing` навсегда.
- Ошибка старта egress сразу 502 без повтора; при таймауте ответа egress мог
  всё же стартовать — строка не создаётся, файл пишется «в никуда».

Серверные точки, доступные для журнала (без новых клиентских соединений):

| Данные | Где на сервере |
|---|---|
| сцена, задания, presence, рука, закрепление, режим, демонстрация (claim) | `rooms/events.ts#emitRoomEvent` — все WS-сообщения урока, включая `activity_*` и `recording_status` из других модулей (`broadcastToLesson`) |
| состав LiveKit, публикация/снятие дорожек | вебхук `rooms/livekit-webhook.ts` (`participant_*`, `track_*`) |
| доска (Excalidraw в Y.Doc), страницы, PDF/слайды (страницы с `slide.imageUrl/pdfUrl`, TTL ссылок 30 дней) | Hocuspocus в процессе API (`canvas/hocuspocus.ts`): хук `onChange` (каждый Yjs-update), `onAwarenessUpdate` (viewport учителя) |
| вид задания в записи (без ключей и личных ответов) | `activities/service.ts#getRecorderView` |

Ограничения, проверенные по коду:

- Снимок доски в БД (`canvas_docs`) — только последнее состояние, дебаунс 3 с:
  для «состояния на момент t» нужен поток Yjs-updates, а не снимок.
- `RecorderActivityStage` опрашивает вид задания каждые 5 с — в записи
  прогресс класса и сейчас дискретен с шагом 5 с.
- Клиенты публикуют VP8 (simulcast) и Opus; демонстрация — VP8.

## 2. План изменений (минимальный безопасный срез)

Отдельно от новой архитектуры — **исправления основной записи**:
сверка зависших записей (`reconcileRecording` по таймеру), идемпотентный
повтор старта egress.

Новая архитектура — отдельный путь, своё состояние:

| Часть | Что |
|---|---|
| Выбор метода | таблица `lesson_recording_modes` (урок → `egress`/`experimental`/`both`) + env-допуск `RECORDING_EXPERIMENTAL_SCHOOL_IDS` + `RAW_RECORDER_SECRET`. Нет строки, школы нет в списке или пустой секрет → `egress` |
| Состояние | таблица `raw_recordings` (свои статусы, лизы, попытки, ошибки), не трогает `recordings` |
| Журнал | таблица `raw_recording_journal` (seq, серверное время, тип, payload/bytes); пишется только пока идёт экспериментальная запись урока |
| API | внутренние эндпоинты `/internal/raw-recorder/*` для рекордера и рендера (секрет), админские для режима урока, слияние в `GET /lessons/:id/recordings` |
| Рекордер | Go-сервис `services/raw-recorder` (`livekit/server-sdk-go`): скрытый участник, RTP как есть в 60-с чанки + время прихода + RTCP SR |
| Рендер | тот же бинарник, режим `render`: RTP → IVF/Ogg с выравниванием времени, кадры доски/задания через Chrome (страница `/recording-replay`, те же `Board` и вид задания), сборка ffmpeg, проверка ffprobe, атомарная публикация |
| Деплой | отдельный `docker-compose.raw-recorder.yml`, `deploy.sh` его не поднимает |
