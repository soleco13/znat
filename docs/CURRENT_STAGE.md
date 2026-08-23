# Текущий этап: Э2 — Аудио

Начато: 2026-08-23, в той же сессии, что закрыла Э1 (гейт Э1 отложен из-за
отсутствия Docker в среде — решение пользователя, см. ниже и Э1 в git-истории).

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
- [ ] Э2.6 Активный говорящий: подсветка в списке участников.
- [ ] Э2.7 Вебхуки LiveKit → API: посещаемость.
- [ ] Э2.8 Индикатор качества связи, предупреждение при packet loss > 3%.

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
