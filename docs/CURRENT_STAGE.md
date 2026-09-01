# Текущий этап: Э5 — Видео учителя

Начато: 2026-09-01, новая сессия (`/clear`) — по правилу «один этап = один
контекст» (§1.1 ПЛАН.md) это отдельный контекст от Э3/Э4. Э4 (Слайды)
полностью закрыт технически (все 9 задач Э4.1–Э4.9, 114/114 тестов бэкенда
на момент закрытия; гейт Э4 с реальной нагрузкой не прогнан — нет Docker в
этой среде, см. архив Э4 ниже и памятку project-video-platform-env-gaps).
Как и на Э4, live-проверка через `docker compose up`/`livekit-cli
load-test` в этой среде невозможна — упор на typecheck/юнит-тесты/чтение
исходников LiveKit SDK, полная проверка (нагрузочный тест, гейт) — на
Linux. Решение пользователя (см. память) по-прежнему в силе: отсутствие
Docker не блокирует переход между этапами.

**Область «не делегировать вслепую» (CLAUDE.md) покрывает весь этап Э5**:
WebRTC/LiveKit-конфиги и логика прав/выдачи токенов — это ровно
`media/service.ts` (гранты токенов) и клиентские опции `<LiveKitRoom>`
(`apps/web/src/features/room/RoomPage.tsx`). Каждая задача этой области
читается и пишется построчно самим Claude Code в этой сессии, не через
делегирование сабагентам.

## Стоп-лист Э5

```
НЕ делать на этом этапе:
- НЕ включать камеры учеников. Ни одной. Даже "для теста".
- НЕ делать сетку плиток — учитель один, плитка одна
- НЕ делать виртуальные фоны и блюр (дорого по CPU клиента, это Э11)
- НЕ делать демонстрацию экрана — это Э7
```

## Задачи

- [x] Э5.1 Публикация видео учителем: 720p, simulcast 720/360/180.
- [ ] Э5.2 `adaptiveStream` и `dynacast` включены.
- [ ] Э5.3 Плитка учителя в UI: закрепление, сворачивание, режим «только доска».
- [ ] Э5.4 Выбор камеры в проверке устройств, превью до входа.
- [ ] Э5.5 Деградация: при packet loss > 5% автоматически предложить выключить видео.
- [ ] Э5.6 Замер и запись фактических цифр в документацию.

## Гейт Э5

```bash
livekit-cli load-test --rooms 10 --publishers 1 --subscribers 19 \
  --video-publishers 1 --video-resolution 720p
Ожидаем:
- исходящий трафик < 350 Мбит/с   ← примерно половина бюджета
- CPU ядер LiveKit < 40%
- аудио не деградировало
Записать фактические цифры. Они определяют планку Э6.
```

## MCP под Э5

Постоянный набор (Context7, Playwright, GitHub) + **Grafana MCP** (гейт:
исходящий трафик и CPU ядер 0-3 за окно нагрузочного теста) + **Chrome
DevTools MCP** (проверка, что `adaptiveStream` реально понижает слой на
маленькой плитке — Э5.2). Сам `livekit-cli load-test` — из терминала, не
через MCP. Ни Grafana, ни Chrome DevTools MCP не доступны в этой среде —
задел на Linux-сессию.

## Что сделано технически (Э5.1)

- **Камера учителя разрешена РОЛЬЮ на уровне LiveKit-гранта, не отдельным
  переключаемым правом** (§5.2 ТЗ: «камера учителя — всегда», в отличие от
  `canSpeak`, который явно тумблер в `ParticipantPermissions`). Заводить
  `canCamera` в `participantPermissionsSchema` не стали осознанно — это
  было бы лишней настройкой без продуктового смысла (учитель не может сам
  себе запретить доступ к камере, а ученику её и не с чем разрешать до Э6).
- **`media/service.ts#buildPublishGrant(permissions, role)`** — сигнатура
  выросла на `role: Role` (общая функция для `createParticipantConnection`
  при выдаче токена и `updateLivePermissions` при живом обновлении гранта,
  оба места правились синхронно, как и раньше в Э2.5). Источники в
  `canPublishSources`: `MICROPHONE` всегда, `CAMERA` добавляется, если
  `role === "teacher" || role === "admin"` — тот же критерий `isTeacher`,
  что уже используется на фронте (`RoomPage.tsx`). `canPublish` теперь
  `permissions.canSpeak || canPublishCamera` — учитель с гипотетическим
  `canSpeak: false` (в проде недостижимо, `defaultPermissions` даёт
  учителю оба права `true`, но тип это не гарантирует) всё равно сможет
  публиковать камеру.
- **`role` пробрасывается из `rooms/service.ts`, а не запрашивается заново.**
  И `join()` (создание токена), и `updatePermissions()` (живое обновление)
  уже читают presence-запись участника (`entry.role`) — тот же `Role`, что
  был записан при входе (`presence.defaultPermissions(user.role)`), лишнего
  похода в БД не потребовалось.
- **Демонстрация экрана по-прежнему не входит ни в один грант** —
  `TrackSource.SCREEN_SHARE` не добавлен нигде, стоп-лист Э5 и §5.2 ТЗ (Э7)
  соблюдены, отдельным тестом зафиксировано (`media/service.test.ts`).
- **Клиент — `apps/web/src/features/room/RoomPage.tsx`**: новый
  `ROOM_OPTIONS: RoomOptions` (модульная константа, не JSX-инлайн — чтобы
  `<LiveKitRoom options=…>` не пересобирала комнату на каждый рендер
  родителя) — `videoCaptureDefaults.resolution = VideoPresets.h720.resolution`
  (720p, §5.2 ТЗ) и `publishDefaults.simulcast = true`. **`videoSimulcastLayers`
  сознательно не задан явно** — прочитан установленный исходник
  `livekit-client@2.22.0` (`dist/src/options.d.ts` /
  `room/track/options.d.ts`): при пустом поле SDK сам подставляет
  `[h180, h360]`, что вместе с capture-резолюцией 720p даёт ровно требуемые
  три слоя simulcast (720/360/180) без ручного дублирования констант,
  которые могли бы разойтись с будущим апгрейдом пакета. Отмечено
  комментарием в коде, а не тихим умолчанием — тот же принцип, что и в
  Э3.1 с Hocuspocus (читать реальный исходник SDK, а не только доки).
  `<LiveKitRoom video={isTeacher ? { resolution: VideoPresets.h720.resolution } : false}>` —
  публикация видео стартует автоматически при входе для роли учитель/админ
  (тот же паттерн автозапуска, что уже был у `audio` для `canSpeak`), а не
  требует ручного первого включения — расхождение с осторожным вариантом
  «выключено по умолчанию, включает сам» было отклонено ради симметрии с
  уже работающим аудио-путём и потому что автозапуск камеры не эскалирует
  риск (сервер и так уже разрешает источник только этой роли).
- **`apps/web/src/features/room/CameraControls.tsx`** — новый файл,
  `SelfCameraButton` по образцу `SelfMicButton` (`MicControls.tsx`):
  `useLocalParticipant().localParticipant.setCameraEnabled(!isCameraEnabled,
  { resolution: VideoPresets.h720.resolution })`. Ручной тумблер поверх
  автозапуска — учитель может выключить камеру (например, на время показа
  доски без лица в кадре — предвестник режима «только доска» из Э5.3, но
  сама эта задача ещё не сделана) и включить обратно с той же резолюцией.
- **`apps/web/src/features/room/TeacherVideoTile.tsx`** — новый файл,
  плитка в углу экрана (`fixed bottom-4 right-4`). Рендерится ВСЕМ
  участникам урока (не только ученикам) — просто и корректно: раз источник
  CAMERA в гранте LiveKit есть только у роли учитель/админ, любой
  опубликованный трек камеры в комнате — это и есть учитель, искать
  участника по `identity`/роли на клиенте не требуется. Стоп-лист Э5
  («плитка одна, сетки нет») соблюдён самой архитектурой гранта: даже если
  в уроке два со-учителя с ролью `teacher`, `tracks[0]` рендерит только
  первый найденный трек — сценарий на будущее (пока в проде один учитель на
  урок), не разрастание в сетку.
- Кнопка `SelfCameraButton` подключена в `RoomPage.tsx` рядом с
  `SelfMicButton`/«Заглушить всех» — видна только `isTeacher`.
- **Тесты** (`apps/api/src/modules/media/service.test.ts`, было 11, стало
  15 — реструктурированы под роль, не только добавлены): `canPublish`
  ученика по-прежнему повторяет `canSpeak`; источник ученика жёстко
  `["microphone"]`; учитель получает `camera` в источниках даже при
  `canSpeak: false`; то же для `admin`; `screen_share` не входит ни в один
  грант; то же для живого `updateLivePermissions` — источники `CAMERA`
  добавляются учителю, `canPublishSources` ученика остаётся только
  `MICROPHONE`. `apps/api/src/modules/rooms/service.test.ts` — существующий
  тест на живую синхронизацию гранта дополнен четвёртым аргументом `role`.
  Итого 118/118 бэкенда (было 114, реструктурировано +4).
- **Проверки**: `pnpm --filter @school/api typecheck`, `pnpm --filter
  @school/web typecheck`, `pnpm build` (api + web + converter), `pnpm test`
  (118/118), `pnpm depcheck` (147 модулей, 368 связей, 0 нарушений) —
  зелёные. Новых зависимостей нет — `livekit-client`/`@livekit/components-react`
  уже были в `apps/web` с Э2 (аудио), Э5.1 использует их существующие
  video-API.
- **Не проверено и не могло быть в этой среде**: реальная публикация камеры
  браузером в живой LiveKit-комнате (нет Docker/livekit-server); что
  simulcast действительно даёт три RTP-потока на стороне SFU, а не только
  запрошен клиентом; рендер `TeacherVideoTile` против настоящего видеотрека
  (компонент собирается, `useTracks`/`VideoTrack` — библиотечные, логика
  фильтрации по `Track.Source.Camera` не покрыта тестами — `apps/web` без
  тестового раннера на компонентах, как и раньше в этом проекте, тестами
  покрыт только `apps/api`). Первая живая проверка — на Linux при `docker
  compose up`, гейт Э5 — там же (`livekit-cli load-test`).

---

# Архив: Э4 — Слайды (завершён 2026-09-01)

## Стоп-лист Э4

```
НЕ делать на этом этапе:
- НЕ пытаться сохранить анимации и переходы PowerPoint. Их не будет. Точка.
- НЕ рендерить PPTX в браузере (pptx-renderer) — это запасной план на потом
- НЕ делать SVG-конвертацию — PNG@2x надёжнее для MVP
- НЕ делать экспорт урока с аннотациями — это Э11
- НЕ давать конвертеру доступ в интернет ни при каких обстоятельствах
- НЕ добавлять видео (оно всё ещё выключено)
```

## Задачи

- [x] Э4.1 Контейнер `converter`: LibreOffice + Poppler + ClamAV. Сеть
      `internal: true` только до Redis, `read_only`, `cap_drop: ALL`, `tmpfs`.
- [x] Э4.2 `cpuset` и `cpu_quota` для всех контейнеров по §10.3 ТЗ. Ядра
      LiveKit эксклюзивны. (§ «Чего не урезать никогда» — раскладка ядер.)
- [x] Э4.3 Пайплайн BullMQ, `concurrency: 1`: скан → `soffice --convert-to
      pdf` → `pdftoppm` → PNG@2x + JPEG-превью → `StorageAdapter`.
- [x] Э4.4 Прогресс конвертации в UI через WS: «7 из 24».
- [x] Э4.5 Дедупликация по `sha256`: та же презентация конвертируется один раз.
- [x] Э4.6 Импорт слайдов как страниц холста, лента миниатюр, навигация.
- [x] Э4.7 Прямая загрузка PDF без конвертации (pdf.js для превью).
- [x] Э4.8 Текстовый слой из `pdftotext -bbox`: поиск по презентации.
- [x] Э4.9 Заметки докладчика — видны только учителю.

## Гейт Э4 (самый важный для монолита)

```
Сценарий: 5 активных уроков с аудио и доской.
Во время них загружается PPTX на 40 слайдов.
Обязательно: packet loss аудио не вырос (< 1%); джиттер аудио не вырос;
event loop lag app не вырос; CPU ядер 0-3 (LiveKit) не затронут;
конвертация < 90 сек.
Если аудио дёрнулось — вернуться к Э4.2 и ужесточить квоты. Дальше не идти.
```

## Что делегировать осторожно (Э4)

`docker-compose.yml` (converter, cpuset/cpu_quota, internal-сеть) — область
из списка «не делегировать вслепую» CLAUDE.md. Раскладка ядер (Э4.2) —
из списка «чего не урезать никогда» ПЛАН.md. Конвертер и воркеры/очереди
(Э4.1, Э4.3) — делегируются смело.

## Новые зависимости под Э4

- `bullmq@^6.3.2` — **согласовано и добавлено** (Э4.3), в `apps/api` и
  `services/converter`. Пайплайн конвертации.
- `pdfjs-dist@^4.10.38` — **согласовано и добавлено** (Э4.7), в `apps/web`.
  Рендер страниц PDF в браузере; воркер бандлится Vite локально (`?worker`),
  ничего с чужих CDN. Взят v4 (`node >=20`), не v6 (`node >=22.13`) —
  локальная среда разработки на Node 20.
- LibreOffice/Poppler/ClamAV — системные пакеты в образе `converter`, не
  npm-зависимости.
- `sharp`/`cwebp` в конвертер НЕ добавляли — превью слайдов рендерит тот же
  `pdftoppm` (JPEG на низком DPI), лишняя зависимость в air-gapped-образ не
  нужна.

## MCP под Э4

Постоянный набор (Context7, Playwright, GitHub) + **Grafana MCP** (главный
инструмент гейта: сравнение джиттера/packet loss аудио до и во время
конвертации). Chrome DevTools можно отключить. Для `docker stats`, проверки
`cpuset` и логов конвертера — обычный bash.

---

## Что сделано технически (Э4.1)

- **Новый workspace-пакет `services/converter/`** (не `apps/*` — следуя
  раскладке §4.1.1 ТЗ, где конвертер лежит отдельно от приложений).
  `pnpm-workspace.yaml` пополнен `services/*`. `@school/converter` —
  приватный, `type: module`, компилируется `tsc` в `dist/` (как `apps/api`,
  не `--noEmit`, т.к. это исполняемый процесс, а не потребляемый как
  TS-исходник пакет типа `@school/shared`).
- **Зависимостей — ноль** (осознанно). Каркас процесса на голом Node 22
  stdlib + глобальный `fetch`. BullMQ-воркер (пайплайн: скан → `soffice` →
  `pdftoppm` → PNG/WebP → `StorageAdapter`) — это Э4.3; там же будет
  запрошено согласование `bullmq`. Э4.1 по формулировке ПЛАН.md — только
  «контейнер собирается, наружу не ходит».
- `services/converter/src/index.ts` — на старте делает **самопроверку
  среды**, а не просто висит:
  1. `checkBinaries()` — `soffice`, `pdftoppm`, `pdfinfo`, `pdftotext`,
     `clamscan` реально запускаются с флагом версии. `ENOENT` → фатально
     (образ собран неверно). Ненулевой код выхода (poppler-утилиты на `-v`
     выходят с 99) — это НЕ ошибка, бинарник найден.
  2. `assertNoInternet()` — пробует достучаться до `api.github.com` и
     `1.1.1.1` (таймаут 3 с). Успех = **сломанная изоляция**, логируется
     громким `warn` (но процесс не падает — единственная граница это
     конфиг docker-сети, не этот код). Ожидаемо оба запроса падают
     (нет DNS/маршрута), лог `network isolation confirmed`.
  3. Дальше — heartbeat раз в минуту (`rssMb`) + чистое завершение по
     `SIGTERM`/`SIGINT`. Структурные JSON-логи в stdout/stderr.
- **`services/converter/Dockerfile`** — многостадийный, контекст сборки =
  корень монорепо (`docker compose` передаёт `context: .`), чтобы
  `pnpm install --frozen-lockfile` видел workspace и единый lockfile (тот
  же приём, что в корневом `Dockerfile`; поэтому копируются все четыре
  манифеста пакетов). Рантайм-слой: `node:22-bookworm-slim` +
  `libreoffice-impress`/`libreoffice-writer` + `poppler-utils` + `clamav` +
  шрифты (`fonts-liberation2`, `fonts-dejavu`, `fonts-noto-core`,
  `fonts-noto-cjk` — покрытие кириллицы для рендера слайдов). Непривилег.
  пользователь `app`. `HOME=/tmp` — LibreOffice под `read_only` rootfs
  держит профиль во writable-каталоге, а единственный writable — tmpfs
  `/tmp`.
- **ClamAV в air-gapped-контейнере**: `freshclam` качает сигнатурную базу
  **на этапе сборки образа** (у сборки интернет есть) и запекает её в
  образ. В рантайме `convnet` (`internal: true`) не даёт выхода наружу —
  `freshclam` там невозможен и не нужен; база освежается пересборкой
  образа (ночной ре-деплой). `freshclam` в Dockerfile завершается ошибкой,
  если базу скачать не удалось (не тихий пропуск).
- **`docker-compose.yml`** (область «не делегировать вслепую» — правки
  показаны построчно):
  - новая сеть `convnet: { internal: true }` — без маршрута наружу (§10.3);
  - `redis` теперь в двух сетях: `default` (app, миграции) и `convnet`
    (только converter);
  - сервис `converter`: `build.context: .` +
    `dockerfile: services/converter/Dockerfile`; `networks: [convnet]`
    (видит только redis); `read_only: true`; `cap_drop: [ALL]`;
    `security_opt: ["no-new-privileges:true"]`; `tmpfs: ["/tmp:size=2g"]`;
    `mem_limit: 3g` (§10.3); том `assets_data:/data/assets`;
    `depends_on: redis (healthy)`.
  - `cpuset`/`cpu_quota` СОЗНАТЕЛЬНО НЕ добавлены — это отдельная задача
    Э4.2 (раскладка ядер для ВСЕХ контейнеров, из списка «не урезать
    никогда»).
- `package.json` корня: `depcheck` теперь сканирует и
  `services/converter/src`.
- **Проверки**: `pnpm -r typecheck` — зелёно (5 пакетов); `pnpm build`
  собирает converter (`tsc` → `dist/`); `pnpm test` — 90/90 бэкенда без
  изменений (Э4.1 не трогает `apps/api`); `pnpm depcheck` — 126 модулей,
  без нарушений; `docker-compose.yml` — валидный YAML (проверен парсером;
  `docker compose config` недоступен — нет Docker).
- **Не проверено и не могло быть в этой среде**: реальная сборка образа
  (apt-слой ~1,5 ГБ + `freshclam`), фактическая недостижимость интернета
  из контейнера (`assertNoInternet` против настоящей `convnet`), запуск
  `soffice --headless` под `read_only`+`cap_drop: ALL`. Всё это — на
  Linux-сервере при первом `docker compose build/up`.

## Что сделано технически (Э4.2)

- **Раскладка ядер вынесена в отдельный оверлей `docker-compose.prod.yml`,
  не в базовый файл** — осознанно. `cpuset: "0-3"` и т.п. привязаны к
  8-ядерной машине; в базовом `docker-compose.yml` это сломало бы
  `docker compose up` на любой машине разработчика с <8 ядрами (там
  postgres/redis/app/caddy реально поднимаются локально, в отличие от
  livekit/coturn с host-сетью). Тот же приём разделения, что уже был для
  `Caddyfile`/`Caddyfile.prod` и `docker-compose.monitoring.yml`.
- `docker-compose.prod.yml` (по таблице §10.3 ТЗ, 8 ядер):
  - `livekit` + `coturn` → `cpuset: "0-3"` ЭКСКЛЮЗИВНО (медиа чувствительно
    к джиттеру планировщика; конвертация не должна делить с ними ядра);
  - `app` → `cpuset: "4-5"`;
  - `postgres` + `redis` → `cpuset: "6"`;
  - `converter` → `cpuset: "7"` + `cpu_quota: 80000` (period по умолчанию
    100000 мкс → не больше 0.8 ядра даже при очереди);
  - `caddy` → `cpuset: "7"` + `cpu_quota: 20000` (0.2 ядра).
  Заголовок файла явно говорит «пересчитать под своё железо».
- `deploy.sh`: `export COMPOSE_FILE="docker-compose.yml:docker-compose.prod.yml"`
  в начале — все последующие `docker compose` (build / run миграций /
  up -d / ps) автоматически берут оба файла. Локальная разработка
  `COMPOSE_FILE` не ставит → только базовый файл, раскладки ядер нет.
- **Мониторинг** (`docker-compose.monitoring.yml`) по §10.3 тоже должен
  быть на ядре 7 с квотой ~0.2 — но его `cpuset` не задан: файл
  запускается отдельной командой и используется локально (Grafana MCP на
  Э4). Оставлено на потом отдельным оверлеем; экспортёры почти не едят CPU.
  Зафиксировано комментарием в `docker-compose.prod.yml`.
- **Проверки**: `docker-compose.prod.yml` — валидный YAML, все 7 сервисов
  оверлея существуют в базовом файле (проверено парсером); `bash -n
  deploy.sh` — синтаксис ок. **Не проверено**: реальный `docker compose
  -f ... -f ...` merge и то, что ядра действительно пиннятся (`docker
  inspect` → `CpusetCpus`) — нет Docker, только на Linux-сервере. Гейт Э4
  (конвертация 40 слайдов во время 5 уроков не роняет аудио) тоже
  проверяется только там.

## Что сделано технически (Э4.3)

- **`bullmq@^6.3.2` — согласовано с пользователем**, добавлено в `apps/api`
  (producer + слушатель событий) и `services/converter` (worker). Схемы
  контракта очереди уже были в `packages/shared/src/decks.ts` из
  предыдущего коммита (Zod: `ConvertJobData/Result/Progress`,
  `CONVERT_QUEUE_NAME`), плюс таблицы `decks`/`deck_slides` + миграция 0003.
- **`jobId` задачи === `deckId`** (задача 1:1 с презентацией): событие
  `QueueEvents` несёт только `jobId`, а так по нему сразу известен `deckId`
  без похода за `job.data`. Заодно бесплатная защита от двойной постановки.
- **`connection` в BullMQ — объектом опций `{ url, maxRetriesPerRequest:
  null }`, а не готовым ioredis-клиентом** (проверено по типам
  установленного `bullmq@6.3.2`: `RedisOptions extends { url?: string }`).
  Тогда соединения создаёт и закрывает сам BullMQ на `.close()` — не нужно
  вручную считать дубликаты соединений для `Queue`/`QueueEvents`/`Worker`.
- **`apps/api/src/modules/jobs/service.ts`** — инфраструктура очереди
  (§4.1.1 ТЗ). НЕ знает про `decks`: `startConvertEvents(handlers)`
  принимает колбэки, персистентность делает вызывающий (`server.ts` →
  `decksService.buildConvertJobHandlers()`). Поэтому зависимость только
  `decks → jobs`, цикла нет (подтверждено `depcheck`: 137 модулей, 0
  нарушений). `attempts: 1` — конвертация недоверенного файла не
  авторетраится (на битом .pptx повтор упадёт так же).
- **`apps/api/src/modules/decks/`** (`repo.ts`/`service.ts`/`routes.ts`) —
  новый модуль. `createDeckFromUpload`: валидация mime
  (`deckSourceMimeTypeSchema` — pptx/odp/docx/pdf), проверка «учитель этого
  урока или админ», sha256 исходника (в колонку — под дедуп Э4.5, но сам
  дедуп ещё не включён), сохранение через `storageService`, строка `decks`
  (status `pending`), `enqueueConvert`. `listDecks`/`getDeckStatus` —
  доступны любому участнику урока; `deleteDeck` — учителю/админу, чистит и
  файлы слайдов, и исходник (после строки БД: осиротевший файл безопаснее
  строки со ссылкой на удалённый файл).
- Роуты (§8.1 ТЗ): `POST /lessons/:id/uploads` (multipart → `{deckId,
  jobId, status}`), `GET /lessons/:id/decks`, `DELETE
  /lessons/:id/decks/:deckId`, `GET /jobs/:jobId`. **`/jobs/:jobId` живёт
  в `decks/routes.ts`, не в отдельном `jobs/routes.ts`** — иначе была бы
  зависимость `jobs → decks` в пару к уже существующей `decks → jobs` =
  цикл. `jobId === deckId`, статус читается из строки `decks` (переживает
  удаление задачи из Redis по `removeOnComplete`).
- **`services/converter`** — из каркаса Э4.1 стал воркером:
  - `contract.ts` — ЛОКАЛЬНАЯ копия контракта очереди (~25 строк типов + имя
    очереди). Конвертер СОЗНАТЕЛЬНО не тянет `@school/shared` (у пакета
    `main` — TS-исходник без сборки): держим рантайм контейнера тонким.
    Тот же контролируемый дубляж, что canvas↔rooms в Э3.1 — при правке
    контракта в shared синхронно править здесь.
  - `storage.ts` — мини-адаптер LocalFS (не импорт из `apps/api` — граница
    модулей + отдельная сборка). Правило CLAUDE.md «файлы только через
    адаптер» соблюдено: `convert.ts` в ФС ходит только через него.
  - `convert.ts` — пайплайн: `clamscan` (код 1 = вирус → фейл) → PDF ли
    исходник, иначе `soffice --headless --convert-to pdf` c
    `-env:UserInstallation` в per-job каталоге под `/tmp` → `pdfinfo`
    (число страниц, потолок 500) → по каждой странице `pdftoppm -png -r
    144` (PNG@2x) + `pdftoppm -jpeg -r 32` (превью) → `storage.putPath` →
    `job.updateProgress({done,total})`. Размеры PNG читаются из IHDR
    (байты 16..23) без графических библиотек. Всё промежуточное — в
    `mkdtemp` под `/tmp` (tmpfs), чистится в `finally`.
  - `index.ts` — `Worker(CONVERT_QUEUE_NAME, …, { concurrency: 1 })` (§10.3:
    LibreOffice — всплеск CPU, параллелить нельзя). Самопроверки среды из
    Э4.1 (бинарники, сетевая изоляция) сохранены.
  - Dockerfile — добавлен слой `prod-deps` (`pnpm install --prod --filter`),
    раскладка `/app/services/converter/{dist,node_modules}` + `/app/node_modules`
    повторяет pnpm workspace (как в корневом Dockerfile для `apps/api`).
- **Слушатель результатов, а не запись из воркера** — воркер (в `convnet`)
  БД не видит, поэтому `apps/api` пишет слайды по событию `completed`
  очереди. Риск пропущенного события (рестарт `apps/api` ровно в момент
  завершения задачи → презентация висит в `converting`) **закрыт
  reconcile-свипом** — см. следующий блок «долг».
- Тесты: `apps/api/src/modules/decks/service.test.ts` (+8) — отказ
  неподдерживаемого типа до похода в хранилище/очередь; чужой учитель →
  403; happy-path (файл сохранён, строка заведена, `enqueueConvert` с
  верными полями, `jobId === deckId`, заголовок из имени файла без
  расширения); `buildConvertJobHandlers` — `onProgress` → converting,
  `onCompleted` → replaceSlides + ready, `onFailed` → failed с обрезкой до
  2000; `deleteDeck` — 404 для чужого урока, удаление строки + всех файлов.
  Итого 98/98 бэкенда (было 90, +8).
- `pnpm build`/`pnpm test`/`pnpm depcheck` зелёные (137 модулей, 342
  связи). `pnpm -r typecheck` — 5 пакетов.
- **Не проверено и не могло быть в этой среде**: реальная конвертация
  (`soffice`/`pdftoppm` на живом файле), доставка задачи через настоящий
  Redis, событие `completed` → запись слайдов в настоящий Postgres. Логика
  — юнит-тесты на моках + typecheck против реальных типов `bullmq@6.3.2`.
  Первая живая проверка — на Linux при `docker compose up`.

## Что сделано технически (Э4.3, долг — reconcile-свип)

- **Закрыт риск пропущенного события очереди** (`apps/api` рестартовал
  ровно когда воркер закончил задачу → `completed` не долетел → презентация
  навсегда в `converting`). Решение — свип, как
  `startPresenceSweep`/`startCanvasUnloadSweep`: раз в 60 с + сразу на
  старте (`startDeckReconcileSweep` в `server.ts`, парный
  `stopDeckReconcileSweep` в shutdown).
- `jobsService.getConvertJobOutcome(deckId)` — спрашивает BullMQ о реальном
  состоянии задачи по `deckId` (`queue.getJob` → `job.getState()`):
  `completed` (+ `job.returnvalue`) / `failed` (+ `job.failedReason`) /
  `in-progress` / `missing` (задачи в Redis нет вовсе — reaped по
  `removeOnComplete` или Redis чистили).
- `decksService.reconcileStuckDecks()` — по каждой строке `decks` в
  `pending`/`converting`:
  - `completed`/`failed` → те же `buildConvertJobHandlers()`, что и
    штатный слушатель (одна кодовая точка записи);
  - `missing` + `pending` → **переставить в очередь** (задача потерялась
    до старта воркера, слайдов нет — просто повторяем);
  - `missing` + `converting` → пометить `failed` с просьбой перезалить
    (слайды могли отрендериться, но результат не сохранился и уже reaped —
    честнее показать ошибку, чем вечный «конвертируется»);
  - `in-progress` → ничего, дождёмся события или следующего свипа.
- Для переустановки в очередь понадобился `sourceMimeType` в строке
  `decks` — **новая колонка + миграция `0004`** (0003 не трогал, он уже
  закоммичен; append-only, как весь `drizzle/`). `mimeType` при этом
  ре-валидируется `deckSourceMimeTypeSchema` перед `enqueueConvert`.
- Тесты `decks/service.test.ts` (+4, итого 102/102 бэкенда): подхват
  `completed` при `missing`-событии; `converting`+`missing` → `failed`
  без переустановки; `pending`+`missing` → переустановка с верными полями;
  `in-progress` → не трогает ничего.

## Что сделано технически (Э4.4)

- **Прогресс идёт в тот же WS-канал урока `/ws`, что и presence/чат** — не
  отдельный сокет и не поллинг `GET /jobs/:jobId`. Новый вариант
  `ServerRoomMessage`: `{ type: "deck_status", deck: DeckProgressEvent }`.
  `deckProgressEventSchema` в `packages/shared/decks.ts` — лёгкая проекция
  строки `decks` (`deckId`, `title`, `status`, `progress`, `slideCount`,
  `error`); `packages/shared/rooms.ts` импортирует её (в shared правил
  dependency-cruiser нет, ребро одностороннее — `decks.ts` не тянет
  `rooms.ts`).
- **`decks → rooms`, не наоборот.** `rooms/service.ts` получил
  `broadcastToLesson(lessonId, message: ServerRoomMessage)` — тонкую
  обёртку над внутренним `emitRoomEvent`. `rooms` владеет каналом `/ws`,
  поэтому широковещание по уроку — легитимная часть его API. Прямой импорт
  `decks → rooms/events.ts` запрещён правилом `no-cross-module-internals`
  (только чужой `service.ts`), поэтому проход через сервис. Цикла нет:
  `rooms/service.ts` тянет `canvas`/`lessons`/`media`/`users`, ни один из
  них — `decks` (подтверждено `depcheck`: 138 модулей, 0 нарушений).
- **Единая точка отправки — `broadcastDeckStatus(row)` в `decks/service.ts`,
  вызывается после каждой записи статуса в БД**, поэтому событие всегда
  отражает то, что реально сохранено (не «оптимистично»). Для этого
  `repo.setDeckStatus` теперь `.returning()` и отдаёт обновлённую строку;
  `broadcastDeckStatus(undefined)` (строку успели удалить во время
  конвертации) — тихий no-op.
- Точки эмита: `createDeckFromUpload` сразу после `enqueueConvert`
  (`pending`, чтобы презентация появилась в списке урока до первого шага
  воркера); `buildConvertJobHandlers.onProgress/onCompleted/onFailed`.
  Reconcile-свип (Э4.3-долг) идёт через те же handlers → чинит и события
  тоже, отдельного кода не потребовалось.
- **Фронт** — новый `apps/web/src/features/decks/DeckPanel.tsx`, встроен в
  `RoomPage` под доской. Компактный и **временный**: полноценная лента
  миниатюр и импорт слайдов как страниц холста — Э4.6, здесь только
  «загрузить .pptx/.pdf» (учителю) + статус/прогресс-бар. Источник истины —
  WS: `RoomPage` копит `deck_status`-события в `Record<deckId,
  DeckProgressEvent>` (несколько презентаций могут конвертироваться разом,
  событие несёт одну) и отдаёт пропом; при входе список разово
  подтягивается `GET /lessons/:id/decks`, дальше живёт на событиях.
  Строка «Конвертация: 7 из 24» + полоса `progress/slideCount`.
- Тесты `decks/service.test.ts` (+1, итого 103/103 бэкенда): при загрузке
  сразу летит `deck_status`/`pending` в `broadcastToLesson(LESSON, …)`;
  `onProgress` шлёт `converting` с «3 из 10». `setDeckStatus`-мок теперь
  возвращает строку. `rooms/service.js` замокан в наборе (как
  `lessons`/`users`/`storage`/`jobs`).
- `pnpm -r typecheck` (5 пакетов), `pnpm build`, `pnpm test` (103),
  `pnpm depcheck` (138 модулей) — зелёные.
- **Не проверено и не могло быть в этой среде**: живой путь
  `job.updateProgress` воркера → `QueueEvents` через настоящий Redis →
  `broadcastToLesson` → WS → полоса прогресса в браузере. Нет Docker
  (Redis/BullMQ/converter). Логика — юнит-тесты на моках + typecheck;
  фронтовый компонент собирается (`vite build`), но вживую с бэкендом не
  прогонялся. Первая живая проверка — на Linux при `docker compose up`
  (там же гейт Э4).

## Что сделано технически (Э4.5)

- **Дедуп по `sha256` исходника в пределах школы.** В
  `createDeckFromUpload` после подсчёта sha256 и загрузки исходника —
  `repo.findReadyDeckBySha(schoolId, sha256)` (уже был из схемного коммита
  Э4.3; индекс `decks_school_sha_idx`). Нашёлся `ready`-двойник → ветка
  `dedupFromTwin`, конвертация (`enqueueConvert`) пропускается целиком.
  Область гейта Э4 — CPU LibreOffice во время уроков; ровно он и экономится.
- **Каждый `deck` владеет своими файлами — слайды двойника копируются, не
  переиспользуются.** Новый метод `StorageAdapter.copy({ sourceKey,
  schoolId })` (реализация `LocalFsStorageAdapter` — `fs.copyFile` под новым
  UUID-ключом; заглушка в `S3StorageAdapter` рядом с остальными). Для
  каждого слайда двойника копируются оба файла (PNG + JPEG-превью),
  `replaceDeckSlides` пишет строки с новыми ключами. Плюс свой исходник
  (уже загружен из буфера до проверки дедупа). Итог: `deleteDeck` остаётся
  без учёта ссылок — тот же протестированный путь, что и раньше, ничего не
  трогали. Цена — дубль ~несколько МБ на диске на повторную презентацию;
  для MVP приемлемо (зафиксировано комментарием; при росте `/data/assets`
  альтернатива — reference-count в `deleteDeck`).
- Статус нового `deck` ставится сразу `ready` (`slideCount`/`progress` =
  число скопированных слайдов), `broadcastDeckStatus` шлёт `deck_status`/
  `ready` в WS-канал урока. Ответ `POST /lessons/:id/uploads` —
  `{ deckId, jobId: null, status: "ready" }` (форму `jobId: nullable` shared
  контракт предусматривал с Э4.3, менять схемы не потребовалось).
- `textLayer` слайда двойника переносится как есть (`s.textLayer as
  ConvertedSlide["textLayer"]` — это наш же JSON, записанный из
  `ConvertedSlide` при конвертации двойника; не `any`).
- Тесты `decks/service.test.ts` (+3, итого 106/106 бэкенда): дедуп не
  ставит задачу, копирует по 2 файла на слайд, пишет слайды с новыми
  ключами, статус `ready`, ответ `jobId: null`; `deck_status`/`ready` летит
  в `broadcastToLesson`; двойник ищется по `(schoolId, sha256)`. В
  `beforeEach` — `findReadyDeckBySha → null` по умолчанию (обычная ветка).
- `pnpm -r typecheck` (5 пакетов), `pnpm build`, `pnpm test` (106),
  `pnpm depcheck` (138 модулей, 0 нарушений) — зелёные.
- **Не проверено и не могло быть в этой среде**: реальный `fs.copyFile`
  против тома `/data/assets`, и то, что скопированный PNG открывается по
  HMAC-URL. Нет Docker. Логика — юнит-тесты на моках + typecheck. Первая
  живая проверка — на Linux при `docker compose up`.

## Что сделано технически (Э4.6)

- **Задача целиком фронтовая.** Слайды готовой презентации уже отдаются в
  `Deck.slides` с HMAC-URL картинки и миниатюры (Э4.3/Э4.5), страницы холста
  живут в `Y.Doc` урока (Э3.6), навигация синхронна через `Y.Map "meta"
  .activePageId` (Э3.6). Бэкенд не тронут — тесты 106/106 без изменений,
  миграций нет.
- **Импорт = запись N страниц в `Y.Map "pages"`** (`Board.tsx#importDeckSlides`):
  каждый слайд → страница с `kind: "image"` и новым полем
  `PageMeta.slide` (`{ deckId, index, imageUrl, thumbUrl, width, height }`).
  Одна `ydoc.transact()` на всю презентацию + перевод `activePageId` на
  первый новый слайд. Повторный импорт той же презентации заблокирован
  (`importedDeckIds` — набор `deckId` из уже существующих страниц; кнопка
  «Импортировать» гаснет, есть «Убрать слайды» → `removeDeckSlides`, чистит
  и записи `pages`, и осиротевшие `Y.Array "elements:{pageId}"`, как
  `deletePage` из Э3.6; если убрали все страницы — заводит пустую).
- **Рендер слайда — тот же DOM-слой под прозрачным канвасом, что и шаблоны
  фона Э3.7**, не элемент Excalidraw (structural «фон не выделяется» из
  §3.3 ТЗ сохраняется). `PageBackground` получил проп `slide` и ветку
  `kind === "image"`: `<img>` приколот к мировому прямоугольнику от (0, 0)
  шириной `SLIDE_WORLD_WIDTH = 1000` мировых единиц, высота из пропорций
  слайда. Позиционируется той же формулой `screenX = (sceneX + scrollX) *
  zoom`, что оси координатной плоскости (Э3.7) — слайд панорамируется и
  масштабируется синхронно с холстом, рисование поверх ложится в те же
  мировые координаты у всех участников.
- **UI навигации** (`Board.tsx`): обычные страницы — прежним рядом
  кнопок-номеров (теперь `nonSlidePages`, иначе 40 слайдов = 40
  неразличимых номеров); страницы-слайды — отдельной **лентой миниатюр**
  (`slidePages`, `thumbUrl`, горизонтальный скролл, активная обведена).
  Клик по миниатюре у учителя → `switchPage` (тот же `activePageId`), у
  ученика лента некликабельна — «учитель листает, у всех листается» из
  формулировки Э4.6. Селектор шаблона фона на страницах-слайдах скрыт.
- **Селектор импорта** — только учителю, только если есть `ready`-презентации
  со слайдами: `<select>` презентаций (со счётчиком слайдов и `✓` для уже
  импортированных) + кнопка. Живёт на панели доски, а не в `DeckPanel`
  (там остаётся только загрузка исходника и прогресс) — все мутации
  `Y.Doc` в одном месте, `DeckPanel` не нужно знать про холст.
- **`DeckPanel` стал презентационным**: список презентаций и `onChanged`
  теперь приходят из `RoomPage` (единый источник — там же, где WS-события
  `deck_status`), свой `GET /lessons/:id/decks` и merge убраны. `RoomPage`
  держит `decks: Deck[]`, подтягивает список на входе и повторно — когда
  WS-событие `ready` пришло, а слайдов для презентации ещё нет (guard
  `refetchedDecksRef` от зацикливания). `Board` получает `decks` пропом.
- **Проверки**: `pnpm -r typecheck` (5 пакетов), `pnpm build` (`vite build`
  ок), `pnpm depcheck` (138 модулей, 0 нарушений), `pnpm test` (106/106
  бэкенда, не изменились) — зелёные.
- **Не проверено и не могло быть в этой среде**: живой цикл «учитель
  импортировал слайды → у ученика в другой вкладке появилась лента и тот
  же активный слайд» через настоящий `/collab` (нужен Postgres/Redis/API —
  нет Docker); что HMAC-URL слайда реально открывается из `<img>` (сам файл
  рендерит воркер в контейнере). Yjs-запись страниц и переключение
  `activePageId` в одном клиенте работают локально (механизм из Э3.6).
  Первая живая проверка — на Linux при `docker compose up`.

## Что сделано технически (Э4.7)

- **PDF минует серверную растеризацию.** Решение пользователя: PDF всё равно
  ставится в очередь, но воркер для `application/pdf` делает только
  `clamscan` + `pdfinfo` (число страниц), **без `pdftoppm`**. Сам PDF
  рендерит `pdf.js` в браузере из подписанного URL исходника. Прямо
  экономит CPU LibreOffice/Poppler во время уроков — предмет гейта Э4.
- **Контракт очереди** (`packages/shared/decks.ts` + локальная копия
  `services/converter/src/contract.ts`): `ConvertJobResult` получил
  необязательное `pdf?: boolean`. Для PDF воркер возвращает
  `{ slideCount: N, slides: [], pdf: true }`. Обратно совместимо — старый
  путь (`pdf` не задан) не тронут, дискриминированный union заводить не
  стал (меньше правок в тестах/`getConvertJobOutcome`/reconcile).
- **`decks.render_mode`** — новая колонка (`text NOT NULL DEFAULT 'images'`,
  миграция `0005_ordinary_maggott.sql`, append-only). `'pdf'` ставится в
  `buildConvertJobHandlers.onCompleted` при `result.pdf` — слайды тогда не
  пишутся (`replaceDeckSlides(deckId, [])`), только статус + `slideCount`.
  `toDeckDto` при `render_mode: 'pdf'` кладёт в ответ `pdfUrl` (подписанный
  URL `sourceStorageKey`, тот же длинный TTL, что у слайдов); у обычных
  презентаций `pdfUrl: null`. `deckSchema` в shared пополнена
  `renderMode` + `pdfUrl`.
- **Дедуп (Э4.5) для PDF-двойника** — `dedupFromTwin` рано отрабатывает
  ветку `twinRenderMode === "pdf"`: копировать нечего (слайдов нет),
  `clamscan` не нужен (тот же sha256 уже просканирован), сразу `ready` +
  `render_mode: pdf` + `slideCount` из двойника.
- **Фронт** — новый `apps/web/src/features/canvas/pdf.ts`: настройка
  воркера `pdf.js` (бандл Vite `?worker`, не CDN), кеш распарсенного
  документа (миниатюры и полноразмерная страница делят один
  `PDFDocumentProxy`), `getPdfPageSizes` (размеры страниц для раскладки
  холста), `renderPdfPage(url, index, widthPx)` → PNG data-URL с очередью
  «2 рендера за раз» (лента на 40 страниц иначе плодит 40 canvas разом).
  Исходник грузится одним `fetch` в `ArrayBuffer` и отдаётся `pdf.js` как
  `data` — наш `/files/*` не поддерживает Range-запросы.
- **`PageBackground.tsx`** — `SlidePageRef` стал `imageUrl?`/`thumbUrl?`
  (Э4.6) **либо** `pdfUrl?` (Э4.7). Хук `useSlideImage(slide)`: серверный
  PNG отдаёт сразу, PDF-страницу рендерит `pdf.js` в data-URL (при 1600px)
  — дальше та же формула позиционирования мирового прямоугольника слайда,
  что и для PNG. Новый компонент `SlideThumb` для ленты миниатюр (JPEG
  сервера либо `pdf.js`-рендер при 200px).
- **`Board.tsx`** — `importDeckSlides` стал `async`: для `renderMode: "pdf"`
  сначала `getPdfPageSizes(deck.pdfUrl)` (нужны пропорции), потом та же
  запись N страниц в `Y.Map "pages"` с `slide.pdfUrl` вместо `imageUrl`.
  `readyDecks` теперь включает PDF-презентации (у них `slides` пуст, но
  есть `pdfUrl`). `RoomPage` — guard рефетча списка после `ready`-события
  учитывает `renderMode === "pdf"` (у PDF `slides` всегда пуст, иначе
  рефетчился бы один раз впустую).
- **Проверки**: `pnpm -r typecheck` (4 пакета), `pnpm build` (converter +
  `vite build`; воркер `pdf.worker.min` — отдельным локальным чанком),
  `pnpm test` (108/108 бэкенда, +2: `onCompleted` с `pdf: true`; дедуп
  PDF-двойника), `pnpm depcheck` (142 модуля, 0 нарушений) — зелёные.
- **Не проверено и не могло быть в этой среде**: живой путь «загрузил PDF →
  воркер просканировал и вернул число страниц → в браузере `pdf.js`
  отрендерил страницы на холсте» (нужен Redis/converter/Postgres — нет
  Docker); рендер конкретных PDF со сложными/невстроенными шрифтами (без
  запечённых cmap/standard_fonts `pdf.js` подставит дефолтные — приемлемо
  для MVP, ассеты шрифтов — задел на потом). Логика — юнит-тесты на моках
  + typecheck; фронт собирается. Первая живая проверка — на Linux при
  `docker compose up` (там же гейт Э4).

## Что сделано технически (Э4.8)

- **Текстовый слой строится один раз на весь промежуточный PDF, не по одному
  вызову на страницу.** `services/converter/src/convert.ts#extractTextLayers`
  зовёт `pdftotext -bbox <pdf> -` без `-f/-l` и режет вывод на страницы своим
  парсером (`<page width=".." height="..">…<word xMin=".." yMin=".."
  xMax=".." yMax="..">текст</word>…</page>`, простые регэкспы — так же, как
  `pngSize()` в Э4.3 читает PNG без графической библиотеки, лишних
  зависимостей в air-gapped-контейнер не тянем). Один процесс на документ
  дешевле по CPU, чем N процессов на N слайдов — прямое попадание в область
  внимания гейта Э4 (нагрузка конвертера во время живых уроков).
- **Только для растрового пайплайна (не PDF-passthrough Э4.7).** Для
  `renderMode: "pdf"` серверный текстовый слой не строится осознанно: pdf.js
  и так парсит PDF целиком в браузере для рендера страницы, гонять
  `pdftotext` на сервере ради того же текста — двойная работа. Клиент для
  этого режима достаёт текст сам через `page.getTextContent()` (новая
  `getPdfPageTexts()` в `apps/web/src/features/canvas/pdf.ts`), лениво и
  только когда есть поисковый запрос — на 40-страничный PDF не парсить текст
  всех страниц ради того, что лента миниатюр и так уже показывает.
- **`x/y/w/h` в текстовом слое — доли ширины/высоты страницы (0..1), не
  пиксели.** Осознанное отличие от пиксельных координат PNG (Э4.3, DPI 144):
  боксы должны позиционироваться поверх слайда независимо от того, каким
  DPI/масштабом он отрисован (сервер — PNG@2x, pdf.js — произвольный
  `targetWidthPx`) — доля стабильна, пиксель нет. В Э4.8 боксы не рисуются
  визуально (только текст участвует в поиске), но нормализация сделана на
  будущее — если понадобится подсветка найденного слова на слайде, формула
  позиционирования (`SLIDE_WORLD_WIDTH * fraction`, тот же приём, что и сам
  слайд в `PageBackground.tsx`, Э4.6) сразу подойдёт без миграции данных.
- **Отказ `pdftotext` не валит конвертацию.** Скан-PDF без текстового слоя,
  битый шрифт, что угодно — `extractTextLayers` ловит ошибку, шлёт `warn` в
  структурный лог и возвращает пустые массивы на все страницы; слайд просто
  не участвует в поиске (`textLayer: null`), а не роняет всю презентацию.
  Тот же принцип отказоустойчивости, что у `assertNoInternet()` в Э4.1
  (нештатный результат логируется, но не останавливает процесс).
- **Схема** (`packages/shared/src/decks.ts`): новый переиспользуемый
  `slideTextBoxSchema`, на него теперь ссылаются и `convertedSlideSchema`
  (внутренний контракт очереди, был с Э4.3 с заглушкой `textLayer: null`),
  и новый `textLayer` в `deckSlideSchema` (публичный ответ API — раньше
  текстового слоя там не было вообще, слайд отдавался только
  картинкой/размерами). Колонка `deck_slides.text_layer` (jsonb, nullable) —
  **уже существовала** с Э4.3 (заведена туда впрок), миграция не понадобилась.
- **`decks/service.ts#toSlideDto`** прокидывает `s.textLayer` в ответ API
  (тот же приём приведения типа `as ConvertedSlide["textLayer"]`, что уже
  использовался в `dedupFromTwin` для копирования текстового слоя двойника,
  Э4.5 — там это тоже наш собственный JSON, не `any`).
- **Фронт — новый `apps/web/src/features/canvas/SlideSearch.tsx`**, вставлен
  в `Board.tsx` над лентой миниатюр (только учителю — навигация по клику
  меняет `activePageId` для всех, тот же принцип, что и у самой ленты).
  Ищет по слайдам, УЖЕ импортированным на холст (не по всем презентациям
  урока — предметная область «поиск по презентации» это поиск там, где
  учитель уже показывает материал, а не файловый менеджер). Текст слайда:
  `images` → склейка слов `deck.slides[i].textLayer` (пришло с сервером);
  `pdf` → ленивый `getPdfPageTexts()`, закешированный в состоянии компонента
  по `deckId`. Результат — кнопки «Слайд N», клик — `switchPage`. Поиск
  начинается от 2 символов запроса (короче — слишком много шума на
  кириллице после одной буквы).
- **Проверки**: `pnpm -r typecheck` (4 пакета), `pnpm build` (converter +
  `vite build`), `pnpm test` (110/110 бэкенда, +2: `listDecks` прокидывает
  `textLayer` слайда и отдаёт `null` для слайда без текста), `pnpm depcheck`
  (143 модуля, 0 нарушений) — зелёные.
- **Тестов на сам `extractTextLayers`/regex-парсер нет** — осознанно:
  `services/converter` с Э4.1 держится на нулевых зависимостях (`"test":
  "echo \"no tests yet\""` в его `package.json`), добавление `vitest` только
  ради этого правило CLAUDE.md требует согласовать отдельно, не по ходу
  задачи. Логика проверена typecheck’ом и чтением (regex почти буквально
  повторяет документированный формат `pdftotext -bbox` HTML-подобного
  вывода poppler-utils).
- **Не проверено и не могло быть в этой среде**: реальный вывод `pdftotext
  -bbox` живого poppler (нет Docker/бинарника локально — парсер писан по
  документированному формату, не по факту прогона); что регэксп
  действительно не спотыкается на кириллице/математических символах в
  реальных презентациях; живой поиск в браузере против настоящего
  `deck.slides[i].textLayer`, пришедшего от воркера. Первая живая проверка —
  на Linux при `docker compose up` (там же гейт Э4: лишний процесс
  `pdftotext` на 40 слайдов не должен заметно поднять время конвертации
  сверх 90 сек).

## Что сделано технически (Э4.9)

- **Заметки — из ИСХОДНОГО .pptx/.odp, не из промежуточного PDF.** Обычный
  `soffice --convert-to pdf` заметки не переносит вообще, а альтернативный
  режим экспорта LibreOffice «Notes Pages» рисует слайд+заметку на одном
  листе PDF как единое изображение — не годится, когда нужно решать НА
  СЕРВЕРЕ, кому текст показывать, а не просто «показать картинку всем».
  Поэтому — свой разбор исходного файла.
- **Новый `services/converter/src/notes.ts`: минимальный ZIP-ридер + точечные
  регэкспы по OOXML/ODF-разметке, без единой новой зависимости** (тот же
  принцип «ноль зависимостей» из Э4.1: `pngSize()` в Э4.3 и текстовый слой в
  Э4.8 уже задали этот стиль). ZIP — central directory + local file header,
  `stored`/`deflate` (`node:zlib#inflateRawSync`), без ZIP64 — оправданный
  вырез для файлов презентаций.
  - **.pptx**: порядок слайдов берётся из `ppt/presentation.xml`
    (`p:sldIdLst`/`p:sldId/@r:id`) через `ppt/_rels/presentation.xml.rels` —
    тот же авторитетный порядок, в котором LibreOffice экспортирует страницы
    PDF, поэтому индексы совпадают с уже отрендеренными слайдами без
    дополнительной сверки. Дальше на каждый слайд — его собственный
    `_rels/slideN.xml.rels` → связь `.../notesSlide` → `notesSlideM.xml`.
    Текст заметки — все `<a:t>` внутри `<p:sp>`, КРОМЕ шейпов с
    `<p:ph type="sldNum"|"dt"|"ftr"|"sldImg">` (номер слайда/дата/футер/
    картинка-превью самого слайда на странице заметок — не текст заметки).
  - **.odp**: проще — `<presentation:notes>` лежит прямо внутри своего
    `<draw:page>` в `content.xml`, страницы уже в порядке показа, отдельного
    обхода `rels` не нужно.
  - **.docx/.pdf** — заметок нет по определению (никакой обработки, сразу
    `null` на все слайды).
- **Лучший эффорт (best-effort), как и весь пайплайн Э4.8: любая ошибка
  парсинга не валит конвертацию.** Битый архив, неожиданная структура,
  ZIP64 — `extractSpeakerNotes` ловит исключение, шлёт `warn` в структурный
  лог, возвращает `null` на все слайды. Слайд просто остаётся без заметок.
- **Видимость — решает СЕРВЕР, не UI, и не в общем `Y.Doc`.** Ключевая
  находка: класть заметки в холст (`PageMeta.slide` в `Y.Doc` урока, Э4.6)
  было бы утечкой — документ реплицируется ВСЕМ подключённым клиентам
  целиком, `connectionConfig.readOnly` (находка Э3.1) ограничивает только
  ЗАПИСЬ, не чтение; ученик с открытым devtools увидел бы заметки в
  состоянии Yjs, даже если UI их не рисует. Поэтому заметки идут ТОЛЬКО в
  DTO обычного REST-ответа (`GET /lessons/:id/decks`), который и так уже
  индивидуален на каждый запрос.
  - `decks/service.ts#listDecks` считает `includeNotes = admin ИЛИ
    (teacher И lesson.teacherId === user.sub)` (тот же критерий, что
    `assertCanManageLesson`, но здесь не используется он сам — `listDecks`
    открыт для ЛЮБОГО участника урока через `assertLessonViewer`, роль
    нужна дополнительно поверх, не вместо, проверки доступа к самому
    списку презентаций).
  - `toSlideDto(s, includeNotes)`: при `includeNotes === false` поле
    `notes` — ВСЕГДА `null`, независимо от того, что реально лежит в БД.
    Не «фильтруем на выходе один раз», а прокидываем флаг до самой точки
    сборки DTO — чтобы не завести случайно второй путь сборки ответа,
    который забудет про гейт.
- **Схема** (`packages/shared/src/decks.ts`): `notes: z.string().nullable()`
  добавлено и в `deckSlideSchema` (публичный ответ API), и в
  `convertedSlideSchema` (внутренний контракт очереди — там текст всегда
  настоящий, гейта нет, это дело воркера просто извлечь то, что есть).
  Колонка `deck_slides.notes` (`text`, nullable) — новая миграция
  `0006_modern_monster_badoon.sql` (`drizzle-kit generate`, чистый
  `ALTER TABLE ADD COLUMN`, append-only).
- **Дедуп (Э4.5)**: `dedupFromTwin` копирует `notes` двойника как обычную
  строку (не файл — копировать через `StorageAdapter` нечего), тем же
  приёмом приведения типа `as ConvertedSlide["notes"]`, что уже был для
  `textLayer` (Э4.8) — не `any`.
- **Фронт** — заметки НЕ добавлены в `SlidePageRef`/`PageMeta` (это и есть
  Y.Doc-путь, которого мы избегаем). `Board.tsx` для активной страницы сам
  ищет `decks.find(d => d.id === slide.deckId)?.slides.find(s => s.index
  === slide.index)?.notes` — `decks` проп и так уже прошёл через
  role-gated `listDecks` на сервере, поэтому у ученика в этом месте всегда
  `null`, у учителя — текст. Показывается блоком под доской, только когда
  `isTeacher` и текст не пуст (двойное условие: сервер уже решил доступ,
  клиентская проверка — чтобы не рисовать пустой блок).
- **Тесты** (`decks/service.test.ts`, +4, итого 114/114 бэкенда): новый
  `describe` — хозяину урока и админу заметки видны, ученику (даже
  участнику группы) — `null` при том, что в БД реальный текст, чужому
  учителю — 403 (как и раньше, до самих заметок дело не доходит).
- **Тестов на сам ZIP-ридер/regex-парсер XML нет** — по той же причине, что
  и в Э4.8: `services/converter` держится на нуле зависимостей и без
  тестового раннера (`"test": "echo \"no tests yet\""`), заводить `vitest`
  ради одной задачи — решение не по ходу дела, а по отдельному
  согласованию (правило CLAUDE.md про добавление зависимостей). Логика
  проверена typecheck’ом и построчным чтением формата OOXML/ODF по
  документированной структуре (`presentation.xml`/`.rels`/`notesSlideN.xml`
  для pptx, `content.xml`/`presentation:notes` для odp).
- **Не проверено и не могло быть в этой среде**: разбор РЕАЛЬНОГО .pptx/.odp
  от настоящего PowerPoint/Impress (структура XML написана по спецификации
  и памяти, не сверена с живым файлом — реальные файлы иногда кладут
  плейсхолдеры в неожиданном порядке или без `<p:ph>` вовсе); что
  `inflateRawSync` действительно разворачивает содержимое настоящего ZIP
  (либо PPTX создан с `method: 8`, что стандартно для Office/LibreOffice, но
  не проверено байт-в-байт на образце). Первая живая проверка — на Linux
  при `docker compose up` (там же гейт Э4) на реальных презентациях с
  заметками.

---

# Архив: Э3 — Доска (завершён 2026-08-29)

## Что сделано технически (Э3.1)

- Новые зависимости в `apps/api` (согласованы с пользователем перед
  добавлением): `@hocuspocus/server@^4.6.0`, `yjs@^13.6.32` — жёсткое
  требование ТЗ §3.4, альтернатив нет (обоснование выбора Yjs+Hocuspocus
  против «широковещательных событий» — там же).
- **Это область Y.Doc/жизненного цикла из списка «не делегировать вслепую»
  CLAUDE.md — каждый нетривиальный факт проверен чтением реального
  установленного исходника `@hocuspocus/server@4.6.0` в `node_modules/src`
  (пакет публикует `.ts`-исходники, не только `.d.ts`), а не только по докам
  Context7. Найдено серьёзное расхождение между кратким README-примером
  (`Server`/`server.listen()` на своём порту — нам не подходит, ТЗ требует
  монтирование в тот же процесс) и тем, что реально нужно для встраивания в
  существующий Fastify через `@fastify/websocket`**:
  1. Для интеграции с уже существующим HTTP-сервером нужен класс
     `Hocuspocus` (без `Server`), метод `handleConnection(ws, request,
     context?)` — это подтверждено и доками, и исходником.
  2. **Ключевое расхождение, не очевидное из README**: в v4
     `handleConnection` требует веб-стандартный `Request` (не Node-шный
     `IncomingMessage` — это было в v3). `@fastify/websocket` даёt только
     `request.raw` (`IncomingMessage`). Решение — своя функция
     `toWebRequest()` в `canvas/ws.ts`, собирающая `new Request(url, {
     headers })` из `raw.url`/`raw.headers` (глобальные `Request`/`Headers`
     доступны в Node 22 без `"dom"` в `tsconfig` — подтверждено успешной
     сборкой `tsc` с `types: ["node"]`).
  3. **Второе расхождение**: `handleConnection()` НЕ подписывается на
     события сокета сама (это делает только сам `Server` через свой
     `crossws`-адаптер). При ручной интеграции вызывающий код обязан сам
     звать `clientConnection.handleMessage(data: Uint8Array)` на каждое
     `message` и `clientConnection.handleClose(event?)` на `close` —
     иначе документ никогда не получит обновлений. Подтверждено чтением
     `RELEASE_NOTES_V4.md` («Custom handleConnection Integrations») и
     собственного `Server.ts` пакета как образца (там ровно так и
     сделано через `crossws`-хуки `message`/`close`).
  4. **documentName определяется не из URL, а из тела бинарного
     сообщения** (первый `VarString`, с опциональным суффиксом
     `\0sessionId` для мультиплексирования) — подтверждено чтением
     `ClientConnection.ts#handleMessage`. Поэтому маршрут `/collab` один на
     все уроки, без `:lessonId` в пути; `documentName` == `lessonId`
     напрямую (без префикса `lesson:` из иллюстративной схемы §3.4 ТЗ —
     это была схема-нотация, не буквальный формат строки; коллизий имён
     нет, т.к. документ ровно один на урок, `canvas_docs.lesson_id` — PK).
- `apps/api/src/modules/canvas/hocuspocus.ts` — единственный `Hocuspocus`
  на процесс. `authenticateCanvasConnection()` вынесена отдельной
  экспортируемой функцией (не инлайн в конфиге) специально для юнит-тестов,
  тем же приёмом, что `isStaleEntry` в Э1 (`rooms/service.ts`).
  **Логика прав ролей (admin/teacher/student, иначе 403) намеренно
  ДУБЛИРУЕТ `rooms/service.ts#assertMembership`, а не переиспользует её** —
  осознанное решение: canvas не должен зависеть от rooms (это
  presence/WS-модуль, а не владелец правил доступа к уроку), а модульное
  правило CLAUDE.md запрещает тянуть чужой `repo.ts`; вместо
  рефакторинга `rooms/service.ts` под общий helper (что означало бы
  трогать протестированный код доступа в чужом модуле без необходимости —
  риск для области, которую CLAUDE.md прямо просит читать построчно)
  выбрано контролируемое дублирование ~15 строк через уже публичные
  `lessons`/`users` сервисы.
- `apps/api/src/modules/canvas/ws.ts` — маршрут `GET /collab` (WS,
  `@fastify/websocket`, как и `rooms/ws.ts`), конвертирует `request.raw` в
  веб-`Request`, вызывает `hocuspocus.handleConnection()`, вручную
  прокидывает `message`/`close` в `ClientConnection` (см. п.3 выше).
  Зарегистрирован в `server.ts` рядом с `roomsWsRoutes` на верхнем уровне
  (не под `/api/v1`, как и `/ws` — реальный WS-путь получится
  `/collab`, без префикса).
- `service.ts`/`repo.ts` для модуля `canvas` **пока не заведены** —
  осознанно: persистентности (Э3.2) ещё нет, ни один другой модуль пока не
  должен ничего импортировать у canvas. `server.ts` — корень композиции, а
  не «модуль» в смысле правила dependency-cruiser (`from: {
  path: "^apps/api/src/modules/..." }`), поэтому прямой импорт `canvas/ws.ts`
  оттуда не нарушает правило модульности — тот же паттерн, что уже
  используется для `roomsWsRoutes`/`livekitWebhookRoutes`.
- **Находка про `connectionConfig.readOnly` — впрок для Э3.8**: внутри
  `onAuthenticate` можно мутировать `data.connectionConfig.readOnly = true`
  (объект передаётся по ссылке), и сервер после этого молча отбрасывает
  входящие Yjs-апдейты от этого подключения — подтверждено чтением
  `MessageReceiver.ts` (проверка `connection?.readOnly` перед применением
  `Sync`/`SyncReply` апдейтов). В Э3.1 сознательно НЕ используется (задача
  — только проверка доступа к уроку, не прав на рисование), но это готовый
  и проверенный на реальном исходнике механизм для «ученик без `canDraw`
  подключается в режиме только чтения» в Э3.8 — не нужно будет городить
  свой read-only слой поверх Excalidraw.
- Тест `canvas/hocuspocus.test.ts` (8 тестов) мокает `auth/service.js`,
  `lessons/service.js`, `users/service.js` — по тому же паттерну
  `vi.hoisted`, что `rooms/service.test.ts`. Проверены: невалидный
  `documentName` (не UUID) отклоняется до похода в БД; admin/teacher-хозяин
  урока/student-участник группы проходят; чужой учитель/student не из
  группы/methodist/невалидный токен — отклоняются.
- `pnpm build`/`pnpm test`/`pnpm depcheck` — зелёные. 58/58 тестов бэкенда
  (было 50, +8). `dependency-cruiser`: 104 модуля, 248 связей, без нарушений.
- **Не проверено вживую** — как и весь проект без Docker в этой среде: нет
  реального `HocuspocusProvider`-клиента, который проверил бы
  `toWebRequest()`/ручную прокидку `message`/`close` против настоящего
  WebSocket-рукопожатия по протоколу, а не только против юнит-теста чистой
  функции авторизации. Первая живая проверка возможна не раньше Э3.4/3.5,
  когда появится браузерный клиент (`@hocuspocus/provider` +
  `y-excalidraw`), который реально откроет `/collab`.

## Что сделано технически (Э3.2)

- `apps/api/src/db/schema.ts`: таблица `canvas_docs` (§9 ТЗ) —
  `lessonId` сам PK (FK на `lessons.id`, `onDelete: cascade`, без
  отдельного uuid-суррогата — документ ровно один на урок), `ydoc` —
  собственный `customType<{ data: Buffer }>({ dataType: () => "bytea" })`
  (в Drizzle pg-core нет готового хелпера `bytea`, `pg`/node-postgres сам
  мапит bytea↔Buffer, доп. `toDriver`/`fromDriver` не понадобились),
  `updatedAt`. Миграция `apps/api/drizzle/0002_complex_diamondback.sql`
  сгенерирована `drizzle-kit generate` (валидность SQL проверена
  парсером/чтением, не реальным Postgres — по-прежнему нет Docker в этой
  среде). Строка появляется только по факту первого сохранения
  (`onConflictDoUpdate` upsert), не создаётся заранее пустой.
- `apps/api/src/modules/canvas/repo.ts` — `loadDoc`/`saveDoc`, обычный
  Drizzle `select`/`insert().onConflictDoUpdate()`.
- `apps/api/src/modules/canvas/hocuspocus.ts` пополнился двумя хуками,
  **проверенными построчно чтением исходника `Hocuspocus.ts#loadDocument`
  (это по-прежнему область Y.Doc из списка «не делегировать вслепую»
  CLAUDE.md)**:
  - `onLoadDocument` — возвращает сырые байты (`Buffer | undefined`) из
    `repo.loadDoc()`. Подтверждено чтением исходника: колбэк хука сам
    решает, как применить возврат — `instanceof Doc` → `encodeStateAsUpdate`
    + `applyUpdate`, `instanceof Uint8Array` (чему соответствует `Buffer`)
    → `applyUpdate` напрямую. Возврат `undefined`, если строки в БД ещё
    нет, — тогда остаётся штатный пустой `Document`.
  - `onStoreDocument` — `Buffer.from(encodeStateAsUpdate(document))` →
    `repo.saveDoc()`. `document` в этом хуке — это `Document extends Doc`
    (сам Hocuspocus, подтверждено чтением `Document.ts`), поэтому
    `encodeStateAsUpdate` из `yjs` применим к нему напрямую.
  - `debounce: 3000` в конфиге `Hocuspocus` — буквальное «дебаунс 3 сек»
    из формулировки Э3.2 плана (ТЗ §3.4 даёт диапазон 2–5 сек).
    `maxDebounce`/`unloadImmediately` оставлены на значениях по умолчанию
    пакета — их настройка под 5-минутный grace-период после ухода
    последнего участника принадлежит Э3.3, не этой задаче.
- **«Финальный снимок при закрытии урока»** — новый
  `apps/api/src/modules/canvas/service.ts#closeCanvasDocument(lessonId)`:
  `hocuspocus.closeConnections(lessonId)` форсирует закрытие всех
  `/collab`-сокетов этого урока; штатный `onClose`-путь самого пакета
  (тот же код, что и при обычном уходе последнего участника, см.
  `Hocuspocus.ts` — колбэк `clientConnection.onClose` в
  `handleConnection`) сам сохраняет debounced-изменения немедленно
  (`unloadImmediately`) и выгружает документ.
  - **Вызывается из `rooms/service.ts`, а не из `lessons/service.ts`** —
    осознанно: `canvas` уже зависит от `lessons` (проверка прав в
    `onAuthenticate`, Э3.1), обратная зависимость `lessons → canvas`
    создала бы цикл, запрещённый `dependency-cruiser` (§4.1.1 ТЗ). `rooms`
    зависит от `lessons` и ничем не зависим от `canvas` — безопасная точка
    интеграции. Добавлено во все три места, где `rooms/service.ts` зовёт
    `lessonsService.endLesson()`: `endLessonNow` (учитель/админ вручную),
    `handleRoomFinishedWebhook` (LiveKit `room_finished`, Э2.7) и таймер
    автозавершения пустой комнаты (`scheduleAutoEndIfEmpty`, Э1.7).
- Тесты: `canvas/hocuspocus.test.ts` пополнился 3 тестами на
  `loadCanvasDocument`/`storeCanvasDocument` (мок `repo.js`; для
  `storeCanvasDocument` — не мок, а настоящий `yjs`: создаётся `Doc`,
  вставляется текст, проверяется, что сохранённые байты воспроизводят тот
  же текст через `applyUpdate` на независимом документе, и что они байт-в-
  байт совпадают с прямым вызовом `encodeStateAsUpdate` — тот же приём
  «декодировать реальный артефакт, не мокать SDK», что был в Э2.2 для JWT).
  Новый `canvas/service.test.ts` (1 тест, мок `hocuspocus.js`). Обновлён
  `rooms/service.test.ts`: добавлен мок `../canvas/service.js`, проверено,
  что `closeCanvasDocument` вызывается с `LESSON_ID` в `endLessonNow` и в
  `room_finished`-вебхуке (и НЕ вызывается, если урок уже не `live` —
  идемпотентность). Третий путь (таймер автозавершения пустой комнаты)
  юнит-тестами не покрыт — это существовавший до Э3.2 пробел (таймер живёт
  на реальном `setTimeout` на 15 минут), не новый.
- `pnpm build`/`pnpm test`/`pnpm depcheck` — зелёные. 62/62 теста бэкенда
  (было 58, +4). `dependency-cruiser`: 108 модулей, 259 связей, без
  нарушений (подтверждает отсутствие цикла `rooms ↔ canvas`).
- **Не проверено вживую** — как и весь проект без Docker: нет реального
  Postgres, чтобы прогнать миграцию `0002` и проверить upsert/чтение
  `bytea` против настоящей БД, и нет живого `HocuspocusProvider`-клиента,
  чтобы увидеть персистентность через реальный рестарт процесса. Логика
  проверена чтением исходников пакета и байт-в-байт сверкой через
  настоящий `yjs` в юнит-тестах, не через integration-тест с БД.

## Что сделано технически (Э3.3)

- **Ключевая находка, проверенная чтением исходника `Hocuspocus.ts`
  (область Y.Doc-жизненного цикла из «не делегировать вслепую»
  CLAUDE.md) — в самом Hocuspocus НЕТ штатного механизма «подожди N минут
  после ухода последнего участника»**: `shouldUnloadDocument()` считает
  документ выгружаемым сразу, как только 0 подключений и нет ожидающего
  дебаунсированного сохранения — то есть штатно документ выгружается в
  пределах `debounce`/`maxDebounce` (секунды), а не через 5 минут.
  Единственное похожее API — `DisconnectOptions.unloadImmediately` — это
  опция `DirectConnection` (программное серверное подключение без реального
  WS-клиента), для обычных участников урока не подходит. Грейс-период
  пришлось строить полностью самим.
- Механизм в два звена, `apps/api/src/modules/canvas/hocuspocus.ts`:
  1. **Ветирование** (`beforeUnloadDocument` → `vetoUnloadDuringGracePeriod`):
     своя `Map<documentName, timestamp>` (`emptySince`) отмечает момент,
     когда `document.getConnectionsCount()` последний раз стал 0
     (`onDisconnect` → `trackEmptySinceOnDisconnect`), и сбрасывается при
     успешном (пере)подключении (`connected`, НЕ `onConnect` — тот
     срабатывает ДО `onAuthenticate`, ещё до того, как известно, что
     подключение вообще состоится, подтверждено чтением
     `ClientConnection.ts#handleQueueingMessage`). Пока с момента
     опустения прошло меньше 5 минут, хук `throw`-ит — это безопасно:
     `unloadDocument()` в `Hocuspocus.ts` оборачивает вызов хука в
     try/catch и просто молча не выгружает документ при ошибке (не роняет
     процесс). Защитная ветка: если карта почему-то не знает о документе
     (не должно происходить в норме) — считаем грейс-период только что
     начавшимся, а не пропускаем выгрузку без разбора.
  2. **Периодический sweep** (`sweepIdleCanvasDocuments`,
     `startCanvasUnloadSweep`/`stopCanvasUnloadSweep`, интервал 30 сек,
     тот же приём, что `startPresenceSweep` в `rooms/service.ts`, Э1.7):
     необходим, потому что ничто внутри Hocuspocus само не перепроверяет
     документ после того, как `beforeUnloadDocument` его ветировал —
     единственные два места, откуда вообще зовётся `unloadDocument()`
     (после `onStoreDocument` и при закрытии последнего соединения), сами
     больше не сработают без новой активности. Без sweep документ с
     истёкшим грейс-периодом, в который никто не вернулся, повис бы в
     памяти навсегда — ровно то, что явно проверяет гейт Э3 плана.
     Sweep сам перепроверяет актуальный `getConnectionsCount()` документа
     в `hocuspocus.documents` (не верит слепо старой отметке в
     `emptySince`) — на случай гонки, когда участник успел вернуться, а
     `connected`-хук почему-то ещё не отработал.
  - Подключено в `server.ts` рядом с `startPresenceSweep`/`stopPresenceSweep`.
- **Метрика `canvas_active_ydocs`** в `apps/api/src/plugins/metrics.ts` —
  `Gauge` с `collect()` (штатная поддержка prom-client для вычисляемых
  значений без ручного `.set()` на каждое событие), читает
  `hocuspocus.documents.size` прямо в момент скрейпа — рассинхронизация с
  реальным состоянием невозможна в принципе, в отличие от отдельного
  инкрементируемого счётчика. Это прямой сигнал для гейта Э3 плана: «через
  10 минут после окончания всех уроков метрика активных Y.Doc = 0».
  `plugins/metrics.ts` импортирует `canvasService` напрямую — это
  cross-cutting-плагин, а не модуль в смысле правила dependency-cruiser
  (тот ограничивает только импорты ИЗ `apps/api/src/modules/*`), тот же
  принцип, что уже применялся к `server.ts`.
- `canvas/service.ts` пополнился реэкспортом
  `getActiveCanvasDocumentsCount`/`startCanvasUnloadSweep`/`stopCanvasUnloadSweep`
  — обновлена и документация `closeCanvasDocument` (Э3.2): после Э3.3
  форс-закрытие соединений при завершении урока больше не значит
  «немедленно выгрузить документ» — сохранение по-прежнему происходит
  сразу (`unloadImmediately` пакета не менялся), а сама выгрузка из памяти
  теперь всегда идёт через тот же 5-минутный грейс-период и sweep, что и
  обычный уход последнего участника. Отдельный путь «выгрузить немедленно,
  раз урок закончился» сознательно не заводился — экономит несколько
  мегабайт RAM на несколько минут раньше ценой лишней ветки логики.
- Тесты (`canvas/hocuspocus.test.ts`, +8, на фейковых таймерах `vi.useFakeTimers`):
  ветирование до истечения 5 минут и разрешение после; сброс отметки при
  переподключении заставляет ждать заново; sweep выгружает документ с
  истёкшим грейс-периодом и НЕ трогает документ, у которого сейчас есть
  подключения (в т.ч. гонка reconnect, когда `hocuspocus.documents`
  показывает актуальное состояние, а не устаревшую отметку); документ, у
  которого ушёл не последний участник, не помечается пустым.
  `hocuspocus.unloadDocument` подменяется `vi.spyOn(...).mockResolvedValue()`
  — так тест проверяет именно логику отбора/фильтрации sweep, не завязываясь
  на реальные внутренности `unloadDocument()` (мьютексы, `document.destroy()`
  и т.д., которые пришлось бы иначе тоже подделывать). Плюс тест на
  `getActiveCanvasDocumentsCount`.
- `pnpm build`/`pnpm test`/`pnpm depcheck` — зелёные. 70/70 тестов бэкенда
  (было 62, +8). `dependency-cruiser`: 108 модулей, 261 связь, без нарушений.
- **Не проверено вживую** — как и весь проект без Docker: реальный
  5-минутный грейс-период и то, что RAM процесса действительно
  возвращается к базовой линии после серии уроков, проверены только на
  фейковых таймерах в юнит-тестах, не на живом процессе под нагрузкой (это
  и есть содержание гейта Э3, который нельзя прогнать без `docker-compose
  up`/`livekit-cli load-test`).

## Что сделано технически (Э3.4)

- Новая зависимость в `apps/web` (согласована с пользователем перед
  добавлением): `@excalidraw/excalidraw@^0.18.1` — MIT, единственный
  вариант по ТЗ §3.3 (tldraw отклонён из-за платной лицензии). Тянет
  большой транзитивный граф (mermaid/d3/katex/cytoscape и т.д. — для
  встроенной в пакет фичи «Mermaid → Excalidraw», которую по стоп-листу
  всё равно скрываем) — это собственные зависимости самого пакета, не
  требует отдельного согласования per правило CLAUDE.md (правило про новые
  зависимости — про то, что добавляем МЫ напрямую).
- `apps/web/src/features/canvas/Board.tsx` — пока БЕЗ коллаборации (это
  Э3.5): локальный, изолированный `<Excalidraw>`. Встроен в
  `RoomPage.tsx` как отдельная область над списком участников/чатом.
- **Упрощение тулбара (Mermaid/embed/библиотека фигур) не управляется ни
  одним публичным пропом Excalidraw** — проверено чтением скомпилированного
  `node_modules/@excalidraw/excalidraw/dist/dev/index.js` (доки Context7
  документируют только `UIOptions.tools.image`). Скрыто через CSS,
  найденные там же стабильные классы, `apps/web/src/features/canvas/Board.css`:
  - `.App-toolbar__extra-tools-trigger` — кнопка «ещё» (рамка, встраивание,
    лазер, Mermaid, ИИ-рамка); это реальный кликабельный элемент сам по
    себе, `display:none` полностью убирает его из DOM/a11y-дерева.
  - Кнопка библиотеки фигур — **не так просто**: она рендерится как внешний
    `<label class="sidebar-trigger__label-element">`, оборачивающий
    внутренний `<div class="sidebar-trigger default-sidebar-trigger">`.
    Скрытие только внутреннего div (первая попытка) оставляло невидимый, но
    всё ещё focusable/доступный для скринридера элемент в DOM — **поймано
    живой проверкой в браузере**: Playwright-снимок accessibility-дерева
    показывал чекбокс «Library», хотя визуально кнопки не было на
    скриншоте. Исправлено правилом `label.sidebar-trigger__label-element:has(.default-sidebar-trigger)`
    — `:has()` бьёт по внешней обёртке ровно библиотечного триггера, не
    трогая гипотетические кастомные сайдбары, которые могут понадобиться
    в Э9.
  - `UIOptions.tools.image` выключен — своей загрузки изображений (Э3.10,
    с ресайзом на сервере) ещё нет, штатный инструмент «изображение»
    вставлял бы сырой dataURL прямо в Y.Doc в обход будущего пайплайна.
- **Шрифты самохостом (§3.3 ТЗ) — найдена и исправлена реальная ошибка,
  пойманная только живой проверкой в браузере, не по докам**: README
  пакета формулирует «скопируй содержимое `dist/prod/fonts` в `public/`»,
  что легко прочитать как «содержимое папки fonts, без самой папки». Так
  и было сделано первым заходом — но относительные URI шрифтов ВНУТРИ
  самого пакета уже включают префикс `"fonts/"` (например
  `"./fonts/Cascadia/CascadiaCode-Regular.woff2"`), поэтому при
  `EXCALIDRAW_ASSET_PATH="/"` браузер запрашивает `/fonts/Cascadia/...`.
  Без обёртки `fonts/` в `public/` этот путь не существует → Vite отдаёт
  `index.html` как SPA-фолбэк (200, `Content-Type: text/html`) → браузер
  получает не woff2, а HTML → `OTS parsing error: invalid sfntVersion` в
  консоли → нативный fallback `FontFace` тихо переключается на второй
  источник в списке `src` — **захардкоженный `https://esm.sh/@excalidraw/excalidraw@.../dist/prod/fonts/...`**
  (проверено чтением `ExcalidrawFontFace.createUrls()` в исходнике пакета:
  туда безусловно добавляется CDN-фолбэк `ASSETS_FALLBACK_URL`, даже когда
  `EXCALIDRAW_ASSET_PATH` задан). Итог первой попытки — реальное обращение
  к чужому CDN, прямое нарушение железного правила CLAUDE.md, при этом
  визуально всё работало (текст на доске рисовался — просто шрифтом с
  esm.sh, а не самохостным), так что баг не был бы замечен без проверки
  сетевых запросов в браузере. **Исправление**: шрифты перемещены в
  `apps/web/public/fonts/{Assistant,Cascadia,...}` (сама папка `fonts`
  сохранена, не только её содержимое). Перепроверено на чистой странице
  (без кэша от неудачной первой попытки — `cache: "force-cache"` в
  `fetchFont()` пакета иначе маскирует исправление устаревшим плохим
  ответом): 0 запросов к esm.sh, 0 OTS-предупреждений, кириллический текст
  рендерится подключённым Excalifont.
- `apps/web/index.html`: `window.EXCALIDRAW_ASSET_PATH = "/"` в `<head>`
  до загрузки модуля приложения — с комментарием, фиксирующим находку выше
  (чтобы это не повторилось при следующем обновлении версии пакета).
- `apps/web/vite.config.ts`: добавлен dev-прокси `/collab` → `ws://localhost:3000`
  (по аналогии с уже существующим `/ws`) — понадобится клиенту Hocuspocus в Э3.5.
- **Проверено вживую в браузере** (в отличие от почти всего остального
  проекта — здесь это было возможно без Docker, т.к. Excalidraw без
  коллаборации не требует бэкенда): `pnpm --filter @school/web dev` и
  отдельно продакшн-сборка (`vite build` + `vite preview`) через
  Playwright MCP — упрощённый тулбар, ввод кириллического текста,
  accessibility-снимок без «мёртвых» focusable-элементов, сетевые запросы
  шрифтов без обращений к CDN. Временный dev-роут `/__dev_board_preview`
  для этой проверки добавлялся и полностью удалён перед коммитом (не
  часть итогового изменения).
- `pnpm build`/`pnpm depcheck` зелёные (112 модулей, 265 связей). Тесты
  бэкенда не изменились (70/70) — Э3.4 целиком фронтовая, `apps/web` пока
  без тестовой инфраструктуры ("no tests yet", как и раньше).

## Что сделано технически (Э3.5)

- Новые зависимости в `apps/web` (согласованы с пользователем перед
  добавлением): `yjs@^13.6.32`, `@hocuspocus/provider@^4.6.0` (клиент к
  уже готовому `/collab` из Э3.1–Э3.3), `y-excalidraw@^2.0.12` —
  единственная готовая привязка Excalidraw↔Yjs по §3.4 ТЗ.
  **Осознанное расхождение версий**: `y-excalidraw` в `peerDependencies`
  заявляет `@excalidraw/excalidraw@^0.17.6`, у нас уже `0.18.1` из Э3.4.
  pnpm предупредил (`unmet peer`), но не заблокировал установку —
  решение пользователя: ставить как есть и проверять вживую, а не
  откатывать Excalidraw на 0.17.x.
- **Проверено чтением исходников — это прямо область Y.Doc из списка «не
  делегировать вслепую» CLAUDE.md**, `y-excalidraw` публикует только
  скомпилированный `dist/*.js` + `.d.ts` (без читаемого TS-исходника), но
  этого хватило:
  - Класс `ExcalidrawBinding(yElements, yAssets, api, awareness?,
    undoConfig?)` сам вешает `api.onChange(...)` (реальный метод
    `ExcalidrawImperativeAPI`, не только React-проп `<Excalidraw
    onChange>` — подтверждено чтением `dist/types/excalidraw/types.d.ts`
    установленного пакета 0.18.1: метод есть, сигнатура совпадает) для
    локальных правок → пишет дельту в `yElements`/`yAssets`, и
    `yElements.observeDeep(...)`/`yAssets.observe(...)` для удалённых
    правок → `api.updateScene(...)`. Сразу в конструкторе один раз
    вызывает `api.updateScene({ elements: yjsToExcalidraw(yElements) })`
    — значит отдельно передавать `initialData` не нужно, начальное
    состояние подтягивается из Y.Doc само.
  - **Реальный TS2307 при первой попытке, а не только теоретический
    риск версии**: `.d.ts` пакета `y-excalidraw` импортирует тип
    `ExcalidrawImperativeAPI` из `@excalidraw/excalidraw/types/types` —
    путь, актуальный для схемы экспортов Excalidraw 0.17.x. У
    установленной `0.18.1` `exports` в `package.json` устроены иначе
    (`"./*": { "types": "./dist/types/excalidraw/*.d.ts" }`), и файла
    `dist/types/excalidraw/types/types.d.ts` физически нет — есть
    `dist/types/excalidraw/types.d.ts`, доступный по подпути
    `@excalidraw/excalidraw/types` (без второго `/types`). Собственный
    импорт в `Board.tsx` пришлось делать по исправленному пути;
    `tsconfig.base.json`'s `skipLibCheck: true` спасает от падения
    сборки на РАЗРЕШЕНИИ типа ВНУТРИ `.d.ts` самого `y-excalidraw` (там
    ошибка остаётся, но не мешает `pnpm build`), но мой собственный
    некорректный импорт (по аналогии со сломанным путём пакета) ловился
    `tsc` сразу и жёстко — эта часть проверки не skip'ается.
- `apps/web/src/features/canvas/Board.tsx`: `Y.Doc`, `HocuspocusProvider`
  и `ExcalidrawBinding` создаются и уничтожаются **в одном `useEffect`**,
  не через `useMemo` для `Y.Doc` — осознанно (см. комментарий в коде):
  `useMemo` — подсказка для рендера, не гарантия жизненного цикла (React
  не обещает не выбрасывать мемоизированное значение) и не имеет парной
  функции очистки; единый `useEffect` даёт детерминированные
  create/destroy в паре и корректно переживает двойной вызов эффектов в
  `<StrictMode>` (используется в `main.tsx`) без утечки второго `Y.Doc`.
  - `url`: `${protocol}//${location.host}/collab` — тот же паттерн
    same-origin WS, что уже был у `useRoomSocket.ts` для `/ws` (Э1.1).
  - `token` — из `useAuthStore`, передаётся отдельным полем конфига
    `HocuspocusProvider`, НЕ в query-строку URL: подтверждено в Э3.1, что
    Hocuspocus читает токен из тела бинарного Auth-сообщения, а не из
    URL. Эффект не запускается, пока `accessToken` не готов
    (`useAuthStore` реактивен — при появлении токена эффект перезапустится
    сам, отдельный retry-таймер, в отличие от `useRoomSocket`, не нужен).
  - `Y.Array "elements"` — один общий массив на весь холст, без разбивки
    по страницам (`Y.Map "pages"`/`activePageId` — это Э3.6, сознательно
    не заводится сейчас, чтобы не смешивать задачи в одном коммите).
  - `awareness` в `ExcalidrawBinding` **не передан** — курсоры/viewport
    (Э3.9) ещё не настроены (`user.name`/`color` нигде не выставляются),
    передавать пустую anonymous-awareness сейчас значило бы наблюдать
    полуготовое поведение раньше срока.
- `RoomPage.tsx`: `<Board lessonId={lessonId} />` — `lessonId` теперь
  прокидывается пропом (было без пропов в Э3.4).
- **Проверено вживую в браузере (Playwright) частично** — то, что можно
  проверить без бэкенда:
  - Продакшн-сборка (`vite build`) действительно собирается с реальными
    установленными `y-excalidraw`/`@hocuspocus/provider` (не только
    теоретически совместимо) — включая находку с TS2307 выше, пойманную
    именно так, не по докам.
  - `Board` рендерится без падения и без обращений к `/collab`, когда
    `accessToken` ещё не готов (гость/до логина) — эффект корректно не
    запускается, ждёт токен реактивно.
  - **Не проверено и не могло быть проверено в этой среде**: реальная
    двусторонняя синхронизация штрихов между двумя вкладками через живой
    `/collab` — для этого нужны настоящие Postgres/Redis/API-сервер с
    выданным JWT (нет Docker в этой среде, как и весь остальной проект).
    Серверная часть протокола (аутентификация, персистентность,
    жизненный цикл) уже покрыта 19 юнит-тестами в Э3.1–Э3.3; здесь
    непроверенным остаётся именно клиентское связывание
    `HocuspocusProvider ↔ ExcalidrawBinding ↔ реальный WS-хендшейк`.
    Первая живая проверка возможна только при развёртывании с Docker
    (или на боевом сервере) — двумя вкладками/браузерными контекстами,
    как рекомендует ПЛАН.md для Э3.
- `pnpm build`/`pnpm depcheck` зелёные (115 модулей, 271 связь). Тесты
  бэкенда не изменились (70/70) — Э3.5 целиком фронтовая.

## Что сделано технически (Э3.6)

- `apps/web/src/features/canvas/Board.tsx` переработан под модель страниц
  (§3.4/§4.3 ТЗ): `Y.Map "pages"` (`pageId → { order, backgroundAssetId,
  kind }`, `kind` пока всегда `"blank"` — рендер фона это Э3.7) и
  `Y.Map "meta"` (`activePageId`). Элементы каждой страницы — в СВОЁМ
  `Y.Array "elements:{pageId}"` (в Э3.5 был один общий `"elements"` без
  разбивки; миграции данных не нужно, реальных уроков в БД ещё нет).
- Жизненный цикл разнесён на три независимых `useEffect` вместо одного
  (область Y.Doc — «не делегировать вслепую» CLAUDE.md): подключение
  (`Y.Doc`+`HocuspocusProvider`, зависит только от `lessonId`/`accessToken`,
  не пересоздаётся при листании) → синхронизация страниц/`activePageId`
  (зависит от готовности подключения) → `ExcalidrawBinding` (пересоздаётся
  при каждой смене активной страницы — у `y-excalidraw` одна привязка = один
  массив элементов = одна сцена, штатного API «переключить сцену на лету»
  у пакета нет).
- **Найдена и исправлена вторая реальная ошибка в `y-excalidraw`, пойманная
  только живой проверкой в браузере** (после находки в Э3.5 с
  `peerDependencies`/путём импорта типа): конструктор `ExcalidrawBinding`
  в конце безусловно (НЕ под `if (this.awareness)`, который защищает
  только подписку на `"change"`) обращается к `this.awareness.getStates()`
  — с `awareness: undefined` (как было в Э3.5, где Э3.9-курсоры сознательно
  отложены) падает `TypeError: Cannot read properties of undefined
  (reading 'getStates')` прямо при монтировании доски, хотя `.d.ts` пакета
  помечает `awareness` необязательным параметром. Исправлено: `Board`
  теперь хранит сам `provider` (не голый `Y.Doc`) и передаёт
  `provider.awareness` в `ExcalidrawBinding` — без ошибки, но и без
  какого-либо визуального эффекта (курсоры/имена участников по-прежнему
  не настроены, это Э3.9). **Отдельно проверено чтением исходника
  `HocuspocusProvider.ts#destroy()`**, что `Y.Doc` при этом всё равно
  нужно создавать и уничтожать вручную самим (не полагаясь на провайдер):
  `destroy()` не вызывает `document.destroy()` даже для документа, который
  создал бы сам провайдер по умолчанию — ответственность за документ он
  не берёт на себя ни в каком случае.
- UI: лента страниц (кнопки-номера, не визуальные миниатюры — это не
  требуется буквальной формулировкой задачи Э3.6) + «+ страница» +
  «Удалить страницу» (скрыта, если страница последняя — у урока всегда
  есть минимум одна). Управление доступно только учителю/админу
  (`useAuthStore` → `role`), ученики видят те же кнопки некликабельными
  (`disabled`) — простая синхронная модель «учитель листает, у всех
  листается» из формулировки Э3.6, без независимого пролистывания
  учеником вперёд/назад (та более сложная модель — не в этой задаче).
  Новые `pageId` — `crypto.randomUUID()` на клиенте (идиоматично для
  Yjs — не требует серверного round-trip для структурных изменений).
- Удаление страницы явно чистит содержимое её `Y.Array` (`.delete(0,
  length)`), не только запись в `pages`: у Yjs нет официального API «убрать
  shared-тип по имени» (сам именованный массив остаётся в реестре типов
  документа навсегда — проверено по `.d.ts` пакета `yjs`), так что без
  очистки контента удалённые страницы продолжали бы бесконечно расти в
  размере бинарного состояния документа.
- **Проверено вживую в браузере (Playwright), полный цикл** — то, что
  можно проверить без бэкенда (Yjs-документ и вся его структурная логика
  работают полностью локально в памяти, независимо от успеха сетевого
  подключения к `/collab`, которое в этой среде недостижимо):
  создание первой страницы автоматически при пустом холсте; рисование на
  странице 1; добавление страницы 2 (пустой, с автопереключением);
  переключение на страницу 1 — содержимое (нарисованная фигура) на месте,
  подтверждает изоляцию элементов по страницам; удаление страницы 2 —
  автоматическое переключение назад на страницу 1 с сохранённым
  содержимым; кнопка «Удалить страницу» корректно скрывается, когда
  осталась одна страница. Ни одного JS-краша за весь сценарий (кроме
  ожидаемых, не связанных с этим циклом обрывов WS к недоступному
  `/collab`). Временный dev-роут для проверки (с фейковым
  `useAuthStore.setAuth(...)`, т.к. без него `ydoc` не создаётся — эффект
  подключения ждёт `accessToken`) добавлялся и полностью удалён перед
  коммитом.
  - **Не проверено и не могло быть проверено в этой среде**: та же
    оговорка, что и в Э3.5 — реальная синхронизация переключения страниц
    между ДВУМЯ участниками через живой `/collab` требует настоящего
    Postgres/Redis/API-сервера (нет Docker). Проверено только то, что
    один клиент видит собственные структурные изменения корректно.
- `pnpm build`/`pnpm depcheck` зелёные (115 модулей, 271 связь). Тесты
  бэкенда не изменились (70/70) — Э3.6 целиком фронтовая.

## Что сделано технически (Э3.7)

- `apps/web/src/features/canvas/PageBackground.tsx` — четыре шаблона фона
  по буквальной формулировке §3.3 ТЗ: клетка, линейка, координатная
  плоскость, нотный стан (плюс «пусто»). Изображение-фон (`kind: "image"`)
  **сознательно не реализовано** — загрузка с ресайзом на сервере через
  `StorageAdapter` (жёсткое правило CLAUDE.md, файлы только через него) это
  отдельная задача Э3.10; поле `backgroundAssetId` в `PageMeta` (Э3.6) уже
  готово для неё, UI под него заводить сейчас значило бы смешивать задачи.
- **Архитектурное решение, требующее обоснования**: фон — НЕ элемент
  Excalidraw (даже залоченный `locked: true` элемент технически остаётся
  снимаемым с замка через штатный UI Excalidraw «правый клик → открепить»,
  и оставался бы виден в списке слоёв), а обычный DOM-слой ПОД канвасом.
  `Board.tsx` делает канвас Excalidraw прозрачным
  (`initialData.appState.viewBackgroundColor: "transparent"`, подтверждено
  чтением исходника `bootstrapCanvas()` пакета — для нецветовой строки
  `"transparent"` вызывается `context.clearRect(...)`, а не заливка) и
  запрещает менять цвет фона через UI
  (`UIOptions.canvasActions.changeViewBackgroundColor: false`), чтобы
  подложенный DOM-слой было видно и нельзя было случайно закрасить.
  При таком подходе у фона в принципе нет пути выделения/перемещения/
  удаления через интерфейс Excalidraw — не потому что что-то запрещено
  правилом, а потому что это просто не элемент сцены. Требование ТЗ «фон
  не выделяется» выполняется структурно, а не проверкой прав.
- **Сложная часть, потребовавшая чтения исходника и живой проверки**:
  CSS-паттерн фона обязан панорамироваться/масштабироваться СИНХРОННО с
  холстом Excalidraw, иначе рассинхронизация с рисунком была бы сразу
  заметна (клетка «поехала» бы при скролле). Формула найдена чтением
  скомпилированного `sceneCoordsToViewportCoords()` в бандле пакета:
  `screenX = (sceneX + scrollX) * zoom + offsetLeft` — `PageBackground`
  подписывается на `excalidrawAPI.onScrollChange(...)` и на каждое
  изменение выставляет `background-size`/`background-position` слоя-паттерна
  по этой же формуле (`offsetLeft`/`offsetTop` опущены — фон позиционируется
  как sibling канваса с тем же bounding box, оба от (0,0) общего
  `position: relative`-контейнера). Оси координатной плоскости — не
  повторяющийся паттерн, а две линии через мировую точку (0,0), позиция
  пересчитывается той же формулой напрямую в `style.top`/`style.left`.
  **Проверено вживую в браузере (Playwright)**: паттерн «клетка» остаётся
  идеально ровным при программном скролле (`wheel`-событие на канвасе) и
  при изменении зума кнопкой «Zoom in» (100% → 130%, размер клетки
  визуально вырос пропорционально, ни одного видимого шва/сдвига);
  «нотный стан» и «координатная плоскость» отрендерены и визуально
  проверены (оси корректно ушли за пределы экрана после скролла —
  математически ожидаемое поведение для мировой точки (0,0), не баг).
- `Board.tsx`: селектор шаблона фона (`<select>`, только учитель/админ,
  те же русские подписи, что в ТЗ) пишет `kind` в существующую запись
  `pages`-карты активной страницы, не трогая `order`/`backgroundAssetId`.
- `pnpm build`/`pnpm depcheck` зелёные (116 модулей, 274 связи). Тесты
  бэкенда не изменились (70/70) — Э3.7 целиком фронтовая.
- **Не проверено и не могло быть проверено в этой среде**: та же оговорка,
  что и в Э3.5/Э3.6 — реальная синхронизация выбора фона между двумя
  участниками через живой `/collab` требует настоящего бэкенда (нет
  Docker). Сама Yjs-запись `kind` в `pages`-карту работает независимо от
  сети — это уже покрыто механизмом, проверенным в Э3.6.

## Что сделано технически (Э3.8)

- **Персональное право `canDraw` уже существовало с Э1.6** (rooms
  presence + `PATCH .../permissions`, чекбокс «рисовать» в списке
  участников RoomPage) — но нигде не ПРИМЕНЯЛОСЬ к самой доске. Э3.8 —
  это про реальное ENFORCEMENT, не про добавление ещё одного флага.
- **Архитектурная развилка, потребовавшая решения** (область прав
  доступа — «не делегировать вслепую» CLAUDE.md): canDraw — истина в
  presence (Redis, владеет `rooms`), а решение «дать/не дать писать в
  Y.Doc» принимает `canvas` (Hocuspocus). Прямой запрос canvas → rooms
  создал бы цикл (rooms уже зависит от canvas с Э3.2,
  `closeCanvasDocument`). Решение: **canvas держит собственный
  in-memory оверрайд** (`Map<lessonId, Map<userId, canDraw>>`), в который
  `rooms/service.ts#updatePermissions`/`setDrawForAllStudents` ЯВНО
  пушат текущее значение при каждом изменении — тот же однонаправленный
  поток `rooms → canvas`, что уже был для `closeCanvasDocument`, ничего
  нового в графе зависимостей. Без единого пуша (свежий урок, права не
  трогали) используется тот же дефолт по роли, что и в
  `presence.ts#defaultPermissions`: учитель/админ — можно, ученик —
  нельзя.
- **Живое обновление уже открытого подключения** — тот же принцип, что
  `mediaService.updateLivePermissions` для LiveKit (Э2.5): найденное в
  Э3.1 (но не использованное тогда) API — `connection.readOnly`
  оказалось обычным мутируемым публичным полем `Connection` (проверено
  чтением `Connection.ts` пакета), а `Document.getConnections()` отдаёт
  массив всех живых подключений документа. `canvasService.setDrawPermission()`
  находит подключение(-я) нужного `userId` по `connection.context.userId`
  (тот самый `context`, что возвращает `authenticateCanvasConnection` —
  Э3.1) и меняет `readOnly` немедленно, без ожидания переподключения.
- `authenticateCanvasConnection` (Э3.1) научилась мутировать
  `payload.connectionConfig.readOnly` — **не через возвращаемое
  значение**: подтверждено чтением `ClientConnection.ts`, что именно
  объект `connectionConfig` (по ссылке) читается при создании
  `Connection`, а результат хука уходит только в `context`.
  Серверное `readOnly` — авторитетный источник истины (Yjs-обновления
  read-only подключения молча отбрасываются, MessageReceiver.ts, найдено
  в Э3.1); `oldSince`-подобной утечки оверрайдов между уроками не
  возникает — `afterUnloadDocument` чистит карту урока при выгрузке
  документа (тот же хук-слот, что уже занят `vetoUnloadDuringGracePeriod`
  для другого хука, `beforeUnloadDocument`, — не конфликтуют).
- `rooms/service.ts#updatePermissions` пушит canDraw в canvas только
  когда `patch.canDraw !== undefined` (не на каждое изменение
  canSpeak/canShareScreen). Новая `setDrawForAllStudents()` — глобальный
  тумблер (Э3.8 плана), НЕ переиспользует `updatePermissions` в цикле:
  там есть проверка лимита микрофонов и синхронизация LiveKit-гранта,
  оба нерелевантны для canDraw (право рисования на аудио не влияет).
  Новый роут `POST /lessons/:id/draw-all` (`setDrawForAllRequestSchema`
  в `packages/shared`), тот же паттерн авторизации/структуры, что
  `mute-all` (Э2.5).
- Клиент: `Board.tsx` получает проп `canDraw` (из
  `self?.permissions.canDraw` в `RoomPage.tsx`, уже отслеживается с
  Э1.6) и передаёт его в `<Excalidraw viewModeEnabled={!canDraw}>` —
  **реактивный проп самого компонента** (не только `initialData` — 
  проверено чтением скомпилированного бандла: `componentDidUpdate`
  сравнивает `prevProps.viewModeEnabled`/`this.props.viewModeEnabled` и
  синхронизирует состояние на каждое изменение), поэтому обновление
  прав UI подхватывает мгновенно без ручных вызовов `updateScene`.
  Клиентский `viewModeEnabled` — UX-слой; авторитетное решение всё
  равно на сервере (`connectionConfig.readOnly`), как и положено для
  области, где нельзя доверять клиенту вслепую.
  `RoomPage.tsx` получила кнопки «Разрешить/Запретить рисовать всем»
  рядом с «Заглушить всех» — те же место и стиль, что Э2.5.
- Тесты: `canvas/hocuspocus.test.ts` (+4 к readOnly-веткам
  `authenticateCanvasConnection`, +4 новых на `setDrawPermission` —
  влияние на следующее подключение, отзыв переопределяет более раннюю
  выдачу, применение к уже открытому подключению без затрагивания
  чужих, отсутствие документа в памяти не роняет). `rooms/service.test.ts`
  (+2 на пуш canDraw из `updatePermissions`, +3 на
  `setDrawForAllStudents`: авторизация, массовая выдача с проверкой, что
  учителя не трогает, отсутствие обращения к LiveKit).
- **Проверено вживую в браузере (Playwright)**: студенческая роль с
  `canDraw: false` — тулбар рисования (все инструменты фигур, undo/redo)
  полностью скрыт, доступны только зум и панорамирование; переключение
  `canDraw` обратно на `true` мгновенно восстанавливает тулбар — без
  перезагрузки страницы и без пересоздания WS-подключения к `/collab`.
  Как и в остальных задачах Э3, серверная (авторитетная) часть —
  `readOnly` на реальном `Connection` при настоящем сетевом хендшейке —
  не могла быть проверена без Docker/бэкенда; проверена только логика
  вычисления `readOnly` в юнит-тестах и клиентский UX живьём.
- `pnpm build`/`pnpm depcheck` зелёные (116 модулей, 274 связи). Тесты
  бэкенда — 79/79 (было 70, +9).

## Что сделано технически (Э3.9)

- **Реальный пробел, найденный чтением исходника `y-excalidraw`, а не по
  докам**: `ExcalidrawBinding` c Э3.5 получал `provider.awareness` (чтобы
  не падать — см. заметки Э3.5), но курсоры собеседников всё равно не
  показывались бы — класс публикует локальный `pointer` в awareness
  только изнутри своего метода `onPointerUpdate`, а САМ его никогда не
  вызывает. Вызывать обязан потребитель, передав его как проп
  `<Excalidraw onPointerUpdate={binding.onPointerUpdate}>` — это и есть
  единственное реальное изменение, нужное для курсоров: `binding`
  вынесен из локальной переменной эффекта в состояние компонента, чтобы
  быть доступным для JSX.
- Собственное состояние awareness `user` (`name`/`color`/`role`) —
  отдельный эффект, зависящий от `provider`/`me` (объект пользователя из
  `useAuthStore`). Цвет — детерминированный хеш от `userId`, без похода
  на сервер за палитрой.
- **Viewport для «следовать за учителем» — отдельный канал awareness
  (`"viewport"`), не то же самое, что `pointer` у `y-excalidraw`**:
  пакет отслеживает только позицию курсора и `selectedElementIds`, не
  scroll/zoom холста целиком. Свой эффект транслирует
  `scrollX`/`scrollY`/`zoom` через `excalidrawAPI.onScrollChange(...)` в
  awareness (та же формула источника, что уже проверена и заведена в
  Э3.7 для фона — здесь используются сырые числа, а не CSS).
  Учитель ищется по `user.role === "teacher"` среди
  `awareness.getStates()`, не по фиксированному userId — со-учитель тоже
  подошёл бы, что осознанно совместимо с моделью прав из Э3.1.
  Применение — `excalidrawAPI.updateScene({appState: {scrollX, scrollY,
  zoom: {value}}})`; `zoom.value` — брендированный тип
  `NormalizedZoomValue` из типов пакета, приведение явным `as`
  (не `any` — правило CLAUDE.md «pnpm build без any» намеренно
  соблюдено точечным приведением типа, а не отключением проверки).
- Кнопка «Следовать за учителем» видна только не-учителю (`!isTeacher`,
  тот же паттерн гейта роли, что и остальной UI Board.tsx) — учитель не
  следит сам за собой.
- **Проверено вживую в браузере (Playwright)** — то, что можно проверить
  без второго реального участника через живой `/collab` (тут та же
  граница, что во всех задачах Э3 без Docker): кнопка «Следовать за
  учителем» появляется для роли ученика и переключает подпись/состояние;
  переключение при отсутствии реального учителя в awareness корректно
  не падает (`applyTeacherViewport` просто ничего не находит и
  молча выходит); синтетическое `pointermove`-событие по канвасу не
  роняет страницу — подтверждает, что проводка `onPointerUpdate` не
  ломает рендер. **Не проверено и не могло быть проверено**: реальная
  видимость чужого курсора и реальная синхронизация viewport между
  двумя живыми участниками — это требует настоящего WS-хендшейка с
  двух сторон одновременно, недостижимо без Docker/бэкенда в этой среде.
- `pnpm build`/`pnpm depcheck` зелёные (116 модулей, 274 связи). Тесты
  бэкенда не изменились (79/79) — Э3.9 целиком фронтовая.

## Что сделано технически (Э3.10)

- Новая зависимость в `apps/api` (согласована с пользователем перед
  добавлением — выбор между `sharp` и `jimp`, пользователь выбрал `sharp`):
  `sharp@^0.33.5`. Нативный биндинг — добавлен в `pnpm.onlyBuiltDependencies`
  корневого `package.json` (рядом с уже бывшим там `argon2`), иначе pnpm
  молча пропускает postinstall-скрипт пакета и он падает в рантайме без
  собранного биндинга — поймано по факту первого `pnpm install`
  (`Ignored build scripts: sharp@0.33.5`), не по докам.
- **Zod-схема сначала** (`packages/shared/src/canvas.ts`):
  `canvasImageMimeTypeSchema` (`image/png|jpeg|webp`, без SVG — растровый
  ресайз sharp'ом не применим к вектору) и `canvasImageUploadResponseSchema`
  (`storageKey`, `url`, `mimeType`, `width`, `height`). Используется и
  бэкендом (валидация входного mime), и фронтом (тип ответа `apiFetch`).
- **Новый эндпоинт, не переиспользование generic `POST /assets` (Э0.5)** —
  осознанное решение, три причины: (1) generic `/assets` не делает ресайз;
  (2) он не проверяет `canDraw` конкретного урока — только факт
  аутентификации; (3) его TTL подписанной ссылки (1 час, `storage/service.ts`)
  фатален для картинки на доске (см. следующий пункт). Дублировать
  `assetsRoutes` целиком не пришлось — переиспользован `StorageAdapter`
  через существующий `storageService.uploadFile`/`getSignedFileUrl`.
  - `apps/api/src/modules/canvas/images.ts#uploadCanvasImage` — ресайз +
    сохранение. `.rotate()` без аргумента (проверено документацией sharp
    через Context7, не по памяти модели: эквивалент `.autoOrient()` —
    авто-поворот по EXIF `Orientation` с удалением тега) — критично для фото
    с камеры телефона, которое иначе легло бы на бок (EXIF-тег камера
    пишет, пиксели не поворачивает). `.resize({width:2000, height:2000,
    fit:"inside", withoutEnlargement:true})` — официальная замена sharp для
    устаревшего `max().withoutEnlargement()`: не длиннее 2000px по большей
    стороне, никогда не растягивает меньшее изображение. Формат вывода без
    явного `.toFormat()` совпадает со входным (тоже подтверждено доками
    через Context7) — mimeType из входной валидации остаётся верным и для
    результата.
  - `apps/api/src/modules/canvas/routes.ts` — `POST
    /lessons/:id/canvas-images` (multipart, `app.authenticate`), тот же
    паттерн, что `assetsRoutes`. Право загрузки — не просто членство в
    уроке, а именно `canDraw` (Э3.8): вставка картинки меняет содержимое
    холста так же, как штрих.
  - `apps/api/src/modules/canvas/hocuspocus.ts` — рефакторинг:
    роль-проверки, которые раньше были инлайн внутри
    `authenticateCanvasConnection`, вынесены в приватную
    `assertLessonMembership()` (дословный перенос порядка вызовов/текстов
    ошибок — не новая логика) и переиспользованы новой экспортируемой
    `assertCanDrawForLesson()` для HTTP-роута. `authenticateCanvasConnection`
    парсит токен сам (WS-подключение получает голый `token` в payload),
    `assertCanDrawForLesson` — нет: HTTP-роут уже получает провалидированный
    `request.user` от `app.authenticate`, повторный поход в `verifyAccessToken`
    не нужен.
- **Долгий TTL подписанной ссылки — отдельная константа, не общий
  часовой default (`storage/service.ts#getSignedFileUrl` получил
  необязательный параметр `ttlSeconds`)**: `y-excalidraw` синхронизирует
  `BinaryFileData.dataURL` в `Y.Doc` буквально как есть, без своего хука
  переподписи (подтверждено чтением исходника пакета —
  `_remoteFilesChangeHandler` просто перекладывает `yAssets.get(key)` в
  `api.addFiles` на каждом клиенте, без сети). Раз ссылка на изображение
  один раз попадает в бинарное состояние `Y.Doc` и живёт там неограниченно
  (пока жив урок), обычный часовой TTL сломал бы фото на доске уже в
  процессе того же урока. Строить свой механизм переподписи поверх чужой
  библиотеки не стали (пришлось бы дублировать/форкать
  `ExcalidrawBinding#observe` — фрагильно и не по разделу «делегируй
  смело» CLAUDE.md, картинка на доске — не область из списка «не
  делегировать вслепую»); вместо этого — 30-дневный TTL
  (`CANVAS_IMAGE_URL_TTL_SECONDS`, `canvas/images.ts`). Осознанный
  задокументированный компромисс, не тихий пробел: реальный профиль
  использования (доска сейчас видна только во время активного урока в
  `RoomPage`, отдельной страницы «архив досок» ещё нет) укладывается в
  30 дней с большим запасом; если в будущем появится долгоживущий просмотр
  старых досок — потребуется отдельный механизм переподписи URL по
  `storageKey`, не часть этой задачи.
- **Клиент (`apps/web/src/features/canvas/Board.tsx`)** — три пути вставки
  по буквальной формулировке Э3.10 («drag&drop, вставка из буфера, с
  камеры телефона»):
  - Кнопка «Фото на доску» (`<label>`, оборачивающий скрытый `<input
    type=file accept=image/png,image/jpeg,image/webp capture=environment>`)
    — видна только при `canDraw`. `capture="environment"` на мобильных
    подсказывает камеру, на десктопе атрибут игнорируется браузером и
    инпут работает как обычный файловый пикер.
  - `onDropCapture`/`onPasteCapture` на контейнере холста — **именно
    capture-фаза, не bubble**: штатная вставка картинок самого Excalidraw
    (paste/drop) уже отключена с Э3.4 через `UIOptions.tools.image: false`
    (проверено чтением бандла — `isToolSupported("image")` гейтит и
    `pasteFromClipboard`, и внутренний drop-обработчик одним и тем же
    флагом, значит конфликта двойной вставки в принципе нет), но
    собственные слушатели Excalidraw висят на внутренних DOM-узлах
    (canvas), а не на `document` — bubble-фаза на обёртке сработала бы
    ПОСЛЕ них. Capture идёт от корня к цели раньше любого bubble-слушателя
    на потомках, поэтому наш обработчик гарантированно успевает
    `stopPropagation()` первым.
  - Общая функция `insertImageFromFile`: загружает файл, кладёт результат в
    Excalidraw через `excalidrawAPI.addFiles([...])` (сервер уже отдал
    готовую подписанную ссылку — `dataURL` в терминологии пакета попросту
    URL, не обязана быть настоящим `data:`-URI; подтверждено чтением
    `loadHTMLImageElement()` в бандле пакета — `new Image(); image.src =
    dataURL`, обычный `<img src>`, любой валидный URL подходит), затем
    строит сам элемент через официальный публичный хелпер пакета
    `convertToExcalidrawElements([{type:"image", fileId, x, y, width,
    height}])` (не ручная сборка полного `ExcalidrawElement` — это
    задокументированный API именно для программной вставки) и добавляет
    его в сцену `updateScene`. Начальный размер на холсте — не буквальные
    2000px с сервера, а вписан в 480 мировых единиц по большей стороне
    (`PLACED_IMAGE_MAX_SIDE`) с сохранением пропорций — сервер уже сделал
    ресайз под лимит хранения, это отдельное ограничение под удобный
    стартовый размер на экране, дальше масштабируется вручную как обычный
    элемент. Позиция — по центру видимой области, той же формулой
    преобразования координат, что уже проверена и используется в
    `PageBackground.tsx` (Э3.7): `sceneX = screenX/zoom - scrollX`.
- Тесты (`apps/api`):
  - `canvas/images.test.ts` (6 тестов, реальный `sharp`, не мок SDK — тот
    же приём «декодировать реальный артефакт», что в Э2.2/Э3.2): отказ
    неподдерживаемого типа без похода в `StorageAdapter`; уменьшение
    3000×1500 до 2000×1000 с проверкой байт-в-байт через повторное
    декодирование ЗАГРУЖЕННОГО потока (не только по метаданным ответа);
    `withoutEnlargement` — маленькое изображение не растягивается;
    **авто-поворот по EXIF** — синтетический JPEG 200×100 с
    `withMetadata({orientation:6})` даёт на выходе 100×200 (подтверждает,
    что `.rotate()` реально применяет тег, а не просто присутствует в коде
    и ничего не делает); вызов `getSignedFileUrl` именно с 30-дневным TTL,
    не default; `schoolId`/`suggestedName` доходят до `StorageAdapter`
    без изменений.
  - `canvas/hocuspocus.test.ts` (+5 на `assertCanDrawForLesson`): учитель
    своего урока проходит, учитель чужого урока отклоняется раньше
    проверки `canDraw`, ученик без гранта отклоняется, ученик с явно
    выданным `canDraw` проходит, ученик не из группы отклоняется раньше
    `canDraw`. Существующие 23 теста на `authenticateCanvasConnection` и
    сам механизм грейс-периода/sweep не тронуты рефакторингом — все
    прошли без изменений (поведение и тексты ошибок сохранены дословно).
- **Проверено вживую в браузере (Playwright)** — все три пути вставки
  протестированы сквозным сценарием с замоканным `window.fetch` (реальный
  бэкенд недостижим без Docker, как и во всех задачах Э3): клик по кнопке
  → диалог выбора файла → загрузка реального JPEG 3000×1500 (сгенерирован
  `sharp` на диск) → вставленное изображение выделяется как настоящий
  `image`-элемент Excalidraw (панель свойств показывает «Double click to
  crop», не как посторонний DOM-узел); синтетический `drop` с
  `DataTransfer`/`File` добавляет второй элемент; синтетический `paste` с
  `ClipboardEvent.clipboardData` — третий; панель «Stats for nerds»
  подтвердила ровно 3 фигуры в сцене после трёх вставок (без случайных
  дублей от штатного paste/drop-обработчика самого Excalidraw — конфликта
  нет, как и предполагалось по чтению бандла). Отдельно проверено
  `canDraw=false`: кнопка «Фото на доску» не рендерится, синтетический
  `drop` не порождает ни одного запроса на сервер (обработчик выходит
  раньше `fetch` из-за проверки `canDraw` в начале функции). Ни одной
  ошибки в консоли, кроме ожидаемых обрывов WS к недоступному `/collab`.
  Временный dev-роут (`/__dev_board_preview`, с query-параметром
  `?canDraw=false` для второго сценария) добавлялся и полностью удалён
  перед коммитом вместе со сгенерированным тестовым JPEG.
  - **Не проверено и не могло быть проверено в этой среде**: тот же
    инвариант, что и во всех задачах Э3, — реальный HTTP-роут
    (`canvas/routes.ts`) с настоящим Postgres/`StorageAdapter`/JWT и
    настоящая синхронизация вставленной картинки между двумя живыми
    участниками через `/collab`. Серверная логика (ресайз, EXIF,
    авторизация `canDraw`) покрыта юнит-тестами на реальном `sharp`, не
    integration-тестом с БД.
- `pnpm build`/`pnpm test`/`pnpm depcheck` — зелёные. 90/90 тестов бэкенда
  (было 79, +11). `dependency-cruiser`: 123 модуля, 294 связи, без
  нарушений.

## Что сделано технически (Э3.11)

- **Без новых зависимостей** — `Y.UndoManager` уже в составе `yjs`
  (Э3.5), `y-excalidraw` уже принимает его через 5-й аргумент
  конструктора `undoConfig: { excalidrawDom, undoManager }`.
- **«Scope по клиенту» получается сам, без нашего кода фильтрации** —
  это область Y.Doc из списка «не делегировать вслепую» CLAUDE.md,
  поэтому проверено чтением обоих бандлов:
  - `new Y.UndoManager(yElements, { trackedOrigins: new Set() })` —
    пустой набор отслеживаемых origin. `y-excalidraw` внутри
    `setupUndoRedo` сам добавляет привязку:
    `undoManager.addTrackedOrigin(this)`.
  - Локальные правки этого клиента идут в `yElements` с
    `origin === привязка` (бандл `y-excalidraw`:
    `applyElementOperations(yElements, ops, this)`).
  - Удалённые правки `HocuspocusProvider` применяет с
    `origin === сам провайдер` (бандл провайдера:
    `readSyncMessage(decoder, encoder, provider.document, provider)` —
    4-й аргумент это `transactionOrigin`).
  - Значит менеджер захватывает в стек ровно свои изменения и никогда
    чужие: Ctrl+Z у ученика не откатывает штрих учителя. Проверить
    это на ДВУХ живых клиентах в этой сессии нельзя (см. оговорку в
    конце), но инвариант следует из происхождения транзакций.
- **Scope — `Y.Array` именно активной страницы** (`elements:{pageId}`, у
  каждой страницы свой с Э3.6). Поэтому `UndoManager` создаётся,
  подписывается и уничтожается в том же `useEffect`, что и
  `ExcalidrawBinding`, — пересоздаётся при листании страниц. История undo
  не переносится между страницами (ожидаемо: это разные документы-сцены).
- **`undoConfig` заводится только при `canDraw`** — в `viewModeEnabled`
  (ученик без права рисовать, Э3.8) само рисование недоступно, менеджер
  не нужен; лишний `Y.UndoManager` на такого участника не создаётся.
  Отсюда `canDraw` в зависимостях эффекта привязки.
- **Найден и обойдён дефект `y-excalidraw` 2.0.12, пойманный живой
  проверкой (Playwright), не по докам**: пакет перехватывает КЛИК по
  штатным кнопкам Undo/Redo Excalidraw (`_resizeListener` находит их по
  `[aria-label]` и вешает свой обработчик на `Y.UndoManager`), но их
  доступность (`disabled`) остаётся завязанной на РОДНУЮ историю
  Excalidraw. А родную историю тот же `y-excalidraw` через
  `stopPropagation` в своём keydown-хендлере фактически замораживает —
  поэтому родной redo-стек никогда не наполняется и **штатная кнопка
  Redo всегда серая**, а Undo может оставаться активной без причины.
  Решение:
  - Штатный блок `.undo-redo-buttons` спрятан через CSS `display: none`
    (`Board.css`) — **не удалением из DOM**: `y-excalidraw` при
    инициализации всё ещё должен найти их через `querySelector`
    (`_resizeListener` иначе падает с TypeError на `null.addEventListener`).
  - Свои кнопки «↶ Отменить» / «↷ Повторить» в тулбаре `Board.tsx`,
    `disabled` из `undoManager.canUndo()` / `canRedo()`, состояние
    обновляется по событиям `stack-item-added`/`-popped`/`-updated`
    (`ObservableV2` из `yjs` — подписки снимаются в `undoManager.destroy()`
    в очистке эффекта).
  - Клавиши Ctrl+Z / Ctrl+Shift+Z продолжают работать штатным
    keydown-хендлером самого `y-excalidraw` (его не трогали).
- `nextBinding.destroy()` НЕ уничтожает переданный `Y.UndoManager`
  (бандл: `destroy()` только прогоняет `this.subscriptions`) — поэтому
  `undoManager.destroy()` вызывается явно в очистке эффекта.
- **Проверено вживую в браузере (Playwright)** — через imperative API
  Excalidraw (`updateScene`), т.к. синтетические pointer-события к
  Excalidraw ненадёжны:
  - Учитель: добавление 3 фигур → `scene`/`Y.Array` синхронно 3/3;
    Undo (кнопка) → 2/2 → 1/1; Undo (Ctrl+Z) → 0/0; Redo (Ctrl+Shift+Z)
    → 1/1; Redo (кнопка) → 2/2 → 3/3. `disabled`-состояния своих кнопок
    на каждом шаге корректны (Undo серая на 0/0, Redo серая на вершине
    стека). Сцена и `Y.Array` не расходятся ни на одном шаге.
  - Ученик (`canDraw=false`): своих кнопок Undo/Redo нет, штатных тоже
    нет, доска рендерится, **ни одной ошибки в консоли** (в частности —
    `setupUndoRedo` не вызывается, TypeError на отсутствующих кнопках
    тулбара не возникает).
  - Временный dev-роут (`/__dev_board_preview`, с фейковым
    `useAuthStore` и query-параметром `?canDraw=false`) добавлялся и
    полностью удалён перед коммитом.
  - **Не проверено и не могло быть проверено в этой среде**: реальный
    «scope по клиенту» на ДВУХ одновременных живых участниках через
    `/collab` (что Ctrl+Z у одного не трогает правки другого) —
    инвариант выведен из происхождения Yjs-транзакций (см. выше), не из
    наблюдения двух вкладок. Та же граница, что во всех задачах Э3.
- `pnpm build`/`pnpm depcheck` зелёные (123 модуля, 295 связей). Тесты
  бэкенда не изменились (90/90) — Э3.11 целиком фронтовая.

## Что сделано технически (Э3.12)

- **Без новых зависимостей.** Формулировка ПЛАН.md Э3.12: «максимум 500
  элементов на страницу, предупреждение при приближении. Доска не
  деградирует».
- **Это перформанс-ограничитель, не граница доступа** — поэтому
  enforcement клиентский (в отличие от `canDraw`/прав на урок, которые
  авторитетны на сервере). Лимит одинаков у всех клиентов, рисование и так
  под `canDraw`; злонамеренный клиент мог бы обойти, но пострадала бы
  только его собственная доска. `apps/web/src/features/canvas/Board.tsx`,
  константы `PAGE_ELEMENT_LIMIT = 500`, `PAGE_ELEMENT_WARN_AT = 450`.
- **Счётчик — по `Y.Array` активной страницы** (`elements:{pageId}`), не по
  сцене Excalidraw: отдельный `useEffect` c `yElements.observe` →
  `pageElementCount`. Это одно и то же число у всех участников независимо
  от локального состояния рендера.
- **Предупреждение** (в ленте инструментов, видно и ученику):
  - `≥ 450`: янтарное «Элементов на странице: N / 500».
  - `≥ 500`: красное «Лимит 500 достигнут — новые не добавляются, создайте
    новую страницу».
- **Жёсткая обрезка** — проп `onChange` у `<Excalidraw>` (`handleSceneChange`):
  как только живых элементов больше 500, `updateScene` обрезает сцену до
  `slice(0, 500)`. Порядок элементов у `y-excalidraw` детерминирован
  (дробный индекс `pos`, сортировка в `yjsToExcalidraw`), поэтому
  `slice(0, 500)` даёт ОДИН И ТОТ ЖЕ набор на всех клиентах — обрезка
  сходится к 500 у всех, а не «воюет» между вкладками. Различать «своё» и
  «чужое» переполнение не нужно: лимит глобальный, лишнее отбрасывается
  одинаково. `revertingRef` (флаг в `useRef`) гасит рекурсию
  `onChange` → `updateScene` → `onChange`; сбрасывается в `queueMicrotask`.
  Обрезка ловит и пакет (paste/вставка нескольких), пересекающий границу
  (499 + 6 → 500).
- **Что остаётся доступным на полной странице**: удаление и правка
  существующих элементов (обрезаем только при РОСТЕ сверх 500), undo/redo
  (Э3.11). То есть страницу можно разгрузить, а не только бросить.
  Отдельная защёлка в `insertImageFromFile` (Э3.10) — при
  `pageElementCount >= 500` картинка не грузится (сообщение вместо
  запроса на сервер).
- **Проверено вживую в браузере (Playwright)** через imperative API
  Excalidraw (временный dev-роут `/__dev_board_preview`, снят перед
  коммитом; `window.__board`-хук в `Board.tsx` тоже снят):
  - 300 → без баннера; 460 → янтарный «460 / 500»; 499 → «499 / 500».
  - Пакет 499 → +6: сцена и `Y.Array` синхронно приходят к 500/500,
    красный баннер. Пакет +55 сверху — по-прежнему 500/500.
  - Удаление 60 элементов → 440/440, баннер исчез. Добавление 20 →
    460/460, вернулся янтарный. Undo → 440/440. Ни одной ошибки в
    консоли (кроме favicon 404).
  - **Не проверено**: реальная конкурентная гонка двух живых участников,
    каждый из которых доводит страницу до 500 (нужен настоящий `/collab`
    с двух сторон) — сходимость `slice(0, 500)` выведена из
    детерминированного порядка `y-excalidraw`, не из наблюдения двух
    вкладок. Та же граница, что во всех задачах Э3.
- `pnpm build`/`pnpm test`/`pnpm depcheck` зелёные (123 модуля, 295
  связей). Тесты бэкенда не изменились (90/90) — Э3.12 целиком фронтовая.

---

# Э3 завершён технически (2026-08-29)

Все 12 задач Э3.1–Э3.12 закрыты. Гейт Э3 с реальной нагрузкой (RAM
процесса возвращается к базовой линии после серии уроков, синк штриха
< 200 мс между двумя вкладками, доска не деградирует на 500 элементах)
**не прогнан** — как и гейты Э0–Э2, требует `docker compose up` +
нагрузочного инструмента, которых нет в этой среде
([[project_video_platform_env_gaps]]). Серверная часть (аутентификация
`/collab`, персистентность Y.Doc, 5-минутный грейс-период + sweep,
метрика `canvas_active_ydocs`, права `canDraw`, ресайз изображений)
покрыта 90 юнит-тестами бэкенда; клиентская часть проверена вживую в
браузере по каждой задаче, кроме сценариев, требующих ДВУХ одновременных
живых участников через реальный WS-хендшейк.

---

# Архив: Э2 — Аудио (завершён 2026-08-24)

## Стоп-лист Э2

```
НЕ делать на этом этапе:
- НИКАКОГО ВИДЕО. Ни камеры, ни демонстрации экрана.
  В коде не должно быть ни одного упоминания videoTrack.
- не делать сетку плиток — участники по-прежнему списком
- не делать запись
- не делать шумоподавление и Krisp — это Э11
- не оптимизировать преждевременно: simulcast и dynacast относятся к видео
```

## Задачи

- [x] Э2.1 LiveKit в docker-compose, `network_mode: host`, конфиг, порты в
      ufw. Убрать `stun.l.google.com`, поднять свой coturn.
- [x] Э2.2 Модуль `media/`: генерация JWT-токенов по ролям (`livekit-server-sdk`).
- [x] Э2.3 Подключение клиента: `@livekit/components-react`, только аудио.
- [x] Э2.4 Экран проверки устройств до входа.
- [x] Э2.5 Управление микрофонами: мьют себя/учителем/всех, лимит 4 одновременных.
- [x] Э2.6 Активный говорящий: подсветка в списке участников.
- [x] Э2.7 Вебхуки LiveKit → API: посещаемость.
- [x] Э2.8 Индикатор качества связи, предупреждение при packet loss > 3%.

## Что сделано технически (Э2.8)

- **Все нетривиальные факты проверены чтением исходников установленного
  `livekit-client@2.22.0` в `node_modules` напрямую, а не по документации
  Context7** — сверка обнаружила, что автосгенерированные доки для этого SDK
  в нескольких местах расходятся с реальным кодом установленной версии (см.
  ниже). Раз это область WebRTC/LiveKit из списка «не делегировать вслепую»
  CLAUDE.md, каждое расхождение проверено построчно в исходнике, а не принято
  на веру.
- Два независимых механизма, оба в новом `apps/web/src/features/room/ConnectionQuality.tsx`:
  - **`ConnectionQualityDot`** — цветная точка у каждого участника
    («индикатор у каждого участника» из формулировки задачи в
    `docs/ПЛАН.md`). Источник — `participant.connectionQuality`
    (`ConnectionQuality.Excellent/Good/Poor/Lost/Unknown`), который сам
    LiveKit-сервер вычисляет и рассылает всем участникам одинаково
    (`RoomEvent.ConnectionQualityChanged`). Читается тем же безопасным
    паттерном, что `ParticipantPresenceDot`/`MicStatusIcon` из Э2.5/Э2.6:
    `useParticipants().find(identity === userId)`, **не** хук
    `useConnectionQualityIndicator()` из `@livekit/components-react` — он,
    как и `useIsSpeaking()` (см. заметку Э2.6), внутри вызывает
    `useEnsureParticipant()`, который бросает исключение, если участник ещё
    не появился в LiveKit-комнате (проверено чтением
    `useConnectionQualityIndicator.ts`/скомпилированного `room-*.mjs` в
    `node_modules/@livekit/components-react`). Дополнительно проверено чтением
    `allRemoteParticipantRoomEvents` в `@livekit/components-core/src/helper/eventGroups.ts`,
    что `ConnectionQualityChanged` входит в набор событий, на которые
    `useParticipants()` и так перерисовывается по умолчанию — отдельный
    опрос/подписка не нужны.
  - **`PacketLossWarning`** — буквальный порог «> 3%» из `docs/ПЛАН.md`
    Э2.8/§10.10 ТЗ (тот же процент, что и в таблице алертов Grafana),
    показывается **только для собственного микрофона**, не для остальных
    участников. Осознанное отступление от буквального «индикатор у каждого
    участника» для этой конкретной метрики: `getReceiverStats()` на
    подписанном треке удалённого участника отражает потери на пути SFU → я
    (моё собственное нисходящее качество), а не исходящий канал того
    участника — у разных слушателей в одной комнате число для одного и того
    же говорящего физически обязано быть разным, значит показывать его как
    «качество связи Х» было бы вводящим в заблуждение. У `getSenderStats()`
    локального микрофона такой проблемы нет — это единственное соединение с
    SFU, общее для всех наблюдателей.
  - Опрашивает `getSenderStats()` раз в 2 секунды (`setInterval`, не завязан
    на приватную константу `monitorFrequency` LiveKit — та не экспортируется
    из пакета, проверено чтением `dist/src/room/stats.d.ts`). Отношение
    `packetsLost / (packetsSent + packetsLost)` не показывается, пока не
    накопится хотя бы 50 пакетов — иначе сразу после подключения возможен
    шумный/неинформативный процент на маленькой выборке.
- **Расхождения официальной документации (Context7) с реальным кодом
  `livekit-client@2.22.0`, обнаруженные и учтённые**:
  1. Доки показывают `TrackPublication.getStats(): AudioSenderStats | VideoSenderStats | undefined`
     как синхронный метод. В установленной версии такого метода на
     `TrackPublication`/`LocalTrackPublication`/`RemoteTrackPublication`
     **не существует вообще** (проверено `grep` по исходнику пакета) —
     реальные методы асинхронные и лежат на самом треке:
     `LocalAudioTrack.getSenderStats(): Promise<AudioSenderStats | undefined>`
     и `RemoteAudioTrack.getReceiverStats(): Promise<AudioReceiverStats | undefined>`.
     Доступ: `publication.audioTrack?.getSenderStats()`.
  2. Доки показывают у `AudioReceiverStats` поле `packets`. В реальном
     `room/stats.ts` поле называется `packetsReceived`. Для этого этапа
     несущественно (используется только `AudioSenderStats` локального
     микрофона — там `packetsSent`, это поле в доках совпало с реальностью),
     но зафиксировано здесь, чтобы не наступить на те же грабли в Э5
     (видео) или Э6 (замеры).
  3. Перечисление `ConnectionQuality` в доках не включает значение
     `Unknown` (только Excellent/Good/Poor/Lost) — в реальном enum
     (`room/participant/Participant.ts`) оно есть и используется как
     начальное состояние до первого сигнала от сервера; учтено в
     `QUALITY_COLOR`/`QUALITY_LABEL` (серая точка «неизвестно»).
- `pnpm build`/`pnpm test`/`pnpm depcheck` — зелёные, 50/50 тестов бэкенда
  без изменений (задача целиком фронтовая, без новых зависимостей — оба
  использованных пакета уже были согласованы и добавлены в Э2.3).
- **Не проверено вживую в браузере** — как и весь Э2, нет живого бэкенда с
  LiveKit в этой среде, поэтому реальную деградацию канала (искусственный
  packet loss через `tc`/DevTools throttling) не понаблюдать руками. Логика
  выведена из чтения исходников SDK, а не из наблюдения за настоящим RTCP.

## Что сделано технически (Э2.7)

- **Проверено через Context7 по официальной документации LiveKit
  (docs.livekit.io/home/server/webhooks), а не по памяти** — два нетривиальных
  и легко перепутываемых факта: (1) вебхуки шлются с `Content-Type:
  application/webhook+json`, специально ОТЛИЧНЫМ от `application/json`,
  именно чтобы штатные JSON-парсеры фреймворков тело не трогали; (2) подпись
  лежит в обычном заголовке `Authorization` (несмотря на то, что константа
  `authorizeHeader` внутри самого SDK названа `'Authorize'` — это имя для
  другого внутреннего употребления, не для заголовка входящего вебхука; было
  бы легко скопировать не то имя и тихо сломать проверку подписи).
- `apps/api/src/modules/rooms/livekit-webhook.ts` — новый маршрут `POST
  /webhooks/livekit`, **не защищён `app.authenticate`** (это не
  пользовательская сессия, а сам LiveKit-сервер) и зарегистрирован в
  `server.ts` на верхнем уровне, как и `roomsWsRoutes`. Подлинность проверяет
  `WebhookReceiver` (`livekit-server-sdk`) тем же `LIVEKIT_API_KEY/SECRET`,
  что и выдача токенов участникам.
  - Сырое тело для сверки sha256-хэша получено через
    `addContentTypeParser("application/webhook+json", ...)`,
    зарегистрированный в изолированном под-плагине (`app.register(async
    (scope) => {...})`) — Fastify уважает инкапсуляцию плагинов, так что
    дефолтный JSON-парсер на остальных роутах приложения не тронут.
  - 401 при неверной/отсутствующей подписи. Обработка не падает и не «тихо
    доверяет» подмене — юнит-тест намеренно шлёт тело, изменённое ПОСЛЕ
    подписи (другое имя комнаты), и проверяет, что запрос отклоняется
    (`livekit-webhook.test.ts`, 6/6 тестов, включая генерацию настоящей
    подписи через `new AccessToken(...).sha256 = ...` — тем же способом,
    каким это делает собственный тестовый набор SDK).
- `rooms/service.ts` получил два обработчика, оба идемпотентны:
  - `handleParticipantLeftWebhook(livekitRoom, userId)` — доп. страховка для
    журнала посещаемости (`lesson_participants.left_at`), НЕ замена
    основного пути (`leave()` + heartbeat-sweep из Э1 уже закрывают сессию в
    большинстве случаев в течение ~45 сек). Ловит случаи, где ни explicit
    `/leave`, ни закрытие WS не сработали (авария браузера/сети). **Осознанно
    не трогает `presence`/WS-бродкаст** — вебхук не знает про
    `RECONNECT_GRACE_MS`, наивное «участник вышел» отсюда могло бы
    конфликтовать с более аккуратной логикой `markDisconnected`.
  - `handleRoomFinishedWebhook(livekitRoom)` — авторитетный сигнал от
    медиасервера, что комната реально закрылась (независимо от нашего
    15-минутного таймера пустой комнаты); если урок ещё `live`, завершает
    его и рассылает `lesson_status: ended`, как `endLessonNow`, но без
    проверки прав — это системное, не пользовательское действие.
  - **Событие `participant_joined` осознанно не обрабатывается** — запись в
    журнал посещаемости уже создаётся раньше, на HTTP `/join` (Э1,
    `repo.insertJoin`); дублирующий обработчик от вебхука создавал бы риск
    двойной записи без дополнительной пользы.
- `lessons/repo.ts#findLessonByLivekitRoom` + `lessons/service.ts#getLessonByLivekitRoom`
  — сопоставление события с уроком по колонке `livekit_room`, **без фильтра
  по `schoolId`** (осознанное отличие от всех остальных функций модуля):
  вебхук в принципе не знает школу, событие приходит от единого self-hosted
  LiveKit на все школы сразу, а подлинность подтверждается подписью, не
  пользовательской сессией.
- `docker-compose.yml`: в `LIVEKIT_CONFIG` добавлен блок `webhook.urls` →
  `http://127.0.0.1:3000/webhooks/livekit`. **Не через
  `host.docker.internal`** — в отличие от направления `app → livekit`
  (комментарий чуть выше по файлу, из Э2.1), тут `livekit` (тоже
  `network_mode: host`) обращается К `app`, а `app` публикует порт как
  `127.0.0.1:3000:3000` на самом хосте — раз `livekit` физически в
  сетевом пространстве хоста, `127.0.0.1:3000` от него — это и есть
  порт `app`. `webhook.api_key` переиспользует `LIVEKIT_API_KEY`, отдельного
  секрета не требуется. YAML-валидность проверена парсером (не самим
  Docker, как и в Э2.1 — Docker недоступен в этой среде).
- `pnpm build`/`pnpm test`/`pnpm depcheck` зелёные — 50/50 тестов бэкенда
  (было 40, +6 вебхук-роут, +4 обработчики в `rooms/service.test.ts`).
- **Не проверено вживую**: реальный вызов от живого LiveKit-сервера в этой
  среде недостижим (нет Docker) — проверена только логика обработчика и
  верификации подписи против настоящего `WebhookReceiver`/`AccessToken` из
  SDK, не против настоящего сетевого запроса от `livekit-server`.

## Что сделано технически (Э2.6)

- `apps/web/src/features/room/ParticipantPresenceDot.tsx` заменяет прежний
  статичный кружок-индикатор присутствия в списке участников: рендерится
  внутри `<LiveKitRoom>` (только когда `media` установлен, тот же паттерн
  условного рендера, что у `MicStatusIcon`/`SelfMicButton`/`MediaAudioStatus`
  из Э2.3–Э2.5), находит соответствующего LiveKit-`Participant` по
  `identity === userId` через `useParticipants()` и добавляет кольцо
  (`ring-2 ring-green-400`) вокруг точки присутствия, когда тот сейчас
  активно говорит.
- **Сознательно не использован хук `useIsSpeaking()`** из
  `@livekit/components-react`, хотя он для этого и предназначен: внутри он
  вызывает `useEnsureParticipant()`, который **бросает исключение**, если
  переданный `participant` не найден (`match === undefined`) и нет
  окружающего `ParticipantContext`. Сразу после входа в комнату есть реальное
  окно, когда наш собственный `presence`-список (через `/ws`) уже знает об
  участнике, а сигналинг LiveKit до него ещё не дошёл — `match` в этот момент
  `undefined`, и хук уронил бы всю комнату. Вместо хука читается свойство
  `match?.isSpeaking ?? false` напрямую с `Participant` — `useParticipants()`
  и так ре-рендерит компонент на `ActiveSpeakersChanged`, так что реактивность
  не теряется, а падения не будет.
- Задача была маленькой (один UI-компонент, без изменений бэкенда/схем) —
  для неё не заводились отдельные тесты сверх существующих
  `pnpm build`/`pnpm test`/`pnpm depcheck` (все зелёные, 40/40 тестов
  бэкенда без изменений — фронт всё ещё "no tests yet").
- **Не проверено вживую в браузере** — как и весь Э2, нет живого бэкенда с
  LiveKit в этой среде, поэтому реальное определение активного говорящего
  (порог громкости LiveKit) не пронаблюдать руками.

## Что сделано технически (Э2.5)

- **Закрыт пробел, зафиксированный ещё в Э2.2/Э2.3**: `PATCH
  .../participants/:userId/permissions` теперь реально действует на уже
  подключённого к LiveKit участника, не только на следующий вход.
  `apps/api/src/modules/media/service.ts` получил `RoomServiceClient`
  (`livekit-server-sdk`) и функцию `updateLivePermissions()` —
  `roomService.updateParticipant(room, identity, { permission })` с тем же
  грантом (`buildPublishGrant`), что и при выдаче токена в
  `createParticipantConnection()` (вынесено в общую функцию, чтобы грант не
  разъехался между выдачей и live-обновлением). 404 от LiveKit (участник ещё
  не подключался туда) — не ошибка, тихо пропускается: актуальные права он
  получит при первом же `POST /join`.
- **Порядок операций в `rooms/service.ts#updatePermissions` важен и
  сознателен** (читать построчно, §1.2 CLAUDE.md): сперва
  `mediaService.updateLivePermissions()`, и только при его успехе —
  запись в presence (Redis) и WS-бродкаст `permissions_updated`. Если
  LiveKit недоступен, PATCH целиком падает с ошибкой, а не создаёт ситуацию
  «UI показывает, что ученика заглушили, а физически его микрофон всё ещё
  может публиковать звук» — такая рассинхронизация была бы тихой дырой в
  доступе, а не просто багом UI.
- **Лимит 4 одновременных микрофонов учеников** (§5.2 ТЗ,
  [[project_video_platform_media_limits]]) — `countActiveStudentMics()`
  считает участников с `role === "student" && permissions.canSpeak`,
  исключая целевого. `updatePermissions` отклоняет `canSpeak: true` для
  пятого ученика с `409 mic_limit_reached`, если это НЕ переключение уже
  включённого (значит смена других прав того же участника лимитом не
  блокируется). Учителя/админы в счётчик не попадают — им `canSpeak: true`
  по умолчанию (Э1, `presence.defaultPermissions`).
- Два новых эндпоинта, только учитель урока/админ (та же проверка, что и в
  `endLessonNow`/`deleteChatMessage`):
  `POST /lessons/:id/participants/:userId/mute` — принудительный мьют
  одного участника: `mediaService.muteParticipant()` находит его
  опубликованный трек микрофона (`getParticipant` → `tracks.find(source ===
  MICROPHONE)`) и вызывает `mutePublishedTrack(muted: true)`.
  `POST /lessons/:id/mute-all` — то же самое для всех подключённых учеников
  разом (`mediaService.muteMicrophones()`), учителя и со-учителей не трогает.
  **Это «мягкий» мьют**: право `canSpeak` не отзывается, трек просто
  выключается на стороне LiveKit — ученик технически может включить
  микрофон обратно сам через свою кнопку (см. ниже). Отзыв самого права
  говорить — это по-прежнему `PATCH .../permissions` с `canSpeak: false`.
- Фронт: `apps/web/src/features/room/MicSync.tsx` — компонент без UI,
  рендерится внутри `<LiveKitRoom>` рядом с `<RoomAudioRenderer/>`, следит за
  `self.permissions.canSpeak` и дёргает
  `useLocalParticipant().localParticipant.setMicrophoneEnabled()` при
  изменении — закрывает пробел, описанный в заметках Э2.3 (пропс `audio` у
  `<LiveKitRoom>` republish'ится только при (пере)подключении, не при каждом
  изменении права уже подключённому участнику).
- `apps/web/src/features/room/MicControls.tsx`:
  - `SelfMicButton` — «мьют себя», доступен любому с `canSpeak`, чистый
    клиентский тоггл `setMicrophoneEnabled(!isMicrophoneEnabled)`, без
    обращения к серверу (в отличие от учительского мьюта это не право, а
    сиюминутное состояние трека).
  - `MicStatusIcon` — значок 🎙️ в списке участников, если у него сейчас
    реально включён микрофон в LiveKit (`useParticipants()` +
    `isMicrophoneEnabled`, сверка по `identity === userId` — `identity`
    участника в LiveKit равен `userId`, назначается в
    `createParticipantConnection`). Не берётся из `presence`/WS — это
    состояние живёт только в LiveKit и не транслируется через наш `/ws`
    (осознанно, чтобы не дублировать источник истины).
  - В `RoomPage.tsx`: кнопка «Заглушить всех» у учителя рядом с «Поднять
    руку»; «Заглушить» — точечная кнопка учителя в строке участника (только
    если у того `canSpeak`). Обе, как и `MicStatusIcon`/`SelfMicButton`,
    рендерятся только когда `media` установлен (нужен контекст
    `<LiveKitRoom>`) — тот же паттерн условного рендера, что уже был у
    `MediaAudioStatus` в Э2.3.
- Тесты: `media/service.test.ts` мокает `global.fetch` (твёрп-транспорт
  `livekit-server-sdk` — обычный HTTP поверх fetch, подтверждено чтением
  исходника `TwirpRPC.ts`) и проверяет реальную сериализацию гранта/mute-
  запроса, а не мок самого SDK. `rooms/service.test.ts` замокал
  `../media/service.js` (иначе `updatePermissions` бил бы по сети в тестах)
  и добавил кейсы: лимит на пятом ученике, что переключение других прав уже
  говорящего не блокируется лимитом, откат при сбое LiveKit-синхронизации,
  доступ только у учителя/админа к обоим новым роутам, «мьют всех» не
  трогает учителя. Итого 40/40 тестов зелёных
  (`pnpm build`/`pnpm test`/`pnpm depcheck` чистые).
- **Не проверено вживую в браузере** — как и Э2.3/Э2.4, нет живого бэкенда с
  LiveKit в этой среде.

## Что сделано технически (Э2.4)

- `apps/web/src/features/room/DeviceCheckScreen.tsx` — экран показывается
  всем участникам (и учителю, и ученику) **до** входа в урок: до этого шага
  теперь не выполняется ни HTTP `POST .../join`, ни открытие `/ws`, ни тем
  более подключение к LiveKit — `RoomPage` рендерит только этот экран, пока
  пользователь не нажмёт «Войти в урок».
- Реализовано на голом Web Audio API/`MediaRecorder`, а не на готовом
  `<PreJoin>` из `@livekit/components-react`: у библиотечного компонента
  по умолчанию есть и камера, и превью видео — это противоречило бы
  стоп-листу Э2 (никакого видео, даже в виде запроса `getUserMedia({video})`
  на этом экране). Свой компонент запрашивает только `{ audio: true }`.
- Выбор микрофона: `enumerateDevices()` после первого `getUserMedia` (лейблы
  устройств доступны только после выдачи разрешения); при смене устройства в
  `<select>` старый `MediaStream` останавливается и запрашивается новый с
  `deviceId: { exact }`.
- Индикатор уровня: `AnalyserNode` + `getByteTimeDomainData`, RMS
  считается в `requestAnimationFrame`-цикле; полоска обновляется напрямую
  через `ref.style.width`, а не через `setState` на каждый кадр — иначе
  60 ре-рендеров/сек всего дерева `RoomPage`.
- Тест эха: `MediaRecorder` пишет 3 секунды в `Blob`, `URL.createObjectURL` →
  скрытый `<audio>`, кнопка «Прослушать». Без сервера — целиком в браузере.
- **Если доступ к микрофону не дан или устройства нет** — экран не блокирует
  вход: показывает ошибку и всё равно даёт нажать «Войти в урок» (тогда
  `deviceId` уходит `null`, аудио в комнате попробует подключиться с
  устройством по умолчанию браузера или явно не будет публиковаться, если
  права `canSpeak` нет). Это соответствует §1.2 ТЗ — сбой стороннего/локального
  устройства не должен останавливать урок.
- Выбранный `deviceId` не сохраняется между заходами (никакого
  localStorage/sessionStorage, железное правило CLAUDE.md) — только
  `useState` на время сессии `RoomPage`, передаётся в `<LiveKitRoom
  audio={{ deviceId }}>`.
- `useRoomSocket` получил третий параметр `enabled` (по умолчанию `true`) —
  используется, чтобы не открывать `/ws` до прохождения проверки устройств.
- `pnpm build`/`pnpm test`/`pnpm depcheck` — зелёные. Как и Э2.3, **не
  проверено вживую в браузере** (нет живого бэкенда в этой среде).

## Что сделано технически (Э2.3)

- `apps/web/src/features/room/RoomPage.tsx`: после успешного `join()` (уже
  содержит `media.token`/`media.url` из Э2.2) весь контент страницы
  оборачивается в `<LiveKitRoom serverUrl token connect audio={canSpeak}
  video={false}>` из `@livekit/components-react`, плюс `<RoomAudioRenderer />`
  для воспроизведения удалённых аудиотреков. Пока `media` не пришёл — страница
  рендерится как раньше, без LiveKit (`if (!media) return content`).
- **`video={false}` — жёстко, соответствует стоп-листу Э2.** `audio` берётся
  из `self.permissions.canSpeak` (право из Э1) — если учитель это право не
  дал, свой микрофон не публикуется вообще.
- `apps/web/src/features/room/MediaAudioStatus.tsx` — маленький дочерний
  компонент на `useConnectionState()`, показывает статус LiveKit-подключения
  рядом со статусом основного `/ws` в шапке урока. Должен рендериться только
  внутри `<LiveKitRoom>` (иначе `useRoomContext()` внутри хука падает) —
  поэтому в JSX условно `{media && <MediaAudioStatus />}`.
- **Важно для Э2.5, проверено через Context7 по исходникам
  `components-js/packages/react/src/hooks/useLiveKitRoom.ts`**: пропс `audio`
  переиспубликовывается только по событию `SignalConnected` (первый коннект и
  реконнекты), а не при каждом изменении пропса после того как участник уже
  подключён. Значит когда учитель поменяет `canSpeak` уже подключённому
  ученику (`PATCH .../permissions`), простое обновление пропса `audio` эффекта
  не даст — Э2.5 должен явно дёргать
  `useLocalParticipant().localParticipant.setMicrophoneEnabled()`.
- Новых зависимостей в `apps/web`: `livekit-client`, `@livekit/components-react`
  (согласовано с пользователем). CSS-пакет компонентов (`@livekit/components-styles`)
  не подключён — не используются визуальные компоненты вроде `ParticipantTile`,
  только `RoomAudioRenderer` (без UI) и хук `useConnectionState`.
- **Не проверено вживую в браузере** (DoD-пункт "фича проверена руками") —
  нужен запущенный бэкенд с Postgres/Redis/LiveKit, недоступно без Docker в
  этой среде (см. известные пробелы). Проверены только `pnpm build`
  (typecheck строгий, es-бандл собирается, хоть и с предупреждением о
  размере чанка — `livekit-client` тяжёлый, это ожидаемо) и `pnpm test`/`depcheck`.

## Что сделано технически (Э2.2)

- `apps/api/src/modules/media/service.ts` — единственный экспорт модуля.
  `createParticipantConnection()` подписывает LiveKit access-токен через
  `livekit-server-sdk` (`AccessToken`, проверено через Context7 по
  `node-sdks/packages/livekit-server-sdk`, v2 API — `toJwt()` асинхронный).
  TTL = время до конца урока + 15 минут (§8.4 ТЗ), с полом в 60 секунд на
  случай выдачи токена уже после расчётного конца урока.
- **Жёсткое ограничение стоп-листа Э2 на уровне токена, не только UI**:
  `canPublish` повторяет право `canSpeak` участника (Э1), но
  `canPublishSources: [TrackSource.MICROPHONE]` всегда — камеру и демонстрацию
  экрана нечем публиковать, даже если клиент попытается в обход интерфейса.
  `canPublishData: false` — данные комнаты (чат, команды) идут через уже
  существующий `/ws` (Э1), не через LiveKit Data Channel, это осознанное
  расхождение с §8.2 ТЗ, сделанное ещё в Э1.
- Имя комнаты LiveKit хранится в `lessons.livekit_room` (колонка уже была в
  схеме с Э0, просто не использовалась) — назначается один раз при первом
  входе через `lessonsService.ensureLivekitRoom()`, идемпотентно
  (`WHERE livekit_room IS NULL`). Это даёт Э2.7 (вебхуки) прямой путь
  сопоставить событие LiveKit с уроком по колонке, а не парсить строку.
- `packages/shared/src/media.ts`: `mediaConnectionSchema` (`token`, `url`),
  добавлено полем `media` в `joinLessonResponseSchema` — токен и публичный
  URL LiveKit выдаются вместе с `POST /lessons/:id/join`, отдельного
  эндпоинта нет (соответствует `POST /lessons/:id/join` в §8.1 ТЗ).
- Тесты (`media/service.test.ts`) декодируют реально выпущенный JWT
  (`jose.decodeJwt`) и проверяют `video.canPublish`/`canPublishSources`/
  `canPublishData` напрямую — не мок, а настоящая проверка того, что уйдёт
  на клиент. 27/27 тестов зелёные, `pnpm build`/`depcheck` чистые.
- **Важно для Э2.5**: смена прав (`PATCH .../permissions`) на уже выданный
  токен не действует — LiveKit-грант зашит в JWT на момент выдачи. Учителю
  придётся либо переподключать клиента с новым токеном, либо (вероятно
  правильный путь) использовать `RoomServiceClient.updateParticipant()` для
  живого обновления прав уже подключённого участника. Это нерешённая часть
  Э2.5, не Э2.2 — только зафиксировано здесь, чтобы не забыть.
- Зависимость `livekit-server-sdk` добавлена в `apps/api` (согласовано с
  пользователем перед добавлением).

## Что сделано технически (Э2.1)

- `docker-compose.yml`: сервисы `livekit` (`livekit/livekit-server:latest`,
  `network_mode: host`) и `coturn` (`coturn/coturn:latest`, `network_mode: host`).
  `app` и `caddy` получили `extra_hosts: host.docker.internal:host-gateway`,
  т.к. `network_mode: host` делает livekit недостижимым по имени сервиса из
  моста (bridge) — только через шлюз хоста.
- **Конфиг LiveKit не в отдельном `livekit.yaml`, а в `LIVEKIT_CONFIG`**
  (multiline env в docker-compose.yml). Причина, подтверждённая через Context7
  (`pkg/config/config.go` самого LiveKit): YAML-файл читается без раскрытия
  переменных окружения (кроме пути `key_file`), а `TURN_DOMAIN`/секреты обязаны
  идти через env по железному правилу CLAUDE.md — значит статический
  закоммиченный `livekit.yaml` с реальными значениями невозможен без нарушения
  правила. Ключи API — через `LIVEKIT_KEYS` (штатная переменная сервера).
  Это осознанное отступление от буквального списка файлов в §10.5 ТЗ
  ("livekit.yaml" в git), сделано ради правила про env, а не вместо него.
- **TURN: отдельный coturn, не встроенный TURN LiveKit** — решение
  пользователя (2026-08-23) после того, как я нашёл расхождение: актуальная
  документация LiveKit прямо продвигает свой встроенный TURN как основной
  путь, а ТЗ (§3.2, §10.5) требует отдельный coturn. Оставили по ТЗ.
- coturn слушает только UDP/TCP 3478 (STUN+TURN, без TLS). **TLS на 5349
  сознательно не включён** — coturn с `--tls-listening-port` без реального
  сертификата на `TURN_DOMAIN` просто не запустится; получить сертификат
  для TURN-домена — отдельная операционная задача при разворачивании на
  боевом домене (нужен домен и ACME/certbot для этого поддомена, не только
  для основного, который обслуживает Caddy). Порт 5349 в ufw открыт заранее.
- Caddyfile.prod: `/rtc/*` проксируется на `host.docker.internal:7880`
  (не `localhost:7880` — это был бы сам контейнер caddy, не хост; ТЗ-пример
  в этом месте неточен, см. `git log` для деталей правки).
- `scripts/server-setup.sh`: ufw открывает 7880/tcp, 7881/tcp, 50000:60000/udp,
  3478/tcp+udp, 5349/tcp.
- `.env.example`: `LIVEKIT_URL` (серверный, для генерации токенов/вебхуков),
  `LIVEKIT_PUBLIC_URL` (браузерный), `LIVEKIT_API_KEY/SECRET`, `TURN_DOMAIN`,
  `TURN_SHARED_SECRET`.
- Новых npm-зависимостей ещё не добавлено — Э2.1 это только инфраструктура
  (docker-compose/конфиги). `livekit-server-sdk` и клиентские пакеты
  потребуются в Э2.2/Э2.3 и должны быть согласованы с пользователем отдельно
  перед добавлением (железное правило CLAUDE.md).

## Definition of Done — что подтверждено, а что нет (Э2.1)

- [x] `pnpm build`/`pnpm test`/`pnpm depcheck` — зелёные (код `apps/api`,
      `apps/web`, `packages/shared` не менялся в Э2.1, только инфра-файлы).
- [x] `docker-compose.yml` — валидный YAML (проверено парсером, не самим Docker).
- [ ] **Реальный запуск `docker compose up` с `livekit`/`coturn` не проверен**
      — в среде по-прежнему нет Docker. Кроме того, `network_mode: host`
      штатно не работает на Docker Desktop (Windows/Mac) — эти два сервиса
      можно поднять только на настоящем Linux-хосте (прод), не на машине
      разработчика с Windows. Это дополнительный, отдельный от отсутствия
      Docker риск для локальной проверки.
- [ ] Гейт Э2 (`livekit-cli load-test --audio-only`) не прогонялся — нужен
      живой LiveKit.

## Известные пробелы (нужны от пользователя)

1. Docker по-прежнему недоступен в этой среде (см. [[project_video_platform_env_gaps]]
   в памяти) — ни `docker compose up`, ни гейты Э1/Э2 прогнать нельзя.
2. `network_mode: host` для `livekit`/`coturn` требует Linux — на Windows
   через Docker Desktop эти сервисы не поднимутся даже если поставить Docker.
   Реальная проверка Э2.1 возможна только на Linux (прод-сервер или отдельная
   Linux VM/CI-раннер).
3. TLS для coturn (TURNS, 5349) отложен — нужен сертификат на `TURN_DOMAIN`,
   это делается при разворачивании на боевом домене (Э0.8), не раньше.
4. Перед Э2.2 нужно согласовать с пользователем добавление зависимости
   `livekit-server-sdk` (backend); перед Э2.3 — `livekit-client` и
   `@livekit/components-react` (frontend). Пока не добавлены.
