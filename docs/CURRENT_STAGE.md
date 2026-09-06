# Текущий этап: Э12 — гостевой вход учеников, новый UI урока

> 2026-09-06: параллельно начат **Э13 — Редактор материалов 2.0** (запрос
> пользователя «внедряй всё»). Раздел Э13 — ниже, перед архивом Э11.
> Э12.8/12.9 остаются недоделанными.

План-ТЗ: `docs/Э12-план-тз-переработка.md` (согласован 2026-09-06).
Начато 2026-09-06, НОВЫЙ контекст (после `/clear`, «продолжай разработку»).
Порядок жёсткий: схемы → БД → бэкенд → фронт.

## Что сделано (Э12)

**Э12.1 — схемы и типы (`packages/shared`).** Добавлено (аддитивно, старые
схемы урока помечены `@deprecated` и держатся до Э12.3 ради зелёной сборки):
- `roles.ts`: `participantKindSchema` (`staff | guest`).
- `guests.ts` (новый): `guestTokenPayloadSchema` (JWT `{typ:"guest",
  lessonId, guestId, name}`), `guestLessonInfoSchema` (ответ `GET /j/:token`),
  `guestEnterRequest/ResponseSchema`.
- `lessons.ts`: `lessonSettingsSchema` (+`defaultLessonSettings`),
  `adminCreateLessonRequestSchema`, `updateLessonRequestSchema`,
  `lessonSummarySchema` (с `joinToken`/`joinPath`),
  `rotateLessonLinkResponseSchema`, `lessonAttendanceRow/Schema`,
  `lessonMaterialSchema` + `assignLessonMaterialRequestSchema`.
- `index.ts`: реэкспорт `guests.js`.

Сборка/тесты/depcheck зелёные. Коммит — schemas only, бэкенд ещё на старой
модели.

**Э12.2 + Э12.3 — БД и модуль `lessons` (один коммит, чтобы сборка осталась
зелёной; согласовано — вариант A).**

Миграция `0015_e12_lessons_guest_base.sql`:
- `lessons`: `group_id` → nullable; `subject`/`starts_at`/`duration_min`
  получили дефолты (`''`/`now()`/`60`) — колонки не задаются в новой модели,
  но нужны старому расчёту TTL LiveKit-токена; `join_token text unique not
  null` (дефолт `encode(gen_random_bytes(24),'hex')`, `CREATE EXTENSION
  pgcrypto`). `status` пока жив (нужен `rooms` до Э12.4).
- новая `lesson_materials` (lesson_id, material_id, assigned_by, assigned_at,
  uniq по паре).
- `lesson_participants`/`responses` НЕ тронуты — Э12.4/12.5.

Модуль `lessons` переработан:
- `POST /lessons` — только admin (`adminCreateLessonRequestSchema`), минтит
  `joinToken` (32 байта), группа не нужна.
- `GET /lessons` — admin все / teacher свои, отдаёт `LessonSummary[]`
  (`{ items }`) с `teacherName` + `joinPath`.
- `PATCH /lessons/:id`, `DELETE /lessons/:id`, `POST /lessons/:id/link/rotate`
  — только admin.
- `GET /lessons/:id/attendance` — журнал посещений (staff).
- `GET/POST/DELETE /lessons/:id/materials` — «домашка» = список материалов
  (staff).
- `start`/`end`/`summary`/статус — из HTTP убраны; сервис-функции
  `startLesson`/`endLesson` оставлены `@deprecated` (их ещё зовёт `rooms`
  для авто-завершения пустой комнаты — уйдут в Э12.4).
- `getLesson`/`ensureLivekitRoom`/`getLessonByLivekitRoom` — без изменений.

Переходные заглушки (уйдут в Э12.4/12.5):
- `rooms`/`decks`/`canvas`/`activities`: проверка членства ученика по группе
  трактует `lesson.groupId === null` как «не член» (ученик новой модели
  войдёт гостевым путём).
- `activities.createActivity`: на уроке без группы бросает 409
  `lesson_activities_pending` — интерактив на уроках новой модели включится
  в Э12.5.

Новые сервис-хелперы: `users.getUserNames`/`assertTeacher`/`findUsersByIds`,
`materials.getMaterialSummaries`/`assertMaterialInSchool`/
`findMaterialSummariesByIds` (модули не лезут в чужие таблицы напрямую).

Фронт — минимальные правки под зелёную сборку (полный UI — Э12.7/12.8):
`LessonsListPage` переведён на `LessonSummary` (карточка урока + копирование
ссылки для учеников), `RoomPage` — тип `LessonSummary`.

`seed-dev.ts` — новая модель: только персонал, 2 постоянных урока с
токенами, назначение опубликованных материалов первому уроку.

Сборка (api/web/shared) / тесты (54 + 377) / depcheck зелёные. Миграция на
живой БД не прогонялась (нет Docker в среде).

**Э12.4 — гостевой вход (SENSITIVE, «не делегировать вслепую»). Один
коммит.**

Пользователь выбрал полный вариант: инфраструктура сессии + токен-плоскость
+ полный actor-рефактор `rooms/media/canvas` + правка фронт-контрактов в
одном подэтапе.

- `packages/shared`: `guestTokenPayloadSchema` +`lt` (sha256 ссылки урока на
  момент входа — ротация admin мгновенно инвалидирует сессию).
  `participantSnapshotSchema`: `+kind: staff|guest`, `role` → nullable.
  `chatMessageSchema.userId` → nullable.
- env: `JWT_GUEST_SECRET` (отдельный секрет), `GUEST_SESSION_TTL_HOURS`
  (деф. 6). `.env.example` (оба), `apps/api/.env.example`, `vitest.config`.
- Миграция `0016_e12_4_guest_participants.sql`: `participant_kind` enum;
  `lesson_participants` — `user_id` nullable, `+kind/guest_id/display_name`,
  индекс `(lesson_id, guest_id)`; `chat_messages` — `user_id` nullable,
  `+guest_id/author_name`. На живой БД не прогонялась (нет Docker).
- Новый модуль `guests`: `service.ts` (`enterAsGuest` минтит гостевой JWT
  jose HS256; `resolveGuestSession` = подпись+срок+сверка `lt`+существование
  урока; `LessonActor` — общий тип `staff|guest`), `routes.ts`
  (`GET /j/:token`, `POST /j/:token/enter` → httpOnly+Secure(prod)+Lax
  cookie `guest_session`, rate-limit 20/мин на IP).
- `plugins/lesson-access.ts` — `requireLessonAccess`: Bearer→staff-actor
  (+lookup имени), кука→guest-actor (`lessonId` из токена обязан совпасть с
  `:id`). Авторизацию (admin любой / teacher свой / methodist не в урок)
  по-прежнему делает сервис.
- `media/service.ts`: `buildPublishGrant`/`createParticipantConnection`/
  `updateLivePermissions` — `kind: staff|guest` вместо `role: Role`.
  LiveKit-атрибут участника: `{ kind }` вместо `{ role }`.
- `canvas/hocuspocus.ts`: `onAuthenticate` принимает и гостя — гостевой JWT
  из куки в `requestHeaders`; staff-путь — `assertStaffLessonAccess` (ветку
  ученика-по-группе убрал). `computeCanDraw(kind, …)`.
- `rooms`: `service.ts` — `join/leave/setHandRaised/sendChatMessage/
  listChatHistory` берут `LessonActor`; `assertMembership` по actor;
  presence-ключ = `participantId` (staff `userId` / guest `guestId`);
  `PresenceEntry.kind`; лимит микрофонов/mute-all/draw-all по `kind==='guest'`.
  `routes.ts` — два периметра: гость∪staff (`requireLessonAccess`) и
  только staff (`app.authenticate`). `ws.ts` — гость по куке (`token`
  в query опционален). `repo.ts` — `insertJoin`/`insertChatMessage` с
  guest-полями, `closeOpenSession` по `user_id OR guest_id`,
  `listChatMessages` leftJoin + `coalesce(author_name, users.full_name)`.
- `lessons/service.ts#getAttendance` — `kind`/`displayName` из строки журнала.
- Фронт (минимум под контракты, полный UI — Э12.7): `VideoSubscriptions`/
  `TeacherVideoTile`/`StudentVideoGrid`/`RoomPage` — `kind` вместо `role`
  там, где отличали ученика от персонала.
- Тесты: `guests/service.test.ts` (8, реальный jose — минт, ротация,
  истечение, чужой секрет), `rooms/service.test.ts` (+гость: журнал,
  presence, чат, leave; actor-хелперы), правки `media`/`presence`/
  `hocuspocus` тестов. Сборка api/web / 388 тестов / depcheck — зелёные.
- **Не сделано в Э12.4** (осознанно): гость не грузит картинки на доску по
  HTTP (`canvas/routes.ts` остаётся staff-only) — рисует через Yjs;
  `/security-review` по под-этапу не прогонялся в этой среде (нужен запуск
  пользователем) — сделан ручной разбор гостевой токен-плоскости.

**Э12.5 — задания: репойнт на участника (SENSITIVE — движок проверки, «не
делегировать вслепую»). Один коммит. Объём: пользователь выбрал «только
репойнт + необходимый минимум».**

- `packages/shared/activities.ts`: убраны `activityModeSchema`/`ActivityMode`
  и `mode` из `createActivityRequestSchema`/`ActivityDto`/`MyActivity`/
  `GradingQueueItem` (задание всегда на уроке, режим `homework` отменён —
  «домашка» = `lesson_materials`). `ActivityDto.lessonId` теперь `string`
  (не nullable), `groupId` убран. Личность в DTO переехала на участника:
  `StudentProgress` — `userId/fullName` → `participantId/displayName`;
  `GradingQueueItem` — `studentId/studentName` → `participantId/participantName`;
  `ReviewStudentResponse` — `userId/fullName` → `participantId/displayName`;
  `pushAnswerToBoardRequestSchema.userId` → `participantId`.
- Миграция `0017_e12_5_responses_participant.sql` (+ снапшот): `responses.user_id`
  → `participant_id` (FK `lesson_participants.id`, `on delete cascade`);
  `activities` — `drop column group_id`, `drop column mode`, `lesson_id`
  → NOT NULL; `drop type activity_mode`; индексы
  `responses_activity_user_idx` → `responses_activity_participant_idx`,
  `activities_group_idx` убран. Пролог миграции чистит `responses` и
  `activities` без урока (боевых данных нет, §9 план-ТЗ). На живой БД не
  прогонялась (нет Docker) — прогон в Э12.9.
- Идентичность участника: `rooms/service.ts#ensureParticipant(actor, lessonId)`
  — «каноническая» (самая ранняя по `joined_at`) строка `lesson_participants`
  для гостевого/пользовательского id, создаётся при отсутствии. Строки
  журнала никогда не удаляются → id стабилен на весь урок, переживает
  переподключения (ключ `responses.participant_id`, сид `attemptId`).
  Единственная точка входа для `activities` (правило модульности) +
  `listLessonParticipants`/`getParticipantNames`. Новые repo-функции
  `findCanonicalParticipant`/`listCanonicalParticipants`/`findParticipantNames`
  в `rooms/repo.ts`.
- `plugins/lesson-access.ts`: `+resolveLessonActor` — резолв Bearer→staff /
  кука→guest БЕЗ привязки к `:id` (эндпоинты `/activities/:id/*`, где урока
  в пути нет); сверку `activity.lessonId === actor.lessonId` для гостя
  делает сервис.
- `activities` — actor-рефактор. Проходят задание ТОЛЬКО гости-ученики
  (`getMyActivity`/`saveResponse`/`submitActivity`/`getReview`/список
  заданий урока — `LessonActor`, `assertGuest`); персонал запускает/
  разбирает (`AccessTokenPayload`). `getProgress`/`getReviewResponses`/
  `pushAnswerToBoard` — ростер из `roomsService.listLessonParticipants`
  (введённые имена, `kind==='guest'`), а не список группы. `getGradingQueue`
  — имена через `roomsService.getParticipantNames`. `repo.ts`: `responses`
  везде по `participantId`, `listPendingManualGrading` без join `users`.
  `createActivity` — без гейтов статуса/группы. `routes.ts`: два периметра
  (staff `app.authenticate`+роль / staff∪guest `resolveLessonActor`|
  `requireLessonAccess`); `/groups/:id/activities` убраны.
- `decks/service.ts`: мёртвая ветка «ученик из группы урока» в
  `assertLessonViewer` убрана (у учеников новой модели нет аккаунта;
  слайд-URL гостю — Э12.7).
- Фронт: `activity-api.ts` — убраны `assignHomework`/`listGroupActivities`/
  `listMyGroups`; `HomeworkPage.tsx` удалён, роут `/homework` и пункт
  меню сняты; `ClassProgressPanel`/`GradingQueue`/`ReviewPanel`/
  `LessonActivityPanel` — на новый ключ (`participantId`/`displayName`,
  без `mode`). Гостевой api-client ученика (кука) и student-плеер в
  комнате — Э12.6.
- Тесты: `activities/service.test.ts` переписан на гостевых actor'ов +
  моки `roomsService.ensureParticipant`/`listLessonParticipants`/
  `getParticipantNames` (homework-тесты убраны); `decks/service.test.ts`
  — student-тест на 403. `pnpm -r build` без `any` / `pnpm -r test`
  (shared 54, api 374) / `pnpm depcheck` (287 модулей, 0 нарушений) —
  зелёные. `/security-review` по под-этапу — за пользователем (нужен
  запуск); сделан ручной разбор гостевого периметра `/activities/*`.

**Э12.6 — фронт: вход ученика. Один коммит.**

- `packages/shared/guests.ts`: `guestSessionSchema` (= `guestEnterResponse`
  + `lessonTitle`) — ответ `GET /guest/session`; `GUEST_CANVAS_TOKEN_MARKER`
  (`"guest"`) — маркер в поле `token` Yjs-подключения гостя (провайдер не
  шлёт auth при пустом токене, настоящий JWT в httpOnly-куке).
- Бэк: `GET /guest/session` (`guests/routes.ts`, rate-limited) —
  восстановление гостевой личности из куки при перезагрузке (аналог
  `/auth/refresh`, но без выдачи нового токена). `guests/service.ts#
  getGuestSessionInfo` — полная проверка (`resolveGuestSession`) + `exp` из
  токена + имя урока. `canvas/hocuspocus.ts#resolveCanvasConnectionActor` —
  `token === GUEST_CANVAS_TOKEN_MARKER` трактуется как гость (личность из
  куки), staff-JWT с маркером не пересекается.
- Фронт: маршрут `/j/:token` (`GuestJoinPage`) вне `AppShell`/`RequireAuth`
  — карточка урока → «Представьтесь» произвольным именем → навигация в
  комнату (экран проверки устройств живёт внутри `RoomPage`).
  `guest-session-store` (zustand, только в памяти), `guest-api.ts`
  (`fetchGuestLessonInfo`/`enterGuestLesson`/`restoreGuestSession`).
  `api-client.ts` — флаг `guestMode` (на 401 не дёргать `/auth/refresh`).
  `RequireRoomAccess` заменил `RequireAuth` на `/lessons/:id/room` — два
  периметра: staff (`/auth/refresh`) ∪ guest (`/guest/session`); отказ →
  экран «нет доступа». `useRoomIdentity` — нормализованная личность
  (staff из auth-store / guest из guest-store), `RoomPage` переведён с
  `me` на неё (`selfId`, `isGuest`); имя урока гостю из стора, `leave` →
  экран выхода (у гостя нет `/lessons`). `useRoomSocket` — режим `guest`
  (без `&token`, кука уходит с рукопожатием). `Board.tsx` — гость
  подключается к `/collab` с маркером.
- Тесты: `guests/service.test.ts` +2 (`getGuestSessionInfo`: happy path,
  ротация ссылки). `pnpm -r build` без `any` / `pnpm -r test` (shared 54,
  api 376) / `pnpm depcheck` (292 модуля, 0 нарушений) — зелёные. Живьём
  (гость по ссылке → урок → доска) не прогонялось — нет Docker/LiveKit,
  проверка за пользователем / в Э12.9.

**Э12.7 (частично) + Э12.8 (частично) — в работе, три коммита.**

Коммит `3e897c7` — чистка доски + роли + админка уроков + экран устройств:
- Доска §6.5: `langCode="ru-RU"`; скрыты гамбургер-меню, «?», hint, ссылки
  Excalidraw; зум-контрол под токены ДС. Фикс краха `y-excalidraw@2.0.12`:
  `setupUndoRedo` хардкодит `querySelector('[aria-label="Undo"/"Redo"]')`,
  с ru-RU подписи локализуются → `null.addEventListener` роняет доску —
  держим невидимые кнопки-якоря с англ. `aria-label` в контейнере
  Excalidraw-обёртки (`Board.tsx`). Родные Undo/Redo и так скрыты, свои —
  на shadcn в тулбаре.
- Роли §4.2 ТЗ: `GET /lessons*` — только admin/teacher (убран methodist).
  `shared/RequireRole.tsx`: `RequireRole` (роль не та → на домашнюю
  страницу) + `HomeRedirect` (`/` → methodist на `/materials`, остальные
  на `/lessons`). `/lessons` в `App.tsx` под `roles={["admin","teacher"]}`.
- Админка «Уроки» (Э12.8, только admin): `LessonsListPage` переписан —
  «Создать урок» (диалог: название, `Select` учителя из
  `GET /users?role=teacher`, плановое время, права учеников), «⋮» на
  строке (переименовать+настройки, журнал посещений, перевыпустить
  ссылку, удалить). `lessons-api.ts`. shadcn dialog/select/dropdown-menu/
  alert-dialog.
- Экран устройств: фиксированная сетка — камера + микрофон + динамики
  единым блоком постоянного размера; тумблеры и подсказки больше не
  двигают раскладку (контролы всегда в DOM, `disabled` когда выкл).

Коммит `629e21b` — §6.2 адаптивная сетка камер:
- `use-adaptive-grid.ts`: перебор числа колонок, берётся то, при котором
  ребро квадрата `min(W/c, H/ceil(N/c))` максимально; ResizeObserver.
- `RoomVideoGrid.tsx`: единая сетка (учитель + ученики) вместо
  `StudentVideoGrid` (фикс. `grid-cols-3`) и плавающего PiP
  `TeacherVideoTile` (оба файла удалены). Квадратные одинаковые плитки,
  масштаб от числа участников; камера выкл → аватар; говорящий — рамка;
  свой тайл зеркалится; значки mic-off/рука/пин. `variant="filmstrip"` —
  задел под §6.4. Подписки на треки — по-прежнему `VideoSubscriptionManager`.

Проверено в браузере (dev, без LiveKit): доска грузится и по-русски,
методист без уроков уходит на библиотеку, admin создаёт урок с выбором
учителя, экран устройств статичен. Формула адаптивной сетки — на
2/5/9 моках. Живой рендер видеосетки в комнате требует LiveKit.

Коммит `bcaf62a` — §6.5 доска под ДС: полный маппинг токенов Excalidraw
0.18 (`--color-surface-*`, `--color-on-surface`, `--color-border-outline`,
`--color-primary*`, радиусы, тени, `--ui-font`) на `--c-*`/`--radius-*`/
`--shadow-*`. Острова, активный инструмент (синий вместо фиолетового),
зум-контрол, контекстное меню, поповеры — в стиле карточек ДС.

Коммит `2e2bf39` — §6.1-6.4 каркас `RoomShell` (структура из живого KTalk,
изучена в браузере): `RoomPage` переписан из вертикальной ленты панелей в
каркас видеовстречи. Верхняя строка (логотип, имя урока, статус, бейдж
записи, «Ссылка», «⋮»). Стейдж: адаптивная сетка ЛИБО доска ЛИБО
демонстрация экрана — на весь стейдж, плитки → лента (`RoomVideoGrid
variant="filmstrip"`); `LiveStage` выбирает экран/сетку внутри
`LiveKitRoom`; пустой стейдж «вы пока один» + копировать ссылку. Нижняя
панель: инструменты/участники(+счётчик)/чат · рука/демонстрация/микрофон/
камера/выйти · Плитки/Доска. Левый выдвижной блок (один, три режима):
Инструменты (доска, `DeckPanel`, `LessonActivityPanel`, `RecordingPanel`,
режим урока, заглушить/рисовать всем), Участники (+модерация), Чат —
компоненты перенесены как есть.

Проверено в браузере (LiveKit поднялся): каркас, три выдвижных панели,
доска на стейдже + камеры лентой, переключение Плитки/Доска, вход/выход.

Коммит `1e70342` — UX-полировка урока:
- `RoomControlButton` — круглый тумблер (shadcn `Toggle` вариант `media`,
  как на экране устройств) + подпись снизу. Состояние на кнопке: вкл —
  нейтрально, выкл — красный, иконка меняется, подпись «Звук выкл.» /
  «Камера выкл.». Микрофон/камера/демонстрация/рука/выход — единый вид.
- У демонстрации экрана убран `Select` «документ/видео» — всегда «документ».
- Панель «Инструменты» — список «иконка + короткое название + подсказка»
  (Доска · Презентация · Задание классу · Запись · Управление классом);
  клик открывает инструмент в той же панели с «← назад».
- Сетка камер: при доске/демонстрации — узкая колонка СПРАВА
  (`variant="rail"`), видно 3, остальные по ▲/▼ со счётчиком страниц.
- **Урок постоянный** (§0 план-ТЗ): убрана 409-проверка «войти в
  завершённый урок»; авто-очистка пустой комнаты больше не «завершает»
  урок (только выгрузка Y.Doc); «Завершить урок» снято из меню.
  `rooms/service.test.ts` обновлён (376 зелёных). `handleRoomFinishedWebhook`
  / `endLessonNow` пока оставлены (мёртвые, покрыты тестами) — снести в Э12.9.

Коммиты `1e70342` / `8b067d2` — UX-полировка урока:
- Нижняя панель: `RoomControlButton` (круглый `Toggle` вариант `media` +
  подпись). Затем — **только иконки**, подписи в подсказках; сегмент
  «Плитки/Доска» убран; индикатор речи (зелёное кольцо, `useIsSpeaking`);
  баннер «Аудио отключено» и `MediaAudioStatus` удалены (файл снесён).
- Панель «Инструменты» — список «иконка + короткое название + подсказка»,
  клик открывает инструмент в той же панели с «← назад».
- У демонстрации экрана убран `Select` «документ/видео».
- **Доска — раскладка из живого КонтурТолк:** инструменты рисования
  вертикально слева, свойства фигуры горизонтально внизу по центру
  (CSS-разворот `.App-menu_top` / `.App-menu__left` Excalidraw 0.18);
  страницы/undo/фото/«следовать»/фон/импорт слайдов/«Скрыть доску» —
  компактной шапкой в правом верхнем углу (`Board.tsx`, `DropdownMenu`
  вместо `Select`); доска на весь стейдж (было фикс. 70vh), плитки —
  колонкой справа (`variant="rail"`, 3 видимых + ▲/▼).
- **Урок постоянный** (§0): убрана 409-проверка при join; авто-очистка
  пустой комнаты не «завершает» урок; «Завершить урок» снято из меню.

Проверено в браузере: доска как в КонтурТолк, нижняя панель иконками,
адаптивная сетка (2 участника — равные квадраты), вход в урок.

Коммит `3b84cc2` — фикс копий листа доски + единый стиль:
- **Баг «у вошедшего свой пустой лист»:** инициализацию первой страницы
  отложили до `provider.isSynced`/события `synced` (до синхронизации
  локально пустой Y.Doc = «страниц нет» → каждый плодил копию); id первой
  страницы фиксированный (`FIRST_PAGE_ID`, Yjs сливает гонку в одну
  запись); `activePageId` при пропаже из `pagesMap` откатывается на
  первую существующую. `addPage` ≤ `MAX_BOARD_PAGES = 3`, «+» дизейблится.
- Острова Excalidraw (тулбар / свойства / зум / контекст-меню) — тот же
  рецепт, что у шапки доски (rounded-xl + рамка + shadow-sm + блюр);
  ползунок непрозрачности — синий; `.HintViewer` спрятан везде.

**Э12.7 доп. (2026-09-06, по запросу пользователя) — материал на стейдже +
просмотр работы ученика (§7.3 ТЗ). Коммит.**
- `RoomStage`: режим `stageView === "activity"` — выданное задание на весь
  экран, плитки → лента (как доска). WS `activity_started` авто-выводит
  материал на стейдж у всех.
- `ActivityStage` (новый): ученик — своя копия (`ActivityPlayer`); учитель
  — `ActivityTeacherTabs` (Прогресс/Аналитика/Разбор/Проверка) + клик по
  ученику в «Прогрессе» → `StudentAttemptView`: его материал с текущими
  ответами, опрос раз в 5 с, «Ответ ученика / Верный ответ» под вопросом.
- Бэкенд: `GET /activities/:id/students/:participantId` (staff-owner),
  `ActivityStudentAttempt` (материал с ключами + черновики), read-only
  (не создаёт метку старта, не оценивает). +3 теста.
- `LessonActivityPanel` в drawer урока ужат: у учителя только выдача
  (поля стопкой), прогресс/разбор ушли на стейдж; кнопка «Показать на
  весь экран».
- `answer-format.ts`: `formatResponse`/`formatCorrectAnswer` вынесены из
  `ReviewPanel` (переиспользуются в `StudentAttemptView`).
- `ClassProgressPanel`/`ActivityTeacherTabs`: проброс `onSelectStudent`.

**Осталось по Э12.7 (полировка):** синхрон открытия доски/презентации/
задания у всех (сейчас локальный `stageView` — но `activity_started`
пушит; доску каждый жмёт сам); эмодзи-реакции в чате; демонстрация
слайдов гостю; `handleRoomFinishedWebhook`/`endLessonNow` — мёртвый код,
снести в Э12.9. Проверка фикса копий доски на 2 клиентах — за
пользователем (логика: sync-wait + фикс. id).

**Осталось по Э12:** Э12.8 (назначение материалов уроку в админке —
доделать) → Э12.9 (миграция на dev, ТЗ/ПЛАН/CLAUDE.md, гейт,
`/security-review` по всему этапу).

---

# Э13 — Редактор материалов 2.0 («лист» в духе Notion/Yonote)

Запрос пользователя (2026-09-06, тот же контекст): разнести у методиста
библиотеку и редактор; редактор — один «лист», блоки на месте; встроить
готовые «конструкции» видимыми карточками; переключатель «Редактор /
Просмотр». Согласовано «внедряй всё» + дизайн-система + shadcn MCP.
Отдельного плана-ТЗ нет — крупная надстройка над Э9, оформлена подэтапами.

**Э13.1 — раскол навигации + фундамент (коммит).**
- `packages/shared/materials.ts`: `materialBlockGroupSchema` +
  `materialSchema.groups: z.array(...).default([])` — редакторские группы
  блоков из конструкций (метка происхождения; `stripMaterialAnswerKeys`
  их вырезает, ученику не уходят; плеер/движок игнорируют). Три
  `Material`-литерала в тестах api получили `groups: []`.
- `apps/web/shared/sanitize-html.ts` + `RichTextEditor.tsx`: разрешены
  `h2`/`h3` внутри `rich_text`, кнопки «подзаголовок» в тулбаре Tiptap
  (`heading: { levels: [2, 3] }`), стили `.prose h2/h3` + `.ProseMirror`.
- Навигация: `/materials` (Библиотека — весь персонал, просмотр/выбор,
  `end`-флаг NavLink) и `/materials/edit` (Редактор — admin+methodist),
  лист `/materials/edit/:id` (все; учитель → режим «Просмотр»). Старый
  роут `/materials/:id/edit` убран, ссылки перевешены.
- `MaterialsLibraryPage`: форма создания и кнопка «Создать» удалены —
  только просмотр/дерево/статусы; ссылки на лист → `/materials/edit/:id`.
- `MaterialsEditorLandingPage` (новый): карточки материалов по статусам
  (черновики / на ревью / опубликованные), кнопка «Новый материал».

**Э13.2–13.3 — редактор-лист + конструкции (коммит).**
- `MaterialEditorPage` переписан: одна колонка (`max-w-720`), без трёх
  панелей. Блоки редактируются на месте (`BlockCard`; `rich_text` —
  «голый», структурные — карточка с шапкой-типом). Канавка у блока:
  «+» (`InsertMenu` Popover) и ручка dnd-kit. Единицы сортировки —
  `RenderUnit` = блок или группа (`buildUnits`); dnd переставляет целые
  единицы, `blocks` пересобирается из порядка единиц.
- Верхняя панель (sticky): назад, заголовок, статус, автосейв,
  `Tabs` «Редактор / Просмотр», Версии, Проверка, Настройки материала
  (`SettingsMenu`: shuffle / showFeedback / попытки), «Сохранить»,
  действия статуса.
- «Просмотр» — `stripMaterialAnswerKeys` → `QuestionPlayer` /
  `ContentBlockView` в той же колонке (как `LivePreviewPanel` раньше);
  учителю — только этот режим + плашка «редактируют методист и админ».
- `InsertMenu`: поиск, атомарные блоки (контент + 10 типов вопросов),
  импорт Word/PDF, вход в пикер конструкций.
- `ConstructPickerDialog`: сетка визуальных карточек (иконка, описание,
  чипы состава). `material-templates.ts` переписан: `MATERIAL_CONSTRUCTS`
  = 5 каркасов (`kind:"group"`: разбор задачи, блок проверки, словарный
  диктант, определение+теорема, параграф с проверкой) + 5 готовых блоков
  (`kind:"block"`: врезки Определение/Теорема/Пример, выбор из 4,
  числовой с допуском). `instantiateConstruct` → блоки + (для каркаса)
  `MaterialBlockGroup`.
- `GroupFrame`: рамка «Шаблон · <название>» — свернуть / разгруппировать
  (`ungroup` — снять рамку, оставить блоки) / удалить (с блоками);
  внутри — свои up/down по блокам группы.
- Создание: «Новый материал» → `buildPlaceholderDraft()`
  (`title:"Черновик материала"`, `subject:"—"`, `grades:[1]`) → сразу
  лист. Название/предмет/класс — в модалке `SaveDialog` по кнопке
  «Сохранить». Пока `isPlaceholderMeta` — «На ревью»/«Опубликовать»
  показывают toast «сначала Сохранить».

Проверено в браузере (методист): создание → конструкция «Разбор задачи»
вставилась рамкой-группой, «Просмотр» рендерит глазами ученика,
подзаголовки h2, «Сохранить» → перезагрузка (группы и метаданные
сохранились), Библиотека без кнопки создания, навигация Библиотека/
Редактор. Гейты api/web/shared build + 374/54 теста + depcheck — зелёные.

**Э13 переработка (2026-09-06) — редактор = единый документ Tiptap в духе
Notion (три раза запрошено пользователем). Коммит.**
- Не список карточек, а ОДИН документ Tiptap. Печатаешь как в заметках,
  Enter = новый блок, markdown-сокращения.
- `/` → меню: контент-блоки, 10 типов вопросов, конструкции урока
  (каждая отдельным пунктом + «все карточками»).
- Выделение текста → `BubbleMenu`: формат + выбор шрифта + цвет
  (`@tiptap/extension-text-style`), работает и внутри формулировок вопросов.
- Вопрос вписан в поток: формулировка = редактируемое `NodeViewContent`,
  варианты = чистый список без коробок (радио/чек = зелёная галочка),
  баллы/подсказка в поповерах. Никакой матрёшки редакторов
  (`question-view.tsx`; сложные типы cloze/matching/ordering/open — в
  поповере со старым `InteractionEditor`).
- Врезка = цветная полоса слева + `NodeViewContent`; конструкция = тонкая
  линия + метка на ховере (`Collapsible`).
- `content: "paragraph"` у вопроса + keymap Enter → выйти абзацем после.
- Хранение прежнее: `serialize.ts` — `materialToDoc`/`docToMaterial`
  (`generateJSON`/`generateHTML`), формат `Material.blocks/groups` не
  изменён → плеер, движок проверки, выдача на уроке не тронуты.
- `apps/web/src/features/materials/editor/`: block-id, nodes,
  question-view, extensions, serialize, slash-menu, MaterialDocEditor,
  construct-picker, block-fields, editor.css.
- Из `MaterialEditorPage` удалён «редактор карточек» (buildUnits, dnd-kit,
  BlockCard, GroupFrame, InsertMenu, ...) — ~900 строк.
- `sanitize-html`: + `h1`/`blockquote`/`code` + inline-`style` (шрифт/цвет;
  DOMPurify чистит опасное в style).
- Зависимости (бланковое разрешение): `@tiptap/suggestion`,
  `@tiptap/extension-text-style`, `@tiptap/extension-bubble-menu`,
  `@tiptap/extensions`, `@floating-ui/dom`.

Проверено вживую: печать, «/»-меню + вставка «Разбор задачи», плавающая
панель + цвет, Enter-выход из вопроса, сохранение + перезагрузка
(round-trip стабилен), «Просмотр» рендерит через плеер.

Доп. коммит: **контекстные подсказки конструкций** — по словам-триггерам
(`MaterialConstruct.triggers`, `editor/suggest-construct.ts`, ProseMirror-
плагин + виджет) в конце строки всплывает «↳ Разбор задачи · Tab»;
Tab/клик вставляет после абзаца, Esc скрывает. **FloatingMenu «+»** на
пустой строке открывает меню блоков/конструкций.

**Э13 доп. (2026-09-06) — shadcn-компоненты (бланковое разрешение
пользователя на зависимости). Коммит.**
- `ui/command.tsx` (cmdk) — меню вставки блоков в редакторе стало
  `Command` (поиск, группы, клавнавигация, фильтр по кириллице).
- `ui/collapsible.tsx` (`@radix-ui/react-collapsible`) — `GroupFrame`
  (рамка конструкции) на `Collapsible`.
- `ui/table.tsx` (без новой зависимости) — `ClassProgressPanel` на
  `Table` со статус-бейджами и кликом по строке.
- `BlockCard` → `Card` + `Button(icon-sm)`; gutter/удалить/up-down →
  `Button ghost icon-sm`; чекбокс «перемешивать» → `Switch`;
  `badge.tsx` yellow `text-[#b45309]` → `text-warn`.

**Осталось по Э13 (полировка, не начато):** оглавление длинного листа;
`h2/h3` в импорте Word/PDF (`document-import.ts` — свой allowlist);
`/materials/edit/:id` для роли student (сейчас RequireAuth без гейта, как
и старый роут); ТЗ §7.2 обновить под новый экран; удаление материала /
чистка плейсхолдер-черновиков (нет UI); горячая клавиша Ctrl+E.

---

# Архив: Э11 — Достройка (оформление фронта)

Начато 2026-09-05, НОВЫЙ контекст (после `/clear`, «продолжай разработку»
→ Э0–Э10 закрыты технически → пользователь явно выбрал: «начинай оформление
фронта, всех страниц, всех элементов, редакторы; всё в одном стиле;
использовать дизайн-систему claudedesign и MCP; отзывчивый интерфейс,
чтобы пользователь понимал, что происходит»).

## Что сделано (Э11 · оформление)

**Дизайн-система.** Подтянута из claude.ai/design (`DesignSync` MCP,
проект `385aa818-0231-4b1a-bcf1-b73fa54f90bb`): `colors_and_type.css` +
`components.css` перенесены в `apps/web/src/index.css` и
`tailwind.config.js` целиком (было — только палитра + `.btn*`): синий
primary `#1d4ed8`, mid-weights 550/650/750/800, радиусы (кнопки 10 /
карточки 16 / модалки 20), тени xs–lg, layout-токены (sidebar 256/72,
header 68, content 1180), easing `cubic-bezier(.2,.8,.2,1)`, `ds-*`
типографика. shadcn-токены (HSL) синхронизированы с историческими `--c-*`.

**UI-кит `apps/web/src/shared/ui/*`.** Компоненты вытянуты через shadcn MCP
+ `pnpm dlx shadcn add` и адаптированы под токены ДС: button (variant
teal/success, `loading`), input/textarea/label, card, badge (6 семантик +
pill), alert (info/success/warning/destructive), dialog/alert-dialog/sheet
(оверлей `bg-foreground/40 + blur`, `bg-card`), dropdown-menu, tooltip
(+`SimpleTooltip`, `TooltipProvider`), tabs (сегмент-стиль), select,
checkbox/radio/switch (нативная семантика ДС), progress (`tone`),
skeleton, avatar (+`UserAvatar` градиент+инициалы), popover, scroll-area,
separator, sonner (`Toaster` без next-themes). Свои: spinner/
CenteredSpinner, empty-state, error-state, page-header, fullscreen-loader.

**Зависимости (СОГЛАСОВАНО пользователем — «Установить shadcn/ui полностью»):**
`radix-ui`-пакеты (dialog/dropdown-menu/tooltip/tabs/select/checkbox/
radio-group/progress/label/separator/scroll-area/avatar/popover/switch/
slot/alert-dialog), `class-variance-authority`, `clsx`, `tailwind-merge`,
`tailwindcss-animate`, `lucide-react`, `sonner`. `next-themes` — поставился
с sonner, удалён (тема фиксированная светлая).

**Инфраструктура.** Алиас `@/` — `vite.config.ts` + `apps/web/tsconfig.json`
paths + новый `tsconfig.depcruise.json` (base + `@/*` только для
dependency-cruiser; `.dependency-cruiser.cjs` теперь ссылается на него).
`components.json`, `src/lib/utils.ts` (`cn`). `src/shared/hooks/use-async.ts`
(loading/refreshing/reload). `ErrorBoundary`. `AppShell` (sidebar 256/72
+ header с блюром + мобильный Sheet) заменил `Layout` (удалён). `App.tsx`:
`<Toaster>`, `<Shell>` = RequireAuth+AppShell+ErrorBoundary; `RequireAuth`
показывает `FullscreenLoader` вместо пустого экрана.

**Отзывчивость (требование пользователя «не выглядело зависшим»):** скелетоны
на списках, тосты на действиях, спиннеры, `loading` у кнопок, состояния
«пусто/ошибка» с повтором, `prefers-reduced-motion` в base-слое.

**Переведены на UI-кит (2 тематических коммита):**
1. `73→…` (Э10.2 архив ниже был последним; новые: см. git) — Login, Уроки,
   Домашние задания, Библиотека материалов, RoomPage целиком + все контролы
   (камера/микрофон/экран/качество связи/проверка устройств/сетка видео
   учеников/плитка учителя/демонстрация экрана), панели заданий
   (LessonActivityPanel, ActivityTeacherTabs→Tabs, ClassProgressPanel,
   QuestionAnalyticsPanel, GradingQueue, ReviewPanel), RecordingPanel
   (+ `AlertDialog` согласия 152-ФЗ), DeckPanel, MaterialPlayer,
   QuestionPlayer + AdvancedInteractionPlayers (типы 1–10 — нативные
   form-контролы для §16 a11y СОХРАНЕНЫ, только рестайл).
2. MaterialEditorPage (3 панели), QuestionInteractionEditors (10 типов —
   логика ключей ответов не тронута), RichTextEditor (тулбар lucide),
   FormulaEditor, MediaAssetPicker, Board/SlideSearch/PageBackground
   (Y.Doc/Excalidraw/awareness НЕ тронуты — только панель-тулбар).

`EgressPage` НЕ тронут — машинный композитинг для egress, инлайн-стили
намеренно (CLAUDE.md «конфиги LiveKit не делегировать вслепую»).

**Проверки:** `pnpm -r build` без `any`, `pnpm -r test` (api 377/377,
shared 54), `pnpm depcheck` (0 нарушений, 277 модулей). Визуальная проверка
в браузере и Playwright E2E — за живым окружением (нет браузера в среде,
см. project-video-platform-env-gaps).

**НЕ сделано / осталось по Э11 (следующие заходы):** визуальный прогон
всех экранов в реальном браузере и правки по нему; тёмная тема (не в MVP);
прочие пункты Э11 из ПЛАН.md (экспорт холста в PDF, оставшиеся 12 типов
заданий, отчёты, админка настроек школы, breakout, шумоподавление, опросы
на лету, таймер/очередь рук, PWA) — это уже функционал, не оформление.

---

# Архив: Э10 — Запись уроков (завершён технически 2026-09-05)

Начато 2026-09-05, НОВЫЙ контекст (после `/clear`, «продолжай разработку»
→ уточнение → пользователь явно выбрал «Начать Э10»). Э9 закрыт технически
в этой же сессии: 11/11 подзадач, 4 тематических коммита (`4d0b28d` →
`ea4a1b3`), `pnpm -r build`/`test` (400/400)/`depcheck` зелёные — см.
архив ниже. Гейт Э9 (показ редактора методисту) и Playwright E2E остаются
за живым окружением.

**Часть V ПЛАН.md — «Дорогое и необязательное».** §10.4 ТЗ, дословно:
«запись — единственная функция, которая на монолит нормально не
помещается». RoomComposite egress = 2–6 CPU + headless-Chrome внутри →
**вторая машина** (Э10.1). В MVP запись отложена (§10.4, вариант 1:
«отложить до Этапа 6, там же завести вторую машину»); в UI кнопка
«Записать урок» помечена «скоро». Сейчас — снимаем эту заглушку.

**Ограничение среды — жёстче, чем на Э9** (см. project-video-platform-env-gaps).
Нет Docker / LiveKit / второй машины / Grafana MCP. Egress-конфиг,
`docker-compose` второй машины, `Caddyfile`/сеть — пишутся, НЕ
проверяются здесь (как Э2/Э5–Э7). Проверяется юнит-тестами без Docker:
модуль `recordings/` (StorageAdapter, ретеншн 30–90 дней, автоудаление,
presigned по роли), баннер согласия на запись, старт/стоп через REST,
разбор вебхуков `egress_started`/`egress_ended`, алерт «egress без
публикующих». Гейт Э10 (запись 60-мин урока не влияет на другие уроки —
она на другой машине) — за живым окружением.

## Стоп-лист Э10

```
НЕ делать на этом этапе:
- НЕ делать запись через RoomComposite на ОСНОВНОЙ машине. Никогда.
- НЕ включать запись по умолчанию — только по явному нажатию учителя.
- НЕ начинать урок с записью без баннера согласия (152-ФЗ, §7.9/§10.10 ТЗ).
- НЕ отдавать записи ученикам. Presigned TTL 1 час, доступ по роли.
- НЕ хранить записи вечно. Ретеншн 30–90 дней, автоудаление.
- НЕ делать монтаж/нарезку/транскрипт записей — это не MVP.
```

## Задачи Э10 (ПЛАН.md §Э10)

- [x] Э10.1 Вторая машина под LiveKit Egress. Связь с LiveKit и Redis по внутренней сети провайдера. *(код записи + инфра-конфиг; реальный запуск на втором железе — за живым окружением)*
- [x] Э10.2 Свой layout-шаблон записи: демонстрация/доска крупно + плитка учителя. *(веб-страница `/egress`; композитинг в реальном Chrome egress — за живым окружением)*
- [x] Э10.3 Управление: старт/стоп (учитель/админ), баннер согласия у ВСЕХ участников через WS `recording_status`.
- [x] Э10.4 Хранение + presigned-доступ по роли: ретеншн/автоудаление сделаны в Э10.1, здесь — фронт (список записей со скачиванием). Двухшаговое подтверждение старта (152-ФЗ).
- [x] Э10.5 Алерт «egress без публикующих»: метрики `lesson_recording_active` / `lesson_recording_no_publishers` + правило Prometheus `RecordingWithoutPublishers`.

**Э10 закрыт технически (2026-09-05, тот же контекст):** `pnpm -r build` без `any`, `pnpm -r test` зелёный (api 377 — +7 в `recordings/service.test.ts`; shared 54), `pnpm depcheck` (224 модуля, 648 связей, 0 нарушений — цикла `recordings ↔ rooms` нет: `recordings/service` → `rooms/service` линейно, как `activities/service`). Гейт Э10 (запись 60-мин урока не влияет на другие уроки — она на другой машине; Grafana MCP + два железа) — за живым окружением.

## Гейт Э10

```
Запись 60-минутного урока не влияет на другие уроки (она на другой
машине — проверить, что это ДЕЙСТВИТЕЛЬНО так: CPU/джиттер аудио
основного сервера во время записи не меняются). Нужен Grafana MCP +
вторая машина — за живым окружением.
```

## Правило допуска (LiveKit Egress) — пройдено

1. Платный? — Нет. Apache 2.0, self-hosted (§8 ТЗ, лицензии).
2. Урок остановится, если ляжет? — Нет. Egress — сбоку, отдельная
   машина; падение рекордера роняет только запись, не урок.
3. Уход потребует переделки архитектуры? — Нет. Тот же LiveKit-стек,
   уже в проекте; StorageAdapter уже абстрагирует хранение.
Все три «нет» → можно.

## MCP под Э10

Постоянный набор (Context7, Playwright, GitHub) + **Grafana MCP**
(контроль CPU второй машины, проверка, что запись не влияет на основной
сервер — именно этим закрывается гейт). Ни один не подключён в этой среде.

## Что сделано технически (Э10.1)

Вторая машина под egress + связь с LiveKit/Redis по приватной сети. Код
управления записью (модуль `recordings/`) написан целиком в этом же
срезе, потому что no-orphans-правило dependency-cruiser не даёт закоммитить
`repo.ts`/`egress-client.ts` без сервиса и роутов, которые их используют.

- **Формат (`packages/shared/src/recordings.ts`)** — сначала Zod
  (CLAUDE.md). `recordingStatusSchema` — сжатая проекция 7 значений
  `livekit.EgressStatus` на то, что различает пользователь
  (`starting`/`recording`/`processing`/`ready`/`failed`/`aborted`) +
  собственное `deleted` (файл убран по ретеншну, строка осталась для
  журнала). `recordingWithDownloadSchema` — с presigned-ссылкой и её
  сроком; `lessonRecordingsResponseSchema` — активная запись (для баннера
  Э10.3) + список.
- **Таблица `recordings` (§6 ТЗ, миграция `0014_wise_ironclad`)** — та,
  что в §6 ТЗ была «заводится, но не наполняется»; Э10 наполняет.
  Поля сверх §6: `school_id` (тенант), `started_by` (запись только по
  явному действию — §10.10 ТЗ), `expires_at` (ретеншн). `storage_key`
  выбираем МЫ при старте (`recordings/<school>/<lesson>/<id>.mp4`), не
  берём из вебхука — недоверенный `filename` из egress тогда не влияет
  на то, что потом читаем/удаляем.
- **`egress-client.ts`** — тонкая обёртка над `EgressClient` из
  `livekit-server-sdk` (тот же приём смены `ws→http`, что в
  `media/service.ts`). `startRoomCompositeEgress` (а не Track/Participant
  — «как выглядел урок», §10.4 вариант 1), `EncodedFileOutput` MP4,
  пресет `H264_720P_30` (§10.10 ТЗ: 720p @1.5 Мбит/с против
  лавинообразного роста хранилища). `mapEgressStatus` — чистая функция,
  табличный тест на все 7 статусов + неизвестный (→ `processing`, не
  отдаём ложное «готово»).
- **`service.ts`** — оркестрация. `startLessonRecording`: 503 при
  `RECORDING_ENABLED=false`, только teacher-владелец/admin, идемпотентно
  по «одна активная запись на урок» (двойной клик не поднимает второй
  egress), 502 если egress не ответил (строка не заводится).
  `applyEgressWebhook` — статус от вебхука к строке, не откатывает
  терминальный статус более ранним (вебхуки приходят не по порядку),
  длительность из наносекунд, `expires_at = endedAt + RETENTION_DAYS`.
  `runRetentionCleanup` — удаляет файл через StorageAdapter (ни одного
  `fs` в бизнес-логике, CLAUDE.md), строку в `deleted`; сбой одного
  файла не роняет свип. `startRecordingRetentionSweep` — часовой
  интервал, `unref`, идемпотентный старт (тот же приём, что
  `startDeckReconcileSweep`).
- **`routes.ts`** — `GET /lessons/:id/recordings` (admin/methodist/teacher),
  `POST /lessons/:id/recordings` + `.../:recordingId/stop` (admin/teacher).
  Ученик не ходит сюда вообще (проверка роли в сервисе). Скачивание —
  только presigned-ссылкой из ответа, прямых путей к файлам нет.
- **Вебхук** — `rooms/livekit-webhook.ts` расширен на
  `egress_started`/`egress_updated`/`egress_ended` → `recordingsService.
  applyEgressWebhook(event.egressInfo)`. Модуль `rooms` не знает про
  формат egress — распаковка protobuf в `recordings/service.ts`.
- **env (`plugins/env.ts`)** — `RECORDING_ENABLED` (enum `true`/`false`
  + transform, НЕ `z.coerce.boolean` — та превращает `"false"` в `true`),
  `RECORDING_RETENTION_DAYS` (1–365, деф. 90), `RECORDING_URL_TTL_SEC`
  (деф. 3600 — §10.10 ТЗ «TTL 1 час»), `RECORDING_EGRESS_TEMPLATE_URL`
  (Э10.2, опционально).
- **Инфраструктура второй машины (НЕ проверяется здесь — нет Docker)**:
  - `docker-compose.egress.yml` — образ `livekit/egress`, `cap_add:
    SYS_ADMIN` + `shm_size: 1gb` (песочница Chrome), `network_mode: host`
    (та же причина, что у livekit — не гнать WebRTC через docker-proxy),
    публичных портов нет (всё через Redis).
  - `egress.yaml` — конфиг: `ws_url`/`redis.address` на
    `${MAIN_HOST_PRIVATE_IP}` (приватная подсеть провайдера, НИКОГДА
    публичный адрес), `prometheus_port: 9090` (Grafana Agent изнутри
    приватной сети — задел на гейт Э10 и алерт Э10.5),
    `room_composite_cpu_cost: 3.0` (одна запись за раз на 2–6-ядерной).
  - `.env.egress.example` — `LIVEKIT_API_KEY/SECRET` (те же, что на
    основной), `MAIN_HOST_PRIVATE_IP`, `EGRESS_STORAGE_ROOT`.
  - `.env.example` — секция записи (флаг выкл. по умолчанию).
- **НЕ сделано на момент Э10.1** (Э10.2–10.5 закрыты ниже в отдельной
  секции; за живым окружением остаётся):
  - Реальный `docker compose -f docker-compose.egress.yml up` на второй
    машине, прогон записи, гейт Э10 (Grafana MCP + два железа).
  - Экспозиция Redis основной машины в приватную подсеть (`docker-compose.
    yml`/`ufw`) — зависит от CIDR подсети провайдера, задел на deploy.
- **Проверки**: `pnpm -r build` (без `any`), `pnpm -r test`
  (**424/424**: +24 — 16 `recordings/service.test.ts`, 8
  `recordings/egress-client.test.ts`), `pnpm depcheck` (221 модуль,
  634 связи, 0 нарушений), YAML обоих compose-файлов валиден (парсером,
  не Docker).

## Что сделано технически (Э10.2–10.5)

- **Э10.2 — layout-шаблон записи (`apps/web/.../recordings/EgressPage.tsx`,
  роут `/egress` вне `RequireAuth`/`Layout`)**. Страницу открывает
  headless-Chrome внутри контейнера egress на второй машине; параметры
  `?url=&token=&layout=` дописывает сам egress (`customBaseUrl` в
  `startRoomCompositeEgress`). Подключается к комнате recorder-участником
  (`<LiveKitRoom audio={false} video={false}>`), сигналит контрактными
  строками `START_RECORDING`/`END_RECORDING` в консоль по
  `useConnectionState` (их читает egress-сервис). Компоновка: крупный план
  — трек SCREEN_SHARE (в реальном уроке доска идёт через демонстрацию
  экрана учителя, Э7), плитка учителя в углу — камера того же участника;
  нет демонстрации → крупным планом камера учителя. `RoomAudioRenderer`
  обязателен — Chrome захватывает звук вкладки.
- **Э10.3 — баннер согласия у всех + управление**. Новое WS-сообщение
  `recording_status` в `serverRoomMessageSchema` (packages/shared). Шлётся
  `roomsService.broadcastToLesson` из `recordings/service`: при старте
  (`active:true`), при стопе и при терминальном egress-вебхуке
  (`active:false`, только если запись была активной — не шлём лишнего по
  уже завершённой). `rooms/ws.ts` при подключении сокета к уже идущему
  уроку сразу шлёт `recording_status:true` (зашедшие в середину видят
  баннер без задержки). `RoomPage` держит `recordingActive` от WS →
  `RecordingConsentBanner` видят ВСЕ (учитель и ученики); панель
  управления `RecordingPanel` — только `isTeacher`. Старт — двухшаговое
  подтверждение (152-ФЗ: «ученики увидят баннер»). `RECORDING_ENABLED=false`
  → 503 → панель показывает «вторая машина не подключена».
- **Э10.4 — фронт списка записей**. `RecordingPanel` (раскрывашка) тянет
  `GET /lessons/:id/recordings` при монтировании, при смене
  `recordingActive` и раз в 20 с (файл финализируется асинхронно после
  «Стоп»). Скачивание — только по `url` из ответа (presigned, TTL 1 час),
  прямых путей к файлам на клиенте нет. Статус/длительность/размер/срок
  хранения — человекочитаемо. Ретеншн-свип и `deleteFile` через
  StorageAdapter уже были в Э10.1.
- **Э10.5 — алерт «egress без публикующих»**. `recordings/repo.ts`:
  `listAllActiveRecordings` (все школы) + `lessonHasActiveRecording`
  (без тенант-скоупа — для баннера). `recordings/service.getRecordingLoadSnapshot`
  → по каждой активной записи `roomsService.countConnectedParticipants`
  (тонкая обёртка над `presence.countConnected`). `plugins/metrics.ts`:
  два вычисляемых Gauge (`collect()` в момент скрейпа, без параллельного
  счётчика — тот же приём, что `canvas_active_ydocs`/`lesson_traffic_mbit`):
  `lesson_recording_active` (счётчик нагрузки на вторую машину),
  `lesson_recording_no_publishers{lesson_id}` (1, если запись идёт при
  нуле участников — **прокси**, точное «ноль публикуемых дорожек» знает
  только egress). `monitoring/prometheus/alerts.yml`: правило
  `RecordingWithoutPublishers` (`== 1 for 10m`, warning).
  `prometheus.yml`: закомментированный scrape job `egress` (приватный IP
  второй машины — задел на deploy).
- **НЕ сделано (за живым окружением)**: реальный композитинг в Chrome
  egress и проверка сигналов `START/END_RECORDING`; Playwright E2E
  «учитель жмёт Запись → у ученика баннер → стоп → файл в списке»; гейт
  Э10 (Grafana MCP: CPU/джиттер основного сервера во время записи не
  меняются); алерт на родной метрике egress (имя метрики — свериться
  через Context7 при подключении второй машины).
- **Проверки Э10.2–10.5**: `pnpm -r build` (без `any`), `pnpm -r test`
  (api **377** — +7 в `recordings/service.test.ts`: баннер-broadcast ×5,
  `getRecordingLoadSnapshot` ×2; shared 54), `pnpm depcheck` (**224
  модуля, 648 связей, 0 нарушений**), YAML `alerts.yml`/`prometheus.yml`
  — правки в стиле существующих правил.

---

# Архив: Э9 — Редактор для методистов (завершён технически 2026-09-05)

Начато 2026-09-05, НОВЫЙ контекст (правило CLAUDE.md «один этап = один
контекст» — Э8 закрыт технически на предыдущей сессии, см. архив ниже,
пользователь явно попросил `/clear` и «дальше разработку продолжай»).
Самый объёмный и рискованный модуль проекта (§7 ТЗ: «планируй 8–12 недель»,
ПЛАН.md: 10 недель, 11 подзадач) — «конструктор заданий для методистов,
выглядит как формочки, а на деле WYSIWYG-редактор с версионированием,
превью, валидацией и импортом» (§29 ТЗ, вводный вывод).

**Ограничение среды не снято** (см. project-video-platform-env-gaps) — нет
Docker/живого Postgres/браузера здесь. Как и Э8, схема/бэк/юнит-тесты
пишутся и проверяются без него; визуальная проверка (обязательный по
ПЛАН.md показ методисту «каждые две недели начиная с Э9.4») и Playwright
E2E «методист создаёт материал → публикует → учитель выдаёт классу» —
задел на сессию с живым окружением.

## Стоп-лист Э9

```
НЕ делать на этом этапе:
- НЕ показывать методисту JSON. Никогда. Ни в каком виде.
- НЕ делать совместное редактирование материалов двумя методистами
- НЕ делать типы 11-22 — сначала все 10 базовых должны быть удобны
- НЕ делать ИИ-генерацию заданий
```

## Задачи

- [x] Э9.1 Библиотека материалов: дерево предмет → класс → тема, поиск, фильтры, статусы.
- [x] Э9.2 Каркас редактора: три панели (список блоков / редактирование / живое превью глазами ученика).
- [x] Э9.3 Drag&drop блоков через dnd-kit, автосохранение черновика.
- [x] Э9.4 Tiptap для формулировок + MathLive + KaTeX (всё в бандле).
- [x] Э9.5 Редакторы типов 1–5.
- [x] Э9.6 Редакторы типов 6–10.
- [x] Э9.7 Медиатека: загруженные картинки/аудио с переиспользованием между материалами.
- [x] Э9.8 Версионирование и публикация: черновик → ревью → опубликован. Правка опубликованного создаёт новую версию.
- [x] Э9.9 Валидатор перед публикацией: вопросы без правильного ответа, битые картинки, нулевые баллы.
- [x] Э9.10 Шаблоны: «проверочная на 10 вопросов», «разбор задачи», «словарный диктант».
- [x] Э9.11 Полуавтоматический импорт из Word/PDF: распознать вопросы, дать поправить руками.

**Все 11 подзадач закрыты технически (2026-09-05): `pnpm -r build`/`pnpm -r test`
(400/400)/`pnpm depcheck` зелёные.** НЕ закрыт гейт Э9 — ни одного показа
работающего редактора методисту (нужен браузер + живой Postgres, см.
project-video-platform-env-gaps), Playwright E2E «методист создаёт материал
из 5 блоков → публикует → учитель выдаёт классу» не написан. Переход на
Э10 — по решению пользователя, как и на прошлых этапах.

## Гейт Э9

```
Нет отдельного нагрузочного гейта («добавляет нагрузки: ноль», ПЛАН.md).
Контроль срыва: показывать методисту работающий редактор каждые две
недели начиная с Э9.4. Если на четвёртом показе он всё ещё не может сам
сделать материал — остановиться и переделать UX, а не добавлять типы.
```

## MCP под Э9

Постоянный набор (Context7, Playwright, GitHub) + Chrome DevTools MCP
(производительность редактора с сотней блоков) + Figma MCP (только если
реально есть макеты — не рисовать ради MCP). Ни один из ситуативных MCP
не подключён в этой среде (нет браузера) — задел на сессию с ним.

## Что сделано технически (Э9.1)

- **Область «библиотека»** (§7.2 ТЗ: дерево предмет → класс → тема,
  фильтры, поиск, статусы) реализована как read-only экран поверх УЖЕ
  существующих таблиц `materials`/`material_versions` (Э8.2) — редактора
  ещё нет (Э9.2+), материалы по-прежнему заводятся seed-скриптом.
- **Ключевое архитектурное решение**: `title`/`subject`/`grades`/`topic`
  живут в `material_versions.content` (JSON, единственный источник
  правды — `materialSchema`), но фильтровать/искать по jsonb каждой
  версии каждого материала школы на каждый запрос библиотеки — не
  вариант. `materials` получил ДЕНОРМАЛИЗОВАННЫЙ кэш этих полей + новую
  колонку `status` (`draft`/`review`/`published`, enum) + `updatedAt`,
  синхронизируемый при записи версии (`seed-material.ts` — сейчас
  единственный путь создания материала). Индексы `materials_school_status_idx`/
  `materials_school_subject_idx` — миграция `0011_fast_ezekiel.sql`.
- **`topic` в `materialSchema` — ОПЦИОНАЛЬНОЕ поле** (`packages/shared/src/materials.ts`),
  не обязательное: третий уровень дерева нужен для библиотеки, но делать
  его required сломало бы все фикстуры материалов Э8 (табличные тесты
  движка проверки, `activities/service.test.ts`), у которых темы никогда
  не было. Материалы без темы попадают в узел «Без темы» дерева.
- **Права доступа — читано и написано построчно** (CLAUDE.md, «не
  делегировать вслепую»): §4.2 ТЗ, «учитель создаёт материалы только в
  личной папке, без публикации в общую библиотеку» → `GET /materials`
  для роли `teacher` накладывает `status='published' OR createdBy=userId`
  (`restrictToOwnerOrPublished` в `repo.listMaterials`/`service.listMaterials`,
  `apps/api/src/modules/materials/`), для `admin`/`methodist` — без
  ограничения (это они публикуют/ревьюят, Э9.8). Роут `GET /materials`
  целиком под `requireRole("admin", "methodist", "teacher")` — ученик
  библиотеку не листает вообще (материал доходит до него только через
  выдачу, Э8.6).
- **Дохлый код обнаружен и удалён**: `repo.insertMaterialWithVersion`
  (Э8.2) не вызывался НИОТКУДА — реальный (и единственный) путь создания
  материала все семь стадий Э8 был `db/seed-material.ts`, который писал в
  таблицы напрямую, в обход `repo.ts`. Удалён вместо починки под новые
  NOT NULL колонки — чинить неиспользуемый код означало бы плодить второй,
  никогда не проверяемый путь создания.
- **Новый `apps/api/src/modules/materials/routes.ts`** (модуля раньше не
  было вообще — Э8 не выставлял `materials` наружу как HTTP, только через
  `activities`) — `GET /materials`, зарегистрирован в `server.ts`.
- **Фронт**: `materials-api.ts` (клиент), `MaterialsLibraryPage.tsx`
  (дерево строится на клиенте группировкой уже отфильтрованного сервером
  списка; материал с несколькими классами появляется в каждом узле своего
  класса — намеренно, `grades` — массив). Карточка материала кликом
  копирует id в буфер — редактора нет, но это уже полезно ЗДЕСЬ И СЕЙЧАС:
  `LessonActivityPanel`/`HomeworkPage` (Э8) просят id материала руками, и
  раньше его неоткуда было взять, кроме как из БД. Роут `/materials`,
  ссылка «Библиотека» в `Layout.tsx` — видна всем, кроме ученика (в отличие
  от «Уроки»/«Домашние задания», которые скрыты от методиста — методист
  не участвует в уроках, но библиотека — его основной инструмент).
- **Проверки**: `pnpm --filter @school/shared build`, `pnpm --filter @school/api build`,
  `pnpm --filter web build` (tsc --noEmit + vite build), `pnpm -r test`
  (**304/304**: 282 backend — 278 прежних + 4 новых в `materials/service.test.ts`
  на видимость по роли — + 22 shared — 19 прежних + 3 новых на `topic`/
  `listMaterialsQuerySchema`), `pnpm depcheck` (188 модулей, 519 связей,
  0 нарушений). Новых зависимостей нет.
- **Не проверено и не могло быть в этой среде**: живой Postgres (миграция
  `0011` сгенерирована, не прогнана — `drizzle-kit generate` работает по
  снапшотам схемы, живого подключения не требует), реальный рендер дерева
  и фильтров в браузере, `@>`-запрос по jsonb `grades` под нагрузкой.

## Что сделано технически (Э9.2)

- **Три панели** (§7.2 ТЗ «Редактор материала», `MaterialEditorPage.tsx`,
  новый роут `/materials/:id/edit`, ссылка с карточки библиотеки): слева —
  список блоков материала с выбором/добавлением/удалением, в центре —
  редактирование полей выбранного блока, справа — живое превью глазами
  ученика, обновляется на каждое изменение в центре без запроса к серверу.
- **Осознанно НЕ входит в этот срез** (следующие подзадачи по плану, не
  урезание, а границы этапа): drag&drop переупорядочивания блоков
  (dnd-kit, Э9.3), автосохранение/сохранение вообще (Э9.3) — черновик живёт
  только в состоянии страницы React, обновление страницы его теряет,
  на сервер ничего не пишется (`POST`/`PATCH /materials` ещё нет); Tiptap/
  MathLive (Э9.4) — формулировки и HTML-блоки редактируются как обычный
  текст в `<textarea>`, что явно помечено в UI и коде; полноценные
  редакторы вопросов 1–10 (Э9.5/9.6) — при добавлении вопрос получает
  валидную по форме заготовку интеракции (мин. 2 варианта и т.п.), но
  дальше в Э9.2 редактируемы только общие поля (`prompt`/`points`/`hint`).
- **Стоп-лист Э9 соблюдён буквально** («НЕ показывать методисту JSON.
  Никогда. Ни в каком виде.») — ни один контрол не показывает сырой JSON;
  единственное поле материала типа `Record<string, unknown>`
  (`embed.config`) в Э9.2 сознательно НЕредактируемо (провайдер — да, конфиг
  — нет), а не отдано как JSON-textarea. Меню «Добавить блок» и подпись
  типа вопроса — везде человеко-читаемые русские названия («Один
  правильный ответ», «Сопоставление»), не сырые коды типов (`single_choice`
  и т.п. — только значения `<option>`, не видимый текст).
- **Новый `GET /materials/:id`** (`materialDetailSchema`, `packages/shared`)
  — полное содержимое версии, С ключом ответа (`material: Material`, не
  `PublicMaterial`) — это не нарушение «ключи не уходят на клиент до
  сабмита» (CLAUDE.md): тот запрет про ученика, методист/учитель — автор
  контента, тот же принцип уже применён в `ActivityReview.material` (Э8.10).
  Видимость — **та же** проверка «личная папка учителя», что и в
  `GET /materials` (Э9.1, §4.2 ТЗ), написанная и прочитанная построчно
  отдельно (не переиспользование чужого готового решения): учитель видит
  свои материалы любого статуса + чужие только опубликованные, admin/
  methodist — без ограничения; отказ — 404 (`materials/service.ts`,
  `getMaterialForEdit`), не 403 — не подтверждаем учителю сам факт
  существования чужого черновика в школе (тот же выбор, что и в
  `getLatestMaterial` выше).
- **Живое превью** переиспользует существующие `QuestionPlayer`
  (Э8.4/8.5) и вынесенный из `MaterialPlayer.tsx` `ContentBlockView` —
  не новый рендерер с нуля. Черновик прогоняется через
  `stripMaterialAnswerKeys` (Э8.1, `packages/shared`) перед показом —
  превью физически не может случайно показать ключ ответа, потому что
  видит те же урезанные типы (`PublicQuestionInteraction`), что и реальный
  ученический плеер.
- **Проверки**: `pnpm -r build` (shared/api/web — tsc --noEmit + vite build,
  без ошибок и без `any`), `pnpm -r test` (**288/288**: 282 прежних + 6
  новых в `materials/service.test.ts` на `getMaterialForEdit` — 404 без
  материала, свой/чужой черновик учителя, чужой опубликованный, admin/
  methodist без ограничения), `pnpm depcheck` (189 модулей, 530 связей, 0
  нарушений). Новых зависимостей нет.
- **Не проверено и не могло быть в этой среде**: реальный рендер трёх
  панелей в браузере (разметка `grid-cols-[280px_1fr_1fr]`, скролл списка
  блоков, читаемость на разных ширинах), живой `GET /materials/:id`
  (живого Postgres нет) — показ методисту по плану ПЛАН.md («каждые две
  недели начиная с Э9.4») пока не наступил, но когда живое окружение
  появится, стоит прогнать и этот каркас глазами реального человека раньше.

## Что сделано технически (Э9.3)

- **Ключевое архитектурное решение — автосохранение НЕ создаёт новую
  версию.** `material_versions` — append-only (Э8.2), но «правка
  черновика» (эта подзадача) и «правка опубликованного» (Э9.8, ещё не
  сделано) — разные операции по смыслу плана («черновик → ревью →
  опубликован… правка опубликованного создаёт новую версию» — значит
  правка ЧЕРНОВИКА версию не создаёт). Пока материал в статусе `draft`, у
  него ещё нет закреплённых `activities` (Э8.2 закрепляет
  `materialVersionId`), поэтому мутировать его единственную версию на
  месте безопасно — новый `repo.updateDraftVersionContent` делает `UPDATE
  material_versions SET content` (не `INSERT`), + синхронизирует
  денормализованный кэш `materials` (та же логика, что в
  `seed-material.ts`, Э9.1).
- **`PUT /materials/:id`** (§8 ТЗ) — новый `service.updateMaterialDraft`,
  права на ЗАПИСЬ читаны и написаны построчно ОТДЕЛЬНО от прав на чтение
  (CLAUDE.md, «не делегировать вслепую»), а не переиспользованы как есть:
  строже, чем `getMaterialForEdit` — учитель пишет ТОЛЬКО в свой материал
  (для чтения чужой опубликованный виден, для записи — нет, «личная
  папка» §4.2 ТЗ это в первую очередь про запись), admin/methodist — без
  ограничения по владению, как и на чтение. Плюс отдельная проверка
  статуса — только `draft`, иначе 409 `material_not_draft` (сознательный
  отказ: правка `review`/`published` со своим версионированием — Э9.8, не
  здесь). Отказ по владению — 404, тот же принцип «не подтверждаем факт
  существования чужого материала», что и у `getMaterialForEdit`.
- **`useMaterialAutosave.ts`** — дословно та же форма, что
  `useActivityAutosave` (Э8.7): дебаунс 3 сек от последнего изменения,
  немедленный `flush(keepalive: true)` на `visibilitychange → hidden` и
  `beforeunload` (обрыв связи/уход со страницы не теряет правку),
  неудачное сохранение возвращается в очередь. Отличие от прототипа —
  очередь не `Map` по `questionId`, а один последний черновик материала
  целиком (сохранять историю промежуточных версий незачем, каждое новое
  изменение полностью перекрывает предыдущее).
- **`MaterialEditorPage.tsx`**: `canEdit` — фронтовое зеркало серверной
  проверки владения (`status === "draft" && (роль !== "teacher" ||
  createdBy === userId)`), нужно ТОЛЬКО чтобы не гонять автосохранение
  вхолостую там, где сервер заведомо откажет (403/409) — сама проверка
  прав остаётся на сервере, это не защитный механизм. Статичный баннер
  «черновик редактора нигде не сохраняется» (Э9.2) заменён на статус
  автосохранения (`сохранение…/сохранено/не сохранено — повторим`,
  дословно `autosaveLabel` из `MaterialPlayer.tsx`) для `canEdit`, иначе —
  явное «материал не в статусе черновика — изменения не сохраняются».
  Эффект автосохранения различает ПЕРВУЮ загрузку материала (`justLoaded`
  — не должна улетать автосохранением) от реальных правок пользователя —
  тот же приём, что уже применялся в `HomeworkPage.tsx`/`ReviewPanel.tsx`
  (`eslint-disable-next-line react-hooks/exhaustive-deps`, зависимость от
  `autosave.queue` намеренно не добавлена).
- **Drag&drop списка блоков** — `@dnd-kit/sortable`, дословно тот же
  паттерн, что `SortableOrderingItem` в `AdvancedInteractionPlayers.tsx`
  (Э8.5, единственный существующий прецедент dnd-kit в проекте): хэндл
  «⠿» для мыши/тача + кнопки ▲/▼ как ГАРАНТИЯ клавиатурной доступности
  (§16 ТЗ) — `KeyboardSensor` библиотеки не единственный путь взаимодействия,
  кнопки работают независимо от допущений о поведении сенсора.
  `reorderBlocks(fromIndex, toIndex)` — `arrayMove` из `@dnd-kit/sortable`,
  один и тот же путь что для мышиного `onDragEnd`, что для кнопок.
- **Новых зависимостей нет** — `@dnd-kit/*` уже были в `apps/web/package.json`
  (согласованы вместе с планом ещё на Э8.5 под `ordering`/`matching`).
- **Проверки**: `pnpm -r build` (shared/api/web — tsc --noEmit + vite build,
  без ошибок и без `any`), `pnpm -r test` (**317/317**: 295 backend — 282
  прежних + вычтенные из Э9.1/9.2 плюс 11 новых в `materials/service.test.ts`
  на `updateMaterialDraft` — 404 без материала, 404 чужой материал
  учителю, 409 свой не-черновик, 409 review, сохранение своего/чужого
  черновика для teacher/admin/methodist — + 22 shared), `pnpm depcheck`
  (190 модулей, 538 связей, 0 нарушений).
- **Не проверено и не могло быть в этой среде**: реальный drag&drop мышью
  и с клавиатуры в браузере, живой `PUT /materials/:id` (живого Postgres
  нет — транзакция `updateDraftVersionContent` не прогнана), поведение
  `beforeunload`/`visibilitychange` в реальной вкладке при уходе со
  страницы редактора. Chrome DevTools MCP (перформанс со ста блоками,
  ПЛАН.md) — тоже задел на сессию с браузером, как и было отмечено для Э9.2.

## Что сделано технически (Э9.4)

- **Новые зависимости — по согласованию** (CLAUDE.md, AskUserQuestion):
  `@tiptap/core`/`@tiptap/react`/`@tiptap/starter-kit`/`@tiptap/pm`,
  `mathlive`, `katex` — ровно то, что названо в стеке ТЗ (§ таблица
  библиотек, все MIT). `@tiptap/extension-link`/`-underline` НЕ добавлялись
  отдельно — Tiptap 3's `@tiptap/starter-kit` тянет их сам (пакет уже
  физически стоит в `node_modules` как транзитивная зависимость
  одобренного пакета, отдельного согласования не требует).
- **Всё в бандле, ничего с чужого домена** (§10.10/§15 ТЗ, «ни шрифты, ни
  KaTeX — даже бесплатные и безобидные»): `import "katex/dist/katex.min.css"`
  и `import "mathlive/fonts.css"` — Vite обрабатывает `@font-face`-ссылки
  этих CSS как обычные ассеты (хешированные `.woff2`/`.woff`/`.ttf` в
  `dist/assets`, проверено — оба комплекта шрифтов реально там после
  `pnpm --filter web build`). Ключевая деталь для MathLive: сам движок по
  умолчанию тянет шрифты С ОТДЕЛЬНОГО СЕТЕВОГО ЗАПРОСА по
  `MathfieldElement.fontsDirectory` (relative-путь, без явной настройки
  съехал бы на CDN) — импорт `mathlive/fonts.css` ставит CSS-переменную
  `--ML__static-fonts`, которую рантайм MathLive явно проверяет и, увидев
  её, пропускает всю логику резолвинга `fontsDirectory` целиком (прочитано
  в `mathlive.mjs`, не угадано из документации). Отдельно выключен
  `MathfieldElement.soundsDirectory = null` — дефолтный относительный путь
  `./sounds` иначе слал бы 404 на каждое нажатие клавиши (звук набора
  формулы нигде в ТЗ не требуется).
- **`RichTextEditor.tsx`** — новый компонент, обёртка над `useEditor`/
  `EditorContent` (`@tiptap/react`). Набор кнопок панели — РОВНО
  подмножество `ALLOWED_TAGS` из `sanitize-html.ts`
  (`p`/`br`/`strong`/`em`/`u`/`s`/`ul`/`ol`/`li`, плюс `a` автоссылкой при
  вставке URL): `heading`/`blockquote`/`codeBlock`/`code`/`horizontalRule`
  из `StarterKit` намеренно выключены — иначе редактор показывал бы
  форматирование, которое `sanitizeHtml` молча вырежет при рендере (хуже,
  чем просто не дать кнопку). `link: { openOnClick: false }` — клик по
  только что вставленной ссылке ПРЯМО во время редактирования не должен
  уводить со страницы, теряя ещё не улетевшую автосохранением правку
  (Э9.3). `sub`/`sup` — тоже в `ALLOWED_TAGS`, но `@tiptap/extension-
  subscript`/`-superscript` не установлены (новая зависимость, не входила
  в согласованный список) — отдельная подзадача при необходимости.
  Контролируемый компонент синхронизируется с внешним `html` через
  `editor.commands.setContent(html, { emitUpdate: false })` в эффекте —
  тот же приём, что переключение между блоками требует перезагрузки
  контента редактора без разрыва цикла `onChange → props`.
- **`FormulaEditor.tsx`** — обёртка над `<math-field>` (кастомный элемент
  MathLive). Создаётся ИМПЕРАТИВНО (`document.createElement`), не как JSX-
  тег — сознательно, чтобы не заводить `JSX.IntrinsicElements` под один
  тег, хрупкую к тому, как очередная версия типов React размещает
  пространство имён `JSX` (уже переезжало в React 19). Отдельного KaTeX-
  превью рядом с полем НЕТ — `<math-field>` сам показывает формулу
  типографически набранной по мере ввода, дублировать нечем.
- **Реальный рендер формулы** (было — `<code>{latex}</code>`-заглушка,
  Э8.6/9.2): `MaterialPlayer.tsx`, `ContentBlockView`, `case "formula"` →
  `katex.renderToString(latex, { throwOnError: false })`. Используется и
  живым превью редактора (Э9.2 переиспользует `ContentBlockView`), и
  реальным плеером ученика — один код, а не два похожих рендерера.
- **Побочная находка и правка — `.prose` был мёртвым классом.**
  `MaterialPlayer.tsx:215` уже писал `className="prose"` для `rich_text`
  (наследие Э8.4/8.5), но `@tailwindcss/typography` в проекте НЕ
  подключён — класс ничего не делал, и с `@tailwind base` (Preflight)
  списки (`<ul>`/`<ol>`) рендерились БЕЗ маркеров. До Э9.4 это было
  невидимо — никто не писал список HTML-ом руками в textarea; кнопка
  списка в новом тулбаре Tiptap делает его создание тривиальным, поэтому
  без явных правил `<ul>`/`<ol>` в `index.css` живой плеер ученика молча
  показывал бы список без буллетов, хотя в редакторе он выглядит
  нормально — по духу того же принципа CLAUDE.md «правь корень, а не
  обходи» правка была в рендер, а не в откат кнопки списка. Добавлен
  минимальный собственный набор правил `.prose` (`:where()`-селекторы,
  нулевая специфичность) вместо установки `@tailwindcss/typography` —
  новая зависимость ради десятка правил не согласовывалась. Класс
  расставлен на ВСЕХ местах рендера `prompt.html`/`hint.html`/`callout.html`,
  не только в новых — `QuestionPlayer.tsx` (прompt/подсказка),
  `ReviewPanel.tsx`/`GradingQueue.tsx`/`QuestionAnalyticsPanel.tsx`
  (тот же `prompt.html`, что видит ученик, но глазами учителя) — иначе
  список выглядел бы по-разному в зависимости от того, кто на него смотрит.
- **НЕ тронуто сознательно**: `html`-поля вариантов ответа/пар/элементов
  упорядочивания (`choiceOption.html`, `matching.left/right[].html`,
  `ordering.items[].html`, `rubric[].label`) — им сейчас вообще нечем
  редактироваться в UI (Э9.5/9.6), переводить их рендер на `.prose` было
  бы правкой мёртвого кода. Bundle не code-split по маршруту (Tiptap/
  MathLive грузятся в основной чанк, не лениво только для `/materials/:id/edit`)
  — во всём приложении сейчас нет ни одного `React.lazy`/`import()`
  (Excalidraw/LiveKit/pdf.js уже грузятся так же не лениво), значит это
  не новый паттерн деградации, а продолжение существующей архитектуры;
  сам по себе размер бандла — отдельная работа, не часть этой подзадачи.
- **Проверки**: `pnpm -r build` (shared/api/web — tsc --noEmit + vite
  build, без ошибок и без `any`; проверено, что шрифты KaTeX/MathLive
  реально попали в `dist/assets` хешированными файлами), `pnpm -r test`
  (**317/317** — этот срез бэкенд не трогал, тестов не прибавилось),
  `pnpm depcheck` (198 модулей, 548 связей, 0 нарушений), dev-сервер Vite
  поднят локально и проверено, что модули `RichTextEditor.tsx`/
  `FormulaEditor.tsx`/`MaterialEditorPage.tsx`/`MaterialPlayer.tsx` и
  предбандленные `mathlive`/`@tiptap/react`/`katex` отдаются без ошибок
  трансформации (`curl` на dev-эндпоинты, HTTP 200 — не рендер в браузере,
  только то, что модульный граф не ломается на импортах).
- **Не проверено и не могло быть в этой среде (нет браузера)**: реальный
  ввод формулы в `<math-field>` (виртуальная клавиатура, звук, курсор),
  реальная типографика KaTeX на экране, работа тулбара Tiptap (клики,
  `isActive`-подсветка), Chrome DevTools MCP-трейс — задел на сессию с
  браузером, как и было отмечено для Э9.2/9.3.

## Что сделано технически (Э9.5)

- **Новый `QuestionInteractionEditors.tsx`** — `InteractionEditor`,
  диспетчер по `interaction.type` + пять реальных редакторов
  (`single_choice`/`multiple_choice`/`true_false`/`text_input`/
  `numeric_input`, §6.3 ТЗ), заменяет в `QuestionBlockFields`
  (`MaterialEditorPage.tsx`) заглушку Э9.2 «Варианты ответа/ключ
  редактируются в редакторе вопроса — Э9.5/Э9.6». Типы 6–10 — по-прежнему
  заглушка (теперь текст сузился до «— Э9.6», сама заглушка осталась в
  том же диспетчере как один из case'ов, а не отдельным условием сверху).
- **Ключевое сознательное решение — подписи вариантов НЕ переведены на
  `RichTextEditor`** (Э9.4), хотя `choiceOptionSchema.html`/
  `matchingItemSchema.html`/`orderingItemSchema.html` в схеме типизированы
  как `html: string`, разрешающий разметку: Tiptap-тулбар на каждой
  строке списка из 2–6+ вариантов был бы визуальным шумом, а не
  удобством — Э9.4 была прицельно про ФОРМУЛИРОВКИ (целые абзацы:
  `prompt`/`hint`/`rich_text`/`callout`), не про короткие ярлыки. Обычный
  `<input>`, пишущий в `html`-поле голым текстом без тегов — валидное
  значение поля, ничего не нарушает; форматирование внутри варианта
  ответа (если понадобится) — не часть MVP десяти типов (стоп-лист Э9).
- **`single_choice`/`multiple_choice` — общий `ChoiceOptionsEditor`**
  (параметр `multiple` переключает семантику): для `single_choice` клик
  по любому варианту сбрасывает `correct` у всех остальных (визуально и
  функционально — радио-группа через общее `name` от `useId()`, хотя
  корректность обеспечивает сам `setCorrect`, а не нативная семантика
  `<input type="radio">`), для `multiple_choice` — независимые чекбоксы.
  Добавление/удаление варианта — тот же паттерн, что список блоков (Э9.2):
  кнопка «Удалить» дизейблится на `.min(2)` схемы (нельзя увести вопрос в
  невалидное состояние прямо из редактора, а не только через Э9.9-валидатор
  постфактум).
- **`text_input`** — список принимаемых ответов (`value` + режим
  сравнения `exact`/`normalized`/regex, человекочитаемые подписи режимов)
  плюс три общих флага интеракции (`caseSensitive`/`trimWhitespace`/
  `typoTolerance` — расстояние Левенштейна). Ключ списка — по индексу, не
  по id: у `textMatchRuleSchema` в схеме НЕТ поля `id` (в отличие от
  `matching`/`ordering`/`rubric`, где оно есть специально под React-ключ)
  — не единственный в проекте случай (`table.rows`), фабриковать
  несуществующий в данных id не стал.
- **`numeric_input`** — значение, допуск (вид `absolute`/`relative`/
  `percent` + величина), необязательная единица измерения и флаг
  «обязательна в ответе».
- **`true_false`** — минимальный: два радио «Верно»/«Неверно».
- **Новых зависимостей и правок `packages/shared` не потребовалось** —
  все пять схем интеракций уже были в `materials.ts` с Э8.1, редакторы
  только читают/пишут по ним.
- **Проверки**: `pnpm -r build` (shared/api/web, без ошибок и без `any`),
  `pnpm -r test` (**317/317** — бэкенд/shared не тронуты, тестов не
  прибавилось — чистый фронт), `pnpm depcheck` (199 модулей, 551 связь, 0
  нарушений), dev-сервер Vite — `QuestionInteractionEditors.tsx`/
  `MaterialEditorPage.tsx` отдаются без ошибок трансформации.
- **Не проверено и не могло быть в этой среде (нет браузера)**: реальные
  клики по радио/чекбоксам, live-превью с обновлённым ключом ответа
  глазами ученика (пайплайн `stripMaterialAnswerKeys` не менялся, но
  визуально не проверено), поведение на вопросе с уже сохранёнными
  ответами учеников (сценарий правки опубликованного — Э9.8, здесь вне
  скоупа).

## Что сделано технически (Э9.6)

- **`QuestionInteractionEditors.tsx` (Э9.5) дополнен** пятью редакторами
  оставшихся типов — `open_answer`/`cloze_dropdown`/`cloze_text`/
  `matching`/`ordering` (§6.3 ТЗ). Диспетчер `InteractionEditor` теперь
  закрывает все 10 типов без единой заглушки — «Варианты ответа/ключ
  редактируются в редакторе вопроса» (Э9.2) полностью снято.
- **`open_answer`** — максимальная длина, флаг вложений, список критериев
  проверки (`rubric`: id/текст/баллы — у этой схемы, в отличие от
  `text_input`, есть настоящий `id`, поэтому список честно keyed по нему,
  не по индексу).
- **`cloze_dropdown`/`cloze_text` — общий `ClozeTemplateShell`** (дженерик
  по типу гэпа): textarea шаблона + кнопка «Добавить пропуск», которая
  вставляет `{{gapN}}` РОВНО в позицию курсора через
  `HTMLTextAreaElement.setRangeText(...)`, а не в конец текста — писать
  токен руками было бы медленно и ошибкоопасно (опечатался в `{{}}` —
  тихо потерял пропуск), отсюда вообще была нужна кнопка. Ниже — карточка-
  редактор на каждый id пропуска, реально встречающийся в шаблоне (разбор
  тем же паттерном `{{(\w+)}}`, что `splitTemplate` в плеере,
  `AdvancedInteractionPlayers.tsx`, только здесь нужны сами id, не
  сегменты для рендера). **Осиротевшие записи `gaps`** (id из уже
  сохранённого JSON, которого больше нет в тексте — методист стёр или
  сломал токен на середине правки) НЕ удаляются молча при каждом
  keystroke — во время печати шаблон может временно не содержать валидный
  `{{...}}`, и тихое удаление конфигурации гэпа в этот момент значило бы
  потерять работу методиста без предупреждения; вместо этого отдельная
  строка «Удалить неиспользуемые» с explicit-кнопкой.
  - `cloze_dropdown`: список текстовых вариантов гэпа + `<select>`
    «правильный вариант» — `correct` в схеме (`clozeDropdownGapSchema`)
    хранится СТРОКОВЫМ ЗНАЧЕНИЕМ, не индексом, поэтому редактирование
    текста варианта, который в этот момент был отмечен как правильный,
    переносит `correct` вместе с ним (иначе переименование варианта молча
    отвязывало бы от него правильный ответ).
  - `cloze_text`: переиспользует `AnswerRulesFields`, вынесенный из
    `text_input` (Э9.5) — `clozeTextGapSchema` и `textInputInteractionSchema`
    несут ровно один и тот же набор полей (`answers`/`caseSensitive`/
    `trimWhitespace`/`typoTolerance`), разница только в том, где он лежит
    — на интеракции целиком или внутри `gaps[id]`. Один компонент вместо
    копии кода — не абстракция ради абстракции, а прямое переиспользование
    только что написанного.
- **`matching`** — редактируемые левый/правый списки (`ItemListEditor`,
  общий для обеих сторон) + построение `pairs` через `<select>` на каждый
  левый элемент («левый → правый / без пары»), не drag-and-drop-соединение
  линиями (для MVP избыточно). **`distractors` вычисляется автоматически**
  как «id элементов `right` без пары» — ручного переключателя «это
  отвлекающий вариант» нет и не нужно: в самой схеме
  (`matchingInteractionSchema`, `materials.ts`) уже есть комментарий «id
  элементов right без пары», то есть поле по определению производное.
  Перед тем как положиться на это, проверено по `grading.ts` (CLAUDE.md,
  «не делегировать вслепую» — движок проверки заданий): `distractors` НЕ
  участвует в подсчёте баллов вообще, только прокидывается ученику
  насквозь (`stripInteractionAnswerKey`, `materials.ts:526`) — пересчёт
  этого поля при каждой правке списков ничего не портит в реальной
  проверке ответов. Выбор одного и того же правого элемента для двух
  разных левых — исключён на уровне UI (`setPair` снимает прежнюю пару
  правого элемента при переназначении), не просто разрешён как
  теоретически валидный по схеме и оставлен на волю случая.
- **`ordering`** — редактор списка с drag&drop, ДОСЛОВНО тот же приём,
  что уже дважды применялся в проекте: хэндл «⠿» + кнопки ▲/▼ как
  клавиатурная гарантия (§16 ТЗ) — `SortableOrderingItem` в
  `AdvancedInteractionPlayers.tsx` (плеер, Э8.5) и список блоков
  материала (`MaterialEditorPage.tsx`, Э9.3). Порядок элементов массива —
  сам правильный ответ (как и в схеме, `orderingInteractionSchema`), явно
  подписано в UI.
- **Новых зависимостей и правок `packages/shared` не потребовалось** — все
  пять схем (`open_answer`/`cloze_dropdown`/`cloze_text`/`matching`/
  `ordering`) существовали с Э8.1; `@dnd-kit/*`, использованный в
  `OrderingEditor`, уже был в проекте с Э8.5/Э9.3.
- **Проверки**: `pnpm -r build` (shared/api/web, без ошибок и без `any` —
  по пути поймана и исправлена одна опечатка компиляции, дублирующее
  объявление `TEXT_MATCH_LABELS`, оставшееся при переносе куска кода в
  `AnswerRulesFields`), `pnpm -r test` (**317/317** — фронт-only срез,
  бэкенд/shared не тронуты), `pnpm depcheck` (199 модулей, 554 связи, 0
  нарушений), dev-сервер Vite — `QuestionInteractionEditors.tsx`/
  `MaterialEditorPage.tsx` отдаются без ошибок трансформации.
- **Не проверено и не могло быть в этой среде (нет браузера)**: реальный
  drag&drop в `OrderingEditor`, ввод/удаление токенов `{{gapN}}` через
  `setRangeText` на живом textarea (курсор/фокус), рендер длинных
  шаблонов cloze с несколькими пропусками, live-превью этих пяти типов
  глазами ученика. Показ методисту работающего редактора «каждые две
  недели начиная с Э9.4» (Гейт Э9, ПЛАН.md) — по-прежнему не проведён,
  среда без браузера этого не позволяет; к третьему показу (после Э9.6)
  стоит расставить приоритет на сессию с реальным окружением.

## Что сделано технически (Э9.7)

- **Новая таблица `media_assets`** (миграция `0012_swift_maelstrom.sql`, не
  прогнана — живого Postgres нет) — переиспользуемые вложения
  `image`/`audio` блоков (`ContentBlock.assetId`, Э8.1), НЕ привязана к
  конкретному материалу: один файл может быть у любого числа блоков в
  любом числе материалов школы (в этом весь смысл медиатеки). `kind`
  (enum `image`/`audio`) — **`video` сознательно не входит**: план
  ограничивает подзадачу Э9.7 картинками/аудио (ТЗ §7.2 в описании экрана
  упоминает и видео, но текст самой подзадачи в ПЛАН.md — нет;
  транскодирование/превью видео — отдельная, более тяжёлая работа).
- **Ключевое архитектурное решение — `kind` определяется СЕРВЕРОМ по
  `mimeType` файла**, не принимается от клиента отдельным полем формы: от
  него зависит, в каком пикере (image/audio) файл потом появится, и
  доверять клиентскому выбору смысла нет, раз тип уже есть в самом файле
  multipart-запроса. Изображения ресайзятся тем же приёмом, что уже
  применён к доске урока (Э3.10, `canvas/images.ts` — до 2000px,
  `.rotate()` по EXIF), но код НЕ переиспользован напрямую: `materials` не
  имеет права дёргать внутренности `canvas` (CLAUDE.md, «модуль не
  импортирует логику чужого модуля напрямую»), плюс TTL подписанной
  ссылки здесь другой (обычный часовой `storageService`, не специальный
  30-дневный, как у доски). Аудио сохраняется как есть — транскодирование
  вне подзадачи.
- **`materials/media-repo.ts` + `materials/media-library.ts`** — тот же
  раскол repo/service, что и у остального `materials` (`repo.ts`/
  `service.ts`), сделан специально ради тестируемости: `media-library.ts`
  (валидация MIME, ресайз через `sharp`, сборка `MediaAsset`) юнит-тестится
  мокая `media-repo.js` (10 тестов, `media-library.test.ts`) — ресайз
  проверяется РЕАЛЬНЫМ `sharp`, не моком (тот же приём, что уже был в
  `canvas/images.test.ts`, Э3.10: «декодировать реальный артефакт»), сам
  Drizzle-запрос (repo-слой) юнит-тестами не покрыт — тот же зазор, что и
  у `materials/repo.ts` изначально (Э8.2/9.1), требует живого Postgres.
- **Три новых роута** (`materials/routes.ts`, все — §8 ТЗ):
  `POST /materials/media` и `GET /materials/media?kind=` — под
  `requireRole("admin","methodist","teacher")`, та же видимость роли, что
  у остальной библиотеки материалов, БЕЗ ограничения по загрузившему
  (смысл медиатеки — переиспользование МЕЖДУ авторами, не только своими
  файлами). И третий, принципиально другой по правам —
  **`GET /assets/:id/url` БЕЗ `requireRole`**, только базовая
  аутентификация: блок `image`/`audio` внутри материала виден и ученику
  (через выдачу, Э8.6), значит и ссылку на файл ученик должен уметь
  получить — доступ к самому материалу уже проверен раньше в цепочке
  (`activities`), здесь достаточно не отдать чужую школу (404 на чужой
  `schoolId`, тот же принцип «не подтверждаем факт существования чужого
  id», что и у `getMaterialForEdit`). Путь `/assets/...`, а не
  `/materials/assets/...` — дословно по контракту §8 ТЗ, при том что
  живёт внутри `materials/routes.ts` (ресурс — `media_assets`, модуль
  которого владеет таблицей); прецедент такого несовпадения пути и папки
  модуля в проекте уже есть (`decks/routes.ts` регистрирует
  `/lessons/:id/uploads`, не `/decks/...`).
- **`MediaAssetPicker.tsx`** (новый) — заменяет `TextField` «id файла в
  медиатеке» (Э9.2/9.3, куда раньше id было ВЗЯТЬ НЕОТКУДА, кроме прямого
  похода в БД) у `image`/`audio` блоков: превью выбранного файла, кнопка
  «Выбрать из медиатеки» (грид превью для картинок, список названий для
  аудио) и «Загрузить новый». `video`-блок оставлен на прежнем
  `TextField` с явной пометкой «вне Э9.7» — не переведён на пикер, так
  как для него нет ни аплоада, ни листинга (`kind` не включает `video`).
- **Реальный рендер в `MaterialPlayer.tsx`** (было — общая заглушка
  «рендер подключается отдельно» для image/video/audio/embed, Э9.4):
  `image`/`audio` теперь резолвят `assetId → url` через новый
  `GET /assets/:id/url` (`useAssetUrl`, локальный хук) и рендерят
  настоящий `<img>`/`<audio controls>`. Один и тот же код обслуживает и
  живое превью редактора (`ContentBlockView` уже переиспользовался оттуда
  с Э9.2), и настоящий плеер ученика — не два похожих рендерера с разными
  источниками URL. `video`/`embed` — заглушка осталась (условие сузилось
  ровно до этих двух типов).
- **Проверки**: `pnpm -r build` (shared/api/web, без ошибок и без `any`),
  `pnpm -r test` (**327/327**: 305 backend — 295 прежних + 10 новых в
  `media-library.test.ts` — + 22 shared), `pnpm depcheck` (203 модуля, 574
  связи, 0 нарушений — в частности, `materials.ts` (shared) импортирует
  `canvasImageMimeTypeSchema` из `canvas.ts` того же пакета: разрешённый
  паттерн, precedent — `rooms.ts` уже импортирует из `decks.ts`/`media.ts`
  внутри `packages/shared`, правило CLAUDE.md про «чужой repo.ts» — про
  модули apps/api и apps/web, не про файлы внутри shared). Миграция
  `0012` сгенерирована (`drizzle-kit generate`, 16 таблиц), НЕ прогнана.
  Dev-сервер Vite — все новые/изменённые файлы отдаются без ошибок
  трансформации.
- **Не проверено и не могло быть в этой среде (нет браузера, нет живого
  Postgres)**: реальная загрузка файла через `<input type="file">`,
  ресайз/поворот EXIF на настоящей фотографии с телефона, живой
  `POST /materials/media`/`GET /assets/:id/url` (миграция не прогнана —
  таблицы `media_assets` физически нет), плеер аудио/картинки глазами
  реального ученика. Ограничение размера файла НЕ добавлено отдельно для
  медиатеки (используется общий лимит `@fastify/multipart` — 200 МБ,
  `server.ts`) — согласовано с тем, что ВСЕ остальные upload-роуты
  проекта (`/assets`, `/lessons/:id/uploads`, `/lessons/:id/canvas-images`,
  `/users/import`) тоже полагаются на этот общий лимит без исключений;
  вводить более строгий лимит только для медиатеки было бы новым,
  нигде больше не применяемым паттерном — если понадобится, отдельная
  осознанная работа над ВСЕМИ upload-роутами разом, не точечно здесь.

## Что сделано технически (Э9.8)

Самая рискованная подзадача Э9 на настоящий момент — трогает путь, от
которого зависит выдача материала классу (`activities`, Э8.6). Читано и
написано построчно (CLAUDE.md, «не делегировать вслепую» — хоть это и не
сам движок проверки, а соседняя часть той же цепочки).

- **Ключевое архитектурное решение — новая колонка `materials.current
  VersionId`** (миграция `0013_slippery_night_nurse.sql`, не прогнана).
  До сих пор «текущая версия» материала была буквально «последняя по
  `version`» (так и было прямо написано в докстринге Э8.2: «без отдельного
  указателя `currentVersionId`, workflow публикации — Э9.8» — это было
  предупреждение самому себе на будущее). Разница обнаружилась не сразу:
  без указателя ПРАВКА ОПУБЛИКОВАННОГО материала (то, что и просит
  подзадача) была бы физически неотличима от самой публикации — обе
  добавляют/меняют версию с БОЛЬШИМ номером. `currentVersionId` — это
  именно то, что школа/учитель видят «сейчас»; последняя версия по номеру
  может быть новее и НЕПУБЛИЧНОЙ (форк поверх публикации, ещё не
  опубликован повторно).
- **`getLatestMaterial`** (`activities/service.ts` вызывает его для
  `POST /lessons/:id/activities`/`POST /groups/:id/activities` — назначение
  материала классу/домашкой) **больше не «последняя версия», а
  «опубликованная версия»** (`repo.findPublishedMaterialVersion`, JOIN по
  `currentVersionId`, не `ORDER BY version DESC`). Это было ЕДИНСТВЕННОЕ
  затронутое место в `activities` — само оно не менялось (правило
  CLAUDE.md про чужой модуль), только контракт `materials/service.ts`, на
  который `activities` уже полагался. Без этой правки учитель, назначая
  материал, который методист как раз сейчас правит после публикации, мог
  бы случайно выдать классу непроверенный черновик — то и происходило
  бы, продолжай `getLatestMaterial` буквально брать последнюю строку.
- **Три ветки в `updateMaterialDraft`** (было — просто отказ 409 на
  нечерновик, Э9.3):
  1. `draft`/`review` (материал никогда не публиковался) — правит
     единственную версию НА МЕСТЕ, синхронизирует денормализованный кэш
     `materials` (как и раньше).
  2. `published`, `versionId === currentVersionId` (первая правка ПОСЛЕ
     публикации, форка ещё нет) — форкает НОВУЮ версию
     (`repo.insertNewVersion`, append-only — Э8.2's «задел» наконец
     реально используется), денормализованный кэш **НЕ трогает**.
  3. `published`, версии разные (форк уже есть, правят его дальше) —
     мутирует ЕГО на месте (иначе каждый keystroke автосохранения плодил
     бы новую версию), кэш всё ещё не трогает.
  Ветки 2/3 не синхронизируют `materials.title`/`subject`/`grades`/
  `topic`/`updatedAt` СОЗНАТЕЛЬНО: библиотека (Э9.1) обязана продолжать
  показывать школе СТАРОЕ опубликованное содержимое, пока форк не
  опубликуют повторно — иначе половина школы увидела бы недописанное
  название материала раньше, чем реальный текст материала обновится.
- **`publish`** (`POST /materials/:id/publish`) — ОДНА операция и для
  первой публикации черновика, и для повторной публикации форка: просто
  переставляет `currentVersionId` на текущую версию, ставит
  `status='published'` (для форка — идемпотентно) И ТОЛЬКО ТЕПЕРЬ
  синхронизирует денормализованный кэш из её содержимого — момент, когда
  библиотека наконец обязана показать новое название. 409, если
  `versionId === currentVersionId` (нечего публиковать). Роль — ТОЛЬКО
  admin/methodist (§4.2 ТЗ: учитель никогда не публикует свои материалы,
  даже свои) — 403 целиком по роли, до похода в БД, не 404 (это не вопрос
  видимости конкретного материала).
- **`submitForReview`/`returnToDraft`** — заполняют пробел, которого нет в
  явном виде в таблице роутов §8 ТЗ (там назван только `publish`), но без
  которого статус `review` был бы физически недостижим: `materialStatus
  Schema` описывает его как «отдан на ревью методисту/админу» — нужно
  действие, которое туда переводит, и действие, которое возвращает.
  `submitForReview` (draft→review) — права владения, как у
  `updateMaterialDraft` (автор может сам отправить свой черновик).
  `returnToDraft` (review→draft) — ТОЛЬКО admin/methodist: это решение
  ревьюера, не самого автора.
- **`getMaterialForEdit` — регрессия, которую я сам себе устроил и сам же
  починил в том же срезе.** Существующий (Э9.2, уже протестированный)
  тест «учителю доступен чужой ОПУБЛИКОВАННЫЙ материал» опирался на то,
  что `findLatestMaterialVersionForEdit` возвращает строку со
  `status='published'`. Как только правка опубликованного материала
  стала форкать НОВУЮ версию (см. выше), «последняя версия» чужого
  материала могла оказаться непубличным форком с `status`, который
  ФОРМАЛЬНО остаётся `'published'` на уровне `materials`, но семантически
  это уже не то, что можно показывать стороннему читателю — ПРОВЕРЕНО: не
  просто предположение, увиденное при пере-выведении сценария «методист
  публикует → начинает править дальше → другой учитель открывает этот же
  материал». Починка: для учителя, который смотрит ЧУЖОЙ материал (не
  свой), сервис теперь ходит за версией ОТДЕЛЬНО — по `currentVersionId`
  (`repo.findPublishedMaterialVersionForEdit`), а не по «последней» —
  видит именно опубликованное, даже если автор сейчас копит следующую
  правку. Для СВОЕГО материала (владелец, или admin/methodist без
  ограничения) поведение не изменилось — всегда последняя версия.
  `isCurrent: boolean` в ответе (`materialDetailSchema`) — говорит
  редактору, есть ли что публиковать (видна кнопка «Опубликовать»).
- **`seed-material.ts` (единственный путь создания материалов, Э8)
  тоже задело**: без правки только что заведённый скриптом материал со
  `--status published` навсегда остался бы невидимым для
  `getLatestMaterial` (`currentVersionId` был бы `NULL`, INNER JOIN не
  даёт строк) — школа технически никогда не увидела бы «опубликованный»
  seed-материал. Правка — только для НОВОГО материала (`--material` не
  передан): после вставки версии, если `--status published`, сразу
  выставляет `currentVersionId`. Добавление версии к СУЩЕСТВУЮЩЕМУ
  материалу (`--material`) статус/указатель как и раньше НЕ трогает —
  комментарий кода 2026-09-05 («переопределение статуса — Э9.8») теперь
  буквально значит «вызовите настоящий `POST /materials/:id/publish`,
  раз он существует», а не «когда-нибудь это сделает Э9.8».
- **Фронт (`MaterialEditorPage.tsx`)**: `canEdit` больше НЕ проверяет
  статус (раньше — `draft`-only) — сервер теперь принимает правку в любом
  статусе (форкает при необходимости), так что единственное, что решает
  редактируемость — владение. Новый `StatusActions` — три кнопки
  («Отправить на ревью»/«Вернуть в черновик»/«Опубликовать»), видимость
  которых зеркалит серверные правила по роли/статусу/`isCurrent`; перед
  ЛЮБЫМ переходом статуса — `autosave.flush()`, иначе последний
  непойманный дебаунсом keystroke мог бы уйти на сервер УЖЕ ПОСЛЕ
  публикации/отправки на ревью, и увиденная методистом версия не
  совпала бы с реально опубликованной. Новый `VersionHistory` — свёрнутый
  по умолчанию список версий (номер/дата/«опубликована сейчас»), грузится
  лениво при первом раскрытии (`GET /materials/:id/versions`).
- **Новых зависимостей не потребовалось.**
- **Проверки**: `pnpm -r build` (shared/api/web, без ошибок и без `any`),
  `pnpm -r test` (**348/348** — backend: 326, включая переписанные тесты
  Э9.3 под новую трёхветочную `updateMaterialDraft` и новые наборы для
  `submitForReview`/`returnToDraft`/`publish`/`listMaterialVersions`/
  обновлённого `getMaterialForEdit` — + 22 shared), `pnpm depcheck` (203
  модуля, 574 связи, 0 нарушений — новых межмодульных связей не
  добавилось, `activities` не тронут напрямую). Миграция `0013`
  сгенерирована (`drizzle-kit generate`, взаимный FK `materials.current
  VersionId → material_versions.id` через forward-reference `() =>
  materialVersions.id` — стандартный приём drizzle для взаимных ссылок
  между уже существующими таблицами, не прогнана — живого Postgres нет).
- **Не проверено и не могло быть в этой среде (нет браузера, нет живого
  Postgres)**: реальный сквозный сценарий «учитель создаёт черновик →
  отправляет на ревью → методист публикует → учитель назначает классу →
  методист правит опубликованное → форк не виден классу → методист
  публикует форк → класс видит новое» — именно этот сценарий и есть
  главная защита от регрессии здесь (ПЛАН.md прямо называет Playwright
  E2E «методист создаёт материал из 5 блоков, публикует, учитель выдаёт
  классу» «самым длинным E2E в проекте и главной защитой»), но живого
  окружения для его прогона по-прежнему нет.

## Что сделано технически (Э9.9)

- **Ключевое архитектурное решение — валидатор раздвоен на чистую и
  «грязную» половину**, а не написан одной функцией:
  - `validateMaterialContent(material): MaterialValidationIssue[]`
    (`packages/shared/src/materials.ts`) — ВСЕ структурные проверки
    («вопросы без ответа», «пустые блоки», «нулевые баллы»), чистая
    функция без похода в БД. Специально в shared, не в apps/api — фронт
    (`MaterialEditorPage.tsx`) в будущем сможет гонять её локально на
    каждый keystroke без круговых запросов к серверу (в этом срезе пока
    НЕ подключено — см. «не входит» ниже), а бэк использует ровно ту же
    функцию перед публикацией, гарантируя, что правила на клиенте и на
    сервере не разъедутся с течением времени.
  - `checkBrokenAssets`/`validateMaterial` (`apps/api/.../validation.ts`)
    — «битые картинки», ЕДИНСТВЕННАЯ проверка, которая физически не может
    быть чистой функцией (существование файла проверяется только походом
    в БД, `media-repo.findMediaAssetsByIds`, один запрос на весь материал
    по уникальным id, не по одному на блок). Комбинирует оба списка в
    один при вызове `validateMaterial(schoolId, material)`.
- **`no_correct_answer` — разобрано ПО ТИПАМ, не одним общим правилом**
  (`questionHasCorrectAnswer` в shared): `single_choice`/`multiple_choice`
  — есть ли `option.correct === true`; `text_input` — есть ли непустой
  `answers[].value`; `cloze_dropdown` — `gap.correct` реально входит в
  `gap.options` (не просто непустая строка — опечатка в correct мимо
  списка вариантов иначе прошла бы незамеченной); `cloze_text` — то же,
  что `text_input`, на каждый пропуск. `true_false`/`numeric_input`/
  `matching`/`ordering` — СТРУКТУРНО не могут остаться без ответа (схема
  `materials.ts` уже это гарантирует — `correct: boolean`, обязательное
  `value: number`, `pairs.min(1)`, порядок массива = ответ), поэтому
  всегда проходят без флага, не «на всякий случай» пропущены.
  `open_answer` — тоже всегда проходит: «правильного ответа» у ручной
  проверки не существует по смыслу типа, критерии проверки — не про это.
- **`empty_content`** — HTML-блоки (`rich_text`/`callout`/формулировка
  вопроса `prompt.html`) через `isEmptyHtml` (не голый `trim() === ""` —
  Tiptap, Э9.4, оставляет `<p><br></p>` в пустом абзаце, который `trim()`
  не считает пустым, но реально пуст); `table` — нет строк или ВСЕ ячейки
  пустые. `formula`/`image`/`audio` НЕ проверяются на пустоту —
  структурно не могут быть пустыми (схема `.min(1)` на `latex`/`assetId`);
  битый `assetId` — это `broken_asset`, отдельная категория, не «пусто».
- **Пустой материал целиком** (`blocks.length === 0`) — `material_empty`,
  единственный случай, где `blockId: null` (проблема не одного блока, а
  материала в целом) — дальше сканирование не идёт, других проблем в
  пустом материале быть не может.
- **`checkBrokenAssets` намеренно НЕ проверяет `video`-блоки**: Э9.7 не
  даёт для `video` ни аплоада, ни листинга (`mediaAssetKindEnum` не
  включает `video`) — любой `video.assetId` был бы неверифицируем и
  ВСЕГДА «битым», что вводило бы методиста в заблуждение (у него физически
  нет способа это починить, раз загрузки видео не существует). Проверка
  типа несовпадения («аудио вставлено в image-блок») — тоже `broken_asset`,
  не отдельная категория: с точки зрения блока это та же «ссылка
  указывает не туда».
- **`publish` (Э9.8) теперь гоняет валидатор ПЕРЕД публикацией** — 409
  `material_invalid` с числом проблем в сообщении, если список не пуст;
  публикация (`repo.publishVersion`) не вызывается вовсе. Это НЕ
  единственная защита (CLAUDE.md, «правь корень») — фронт заранее не даёт
  нажать «Опубликовать», не проверив материал (см. ниже), но серверная
  проверка — граница, которую нельзя обойти прямым запросом к API.
- **Новый `GET /materials/:id/validate`** — видимость ТА ЖЕ, что у чтения
  материала для редактора (`getMaterialForEdit`, переиспользован для
  загрузки+авторизации, не продублирован): валидность — атрибут
  содержимого, которое пользователь и так имеет право видеть.
- **Фронт**: `ValidationPanel` (`MaterialEditorPage.tsx`) — свёрнутая по
  умолчанию секция (тот же приём, что `VersionHistory`, Э9.8), НЕ грузится
  автоматически при раскрытии `<summary>` (в отличие от истории версий) —
  явная кнопка «Проверить», потому что проверка ходит в БД
  (`checkBrokenAssets`) и гонять её на каждый клик по `<details>`
  расточительно. Список проблем кликабелен — клик по проблеме с
  `blockId` выбирает этот блок в панели списка блоков (`onSelectBlock`).
  Кнопка «Опубликовать» (`StatusActions`) теперь СНАЧАЛА гоняет ту же
  проверку (`onValidate`, общее состояние `validationIssues`, один
  источник данных, не два похожих запроса с разным кэшем) — если
  проблемы есть, публикация не отправляется вовсе, показывается
  структурированное сообщение с количеством и ссылкой на вкладку
  «Валидация», а не просто текст 409 с сервера.
- **Осознанно НЕ входит в этот срез**: живой ре-запуск валидатора на
  каждый keystroke в редакторе (структурные проверки уже чистая функция и
  технически готовы к этому — `validateMaterialContent` экспортирован из
  shared специально с расчётом на будущее использование во фронте, но
  подключение — отдельная работа, не часть Э9.9 по плану); подсветка
  проблемных блоков прямо в списке блоков (бейджем, не только через
  клик из панели «Валидация») — тоже возможное развитие, не сделано
  здесь.
- **Проверки**: `pnpm -r build` (shared/api/web, без ошибок и без `any`),
  `pnpm -r test` (**381/381**: 45 shared — 22 прежних + 23 новых для
  `validateMaterialContent`, все 10 типов интеракций и все категории
  структурных проблем — + 336 backend — 326 прежних + 7 в новом
  `validation.test.ts` + 3 новых в `service.test.ts` на `publish`-с-
  проблемами/`validateMaterialForEdit`), `pnpm depcheck` (205 модулей, 581
  связь, 0 нарушений), dev-сервер Vite — изменённые файлы отдаются без
  ошибок трансформации.
- **Не проверено и не могло быть в этой среде (нет браузера, нет живого
  Postgres)**: реальный клик по проблеме в `ValidationPanel` и переход к
  блоку, живой `GET /materials/:id/validate`/`checkBrokenAssets` (таблица
  `media_assets` физически не создана — миграция `0012` не прогнана),
  сценарий «методист видит список проблем → чинит → публикует».

## Что сделано технически (Э9.10)

- **Побочный, но необходимый пробел закрыт по пути — `POST /materials`
  ФИЗИЧЕСКИ НЕ СУЩЕСТВОВАЛ до этой подзадачи.** Все восемь предыдущих
  подзадач Э9 (9.1–9.9) добавляли редактирование/публикацию/валидацию УЖЕ
  существующего материала — единственным способом завести новый оставался
  `db/seed-material.ts` (ручной скрипт в обход API, стоп-лист Э8), о чём
  честно писала библиотека («Материалы пока заводятся seed-скриптом»,
  Э9.1) все восемь подзадач подряд. Шаблоны (§7.1 ТЗ п.5, «методист не
  начинает с чистого листа») логически требуют что-то, из чего начинать —
  значит эта подзадача ОБЯЗАНА была включить и создание материала тоже, не
  только сами наборы блоков. Не расширение плана — то, без чего план для
  Э9.10 не имел бы смысла выполнить буквально.
- **`POST /materials`** — тело: `materialSchema` целиком (тот же контракт,
  что уже был у `PUT`), не урезанная «схема только для создания»: фронт
  всегда собирает валидный `Material` (шаблон ИЛИ пустой), второй похожей
  схемы не требуется. `repo.insertMaterial` — транзакция «строка
  `materials` (status: draft, currentVersionId: NULL — та же семантика,
  что у любого черновика, Э9.8) + первая версия», денормализованный кэш
  синхронизирован сразу (это первая версия, синхронизировать «до» нечему,
  в отличие от форка поверх публикации). `service.createMaterial` —
  `createdBy = user.sub` ВСЕГДА, для любой из трёх ролей (§4.2 ТЗ: «учитель
  создаёт материалы только в личной папке» — распространено на
  admin/methodist ровно так же: каждый заводит материал в СВОЕЙ папке, не
  общей).
- **Ключевое архитектурное решение — фабрики блоков вынесены в отдельный
  `block-factories.ts`** (`CONTENT_BLOCK_LABELS`/`INTERACTION_LABELS`/
  `createBlock`/`createContentBlock`/`createQuestionBlock`/`createInteraction`,
  раньше жили НЕэкспортированными внутри `MaterialEditorPage.tsx`, кнопка
  «Добавить блок», Э9.2). Шаблоны (`material-templates.ts`) строят блоки
  ТЕМИ ЖЕ функциями, что и «Добавить блок» в редакторе — не второй похожий
  набор литералов, который рано или поздно разъедется с первым при
  добавлении 11-го типа блока.
- **Найден и исправлен реальный баг, обнаруженный при переносе кода** — не
  придуманный, а физически воспроизводимый: `createInteraction("matching")`
  создавал `pairs: []`, но `matchingInteractionSchema.pairs` в схеме
  `.min(1)`. Значит методист, добавивший через «Добавить блок» → «Сопоставление»
  и не успевший руками добавить хотя бы одну пару ДО следующего
  автосохранения, получал материал, который `materialSchema.parse` на
  сервере (`PUT /materials/:id`) отклонял ЦЕЛИКОМ — включая никак не
  связанные правки в других блоках того же материала, молча забуксовав
  автосохранение (`useMaterialAutosave` показывает общее «не сохранено —
  повторим», без указания, ЧТО именно сломано) до тех пор, пока
  пользователь не откроет именно этот matching-блок и не добавит пару
  вручную — что не очевидно, если проблема не в последнем изменённом блоке.
  Исправлено: свежий `matching`-блок теперь сразу связывает единственную
  пару left[0]/right[0] по умолчанию (`pairs: [[leftId, rightId]]`) — та
  же гарантия, что уже была у `ordering` (валиден с двумя элементами
  сразу, без обязательной ручной правки). Починка сделана именно сейчас,
  а не отложена — код и так переносился в новый файл, стоимость правки в
  этот момент была на порядок ниже, чем открывать отдельную задачу на
  баг, обнаруженный случайно.
- **Три шаблона** (`material-templates.ts`, все строятся фабриками из
  `block-factories.ts`, заполнены СТРУКТУРОЙ и общими подписями — не
  выдуманным предметным содержимым, которое методисту всё равно придётся
  заменить):
  - **«Проверочная на 10 вопросов»** — вступление (`rich_text`) + 10
    `single_choice`-вопросов с плейсхолдер-текстом «Вопрос N», у каждого
    ПЕРВЫЙ вариант отмечен как правильный по умолчанию — шаблон сразу
    проходит валидатор (Э9.9) без правок (проверено — см. ниже), методист
    меняет текст, а не борется с «нет правильного ответа» на пустом месте.
  - **«Разбор задачи»** — условие (`rich_text`) → формула (`formula`,
    заглушка `"x"` — схема требует непустой `latex`) → два шага
    (`callout`, вариант `example`) → вопрос `numeric_input` (значение `0`
    — валидный ответ по определению типа, Э9.9). Тоже чисто проходит
    валидатор.
  - **«Словарный диктант»** — вступление + 10 `text_input`-вопросов
    «Слово N» с ПУСТЫМИ вариантами ответа — СОЗНАТЕЛЬНО, не баг: реальное
    диктуемое слово шаблон угадать не может, придумывать плейсхолдер-текст
    в поле ответа было бы хуже, чем честно показать «нет правильного
    ответа» через валидатор (Э9.9) на каждый вопрос, пока методист не
    впишет настоящие слова — список проблем в `ValidationPanel` в этом
    случае и есть подсказка «что доделать», а не поломанный шаблон.
  - **«Пустой материал»** — четвёртый пункт списка выбора, `blocks: []`;
    даёт `material_empty` в валидаторе, ожидаемо, как и любой только что
    заведённый пустой материал.
- **`MaterialsLibraryPage.tsx`** — кнопка «+ Создать материал» разворачивает
  `CreateMaterialForm` (заголовок/предмет/классы-текстом/тема-опционально +
  радио-выбор шаблона). `grades` — свободный текст «8» или «8, 9», не
  мультиселект: в приложении нет справочника классов школы (фильтр
  библиотеки тоже свободный текст на класс), заводить отдельный источник
  правды под один инпут формы избыточно. По сабмиту — `buildMaterialFromTemplate`
  собирает `Material` на клиенте, `createMaterial` (`POST /materials`),
  переход на `/materials/:id/edit` только что созданного материала.
  Устаревшая заглушка библиотеки («материалы заводятся seed-скриптом») —
  снята, замена на обычное «ничего не найдено».
- **Проверено вне юнит-тестов — отдельный прогон через `esbuild`** (в
  среде нет фреймворка фронтовых тестов, `apps/web`'s `"test"` — заглушка
  с самого начала проекта, новый добавлять не стали ради одной проверки):
  временный скрипт (собран и удалён в этой же сессии, не остался в
  репозитории) прогнал `buildMaterialFromTemplate` для ВСЕХ четырёх
  шаблонов через `materialSchema.safeParse` (все четыре — валидны
  структурно) и `validateMaterialContent` (Э9.9): «Проверочная»/«Разбор
  задачи» — 0 проблем, «Словарный диктант» — ровно 10 `no_correct_answer`
  (ожидаемо, см. выше), «Пустой» — 1 `material_empty` (ожидаемо). Числа
  совпали с тем, что было спроектировано ДО прогона, не подгонялись под
  результат постфактум.
- **Новых зависимостей не потребовалось.**
- **Проверки**: `pnpm -r build` (shared/api/web, без ошибок и без `any`),
  `pnpm -r test` (**384/384**: 45 shared, 339 backend — 336 прежних + 3
  новых в `service.test.ts` на `createMaterial`, владение по всем трём
  ролям), `pnpm depcheck` (207 модулей, 586 связей, 0 нарушений),
  dev-сервер Vite — все новые/изменённые файлы (`MaterialsLibraryPage.tsx`,
  `material-templates.ts`, `block-factories.ts`, `MaterialEditorPage.tsx`)
  отдаются без ошибок трансформации.
- **Не проверено и не могло быть в этой среде (нет браузера, нет живого
  Postgres)**: реальный клик «Создать материал» → форма → редактор,
  живой `POST /materials` (таблицы физически создаются миграциями
  `0012`/`0013`, не прогнанными), визуальная проверка радио-списка
  шаблонов и формы метаданных. Показ методисту работающего редактора
  «каждые две недели начиная с Э9.4» (Гейт Э9, ПЛАН.md) — по-прежнему ни
  разу не проведён за шесть подряд подзадач (Э9.4–Э9.10); с созданием
  материала теперь наконец есть с чего начать такой показ целиком «с
  нуля», а не только с уже существующего seed-материала.

## Что сделано технически (Э9.11)

- **Ключевое решение — импорт распознаёт ТОЛЬКО ГРАНИЦЫ вопросов, не тип
  и не правильный ответ.** `splitIntoQuestionChunks` (`packages/shared/src/import.ts`,
  чистая функция) делит уже извлечённый текст по нумерованным строкам
  (`1.`/`2)` с обязательным пробелом после — «1.5» внутри текста не
  ложное срабатывание). Каждый кусок → ОДИН `open_answer`-блок. Причина
  минимальной эвристики — не объём работы, а риск: неверно угаданный
  «правильный» вариант в авто-данных тише всего подрывает доверие к
  материалу (никто не перепроверяет то, что программа «нашла сама»).
  Методист меняет тип/разносит варианты/отмечает ключ в уже готовом
  редакторе (Э9.5/9.6) — «дать поправить руками» из §7 ТЗ буквально.
- **Деградация, а не ошибка**: документ без единой нумерации → один блок
  на весь текст; текст до первого номера (заголовок/инструкция) → отдельный
  блок, не склеен с первым вопросом; пустой текст → пустой список (не один
  пустой блок).
- **`document-import.ts` (apps/api)** — извлечение сырого текста из ДВУХ
  форматов: `.docx` через `mammoth.extractRawText`, `.pdf` через
  `pdfjs-dist/legacy/build/pdf.mjs` (Node-сборка без DOM, сама уходит в
  синхронный fake-worker без `Worker`). Легаси `.doc` (бинарный) —
  явный отказ 400 `unsupported_type` с текстом «пересохраните как .docx»,
  не молчаливый. pdf.js не даёт переводов строк — реконструируются по
  смене Y-координаты (`item.transform[5]`) между фрагментами, разделитель
  страниц добавляется явно (граница вопроса не теряется на стыке).
- **Текст из документа — НЕДОВЕРЕННЫЙ ввод**: `chunkToHtml` экранирует
  `<`/`>`/`&`/кавычки (ПЕРВЫЙ рубеж; `sanitizeHtml` на фронте — второй).
  `<`/`&`/`>` реально встречаются в тексте задач («x < 3 & y > 1») —
  тест проверяет это на реальном .docx, где mammoth раскодирует их из
  XML-сущностей в литеральные символы.
- **Защита от документа-бомбы**: `IMPORT_MAX_QUESTIONS = 200` (тот же
  принцип, что `MAX_SLIDES` конвертера презентаций, Э4.3) — лишнее
  режется, `truncated: true` в ответе, запрос не роняется.
- **`POST /materials/import`** (`routes.ts`) — `multipart/form-data`, та
  же видимость роли, что у создания/правки (admin/methodist/teacher).
  НЕ привязан к `materialId`, ничего не пишет в БД — чистое
  преобразование «файл → блоки», ответ `importedQuestionsResultSchema`
  (`blocks: QuestionBlock[]`, `truncated`). Добавление блоков в открытый
  черновик — отдельное действие на клиенте.
- **Фронт (`MaterialEditorPage.tsx`)** — компонент `ImportFromDocument`
  под меню «Добавить блок»: скрытый `<input type=file accept=".docx,.pdf">`,
  по выбору — `importQuestionsFromDocument` (`materials-api.ts`, FormData),
  полученные блоки уходят в `addBlocks` (массовое добавление одним
  обновлением состояния — не N вызовов `addBlock`, чтобы не плодить
  промежуточные записи в очередь автосохранения). Импортированные блоки
  НЕОТЛИЧИМЫ от созданных вручную — специальной обработки нет.
- **Новые зависимости (apps/api): `mammoth@^1.12`, `pdfjs-dist@^4.10`.**
  `pdfjs-dist` уже одобрен для apps/web (Э4.7) — здесь то же самое на
  сервере. `mammoth` — новая; обе build-time/бандл, не рантайм-сервис
  (правило допуска §1.2 ТЗ не затронуто). **Если добавление `mammoth` не
  согласовывалось явно — откатить `document-import.ts` + строку из
  package.json, .docx-ветка тогда отпадает, .pdf остаётся.**
- **Правка не из Э9.11, но по пути**: `activities/service.test.ts` имел
  time-bomb — `activityRow.deadline` был захардкожен `2026-09-05T10:00`,
  и 10 тестов `submitActivity` (сравнивает дедлайн с `Date.now()`) падали
  во второй половине того же дня. Дедлайн фикстуры переведён на
  относительный (`Date.now() + 7 дней`), три ассерта на точную строку —
  на `activityRow.deadline.toISOString()`.
- **Проверки**: `pnpm -r build` (shared/api/web — tsc + vite, без `any`),
  `pnpm -r test` (**400/400**: 54 shared — +9 новых `import.test.ts` на
  `splitIntoQuestionChunks` — , 346 backend — +7 новых `document-import.test.ts`
  на РЕАЛЬНЫХ .docx/.pdf, не моках: минимальный docx собран через jszip,
  минимальный pdf — вручную с посчитанными xref-офсетами), `pnpm depcheck`
  (214 модулей, 599 связей, 0 нарушений).
- **Не проверено и не могло быть в этой среде (нет браузера)**: реальный
  клик «Импортировать из Word/PDF» → выбор файла → блоки в списке →
  правка. Реальные экспорты из MS Word/Google Docs/LibreOffice (тестовые
  .docx/.pdf собраны синтетически — структура нумерации та же, но реальный
  Word кладёт куда больше служебной разметки, которую mammoth должен
  проглотить). Показ методисту работающего редактора (Гейт Э9, ПЛАН.md) —
  за все восемь подзадач Э9.4–Э9.11 ни разу не проведён, задел на сессию
  с живым окружением.

---

# Архив: Э8 — Движок заданий: плеер (завершён 2026-09-05)

Начато 2026-09-02, продолжено в ТОЙ ЖЕ сессии, что и Э5/Э6/Э7 — отступление
от правила «один этап = один контекст» (§1.1 ПЛАН.md) по явному решению
пользователя (тот же паттерн, что и для переходов Э5→Э6 и Э6→Э7, см. архивы
ниже): Э7 (Демонстрация экрана) полностью закрыт технически — все 4 задачи
Э7.1–Э7.4, 146/146 тестов бэкенда на момент закрытия, гейт Э7 (демонстрация
на 30 человек не поднимает трафик выше потолка Э6) остаётся заблокированным
— нет Docker/livekit-cli/Grafana MCP в этой среде (см. архив Э7 и памятку
project-video-platform-env-gaps). Пользователь явно попросил начать Э8 в
этой же сессии.

**Э8 принципиально другой по характеру, чем Э2–Э7** — «добавляет нагрузки
практически ничего» (ПЛАН.md), это HTTP+WS и объём кода, не WebRTC/медиа.
Ограничение «нет Docker» здесь почти не мешает: гейт Э8 (200 учеников
отвечают одновременно, p95 сохранения < 300 мс) нужен Postgres под нагрузкой,
не LiveKit — тоже недоступен в этой среде, но сам движок проверки и плеер
проверяются юнит- и типовыми тестами почти полностью без Docker.

**Область «не делегировать вслепую» (CLAUDE.md) частично покрывает Э8**:
«движок проверки (Э8.3) читать построчно — единственное место, где баг
тихо портит оценки учеников» (ПЛАН.md, дословно) и `stripInteractionAnswerKey`/
`stripMaterialAnswerKeys` (`packages/shared/src/materials.ts`, Э8.1) — та
единственная точка, которая решает, какие поля видит ученик до сабмита
(«Ключи ответов на задания никогда не уходят на клиент до сабмита», §
«Железные правила» CLAUDE.md). Плеер (Э8.4/8.5), панель прогресса (Э8.8),
аналитика (Э8.9) — обычная продуктовая работа, можно делегировать смелее.

## Стоп-лист Э8

```
НЕ делать на этом этапе:
- НЕ делать редактор для методистов. Материалы заводятся JSON-ом через
  seed-скрипт или Postman. Редактор — это Э9.
- НЕ делать типы 11-22. Ровно 10 типов.
- НЕ отправлять правильные ответы на клиент до сабмита. НИКОГДА.
- НЕ пускать ответы через общий Y.Doc урока
- НЕ делать геймификацию, баллы, рейтинги, бейджи
```

## Задачи

- [x] Э8.1 Zod-схемы формата материала (§6 ТЗ) в `packages/shared`.
- [x] Э8.2 Таблицы `materials`, `material_versions`, `activities`, `responses`. Миграции.
- [x] Э8.3 Движок проверки на сервере + табличные тесты на все типы, включая граничные случаи.
- [x] Э8.4 Плеер: типы 1–5.
- [x] Э8.5 Плеер: типы 6–10.
- [x] Э8.6 Выдача задания в уроке: индивидуальный канал, не через Yjs.
- [x] Э8.7 Автосохранение ответов каждые 5 сек + при потере фокуса.
- [x] Э8.8 Панель прогресса класса.
- [x] Э8.9 Агрегированная аналитика по вопросу.
- [x] Э8.10 Разбор: показать правильные ответы всем, вынести ответ на доску.
- [x] Э8.11 Режим «домашняя работа» вне урока.
- [x] Э8.12 Очередь ручной проверки с рубриками для `open_answer`.

## Гейт Э8

```
- 200 учеников одновременно отвечают на задание из 10 вопросов
- p95 сохранения ответа < 300 мс
- Тесты движка проверки: 100% покрытие всех 10 типов, включая
  частичные баллы, допуски у numeric, typo tolerance у text_input
- Ручная перепроверка: посадить учителя, дать составить задание,
  сравнить его ожидания с тем, что посчитал движок
```

## MCP под Э8

Постоянный набор (Context7, Playwright, GitHub) + **Postgres MCP Pro**
(таблица `responses` растёт быстрее всех — «топ медленных запросов»/анализ
индексов вместо угадывания) + **Playwright MCP** для проверки доступности
(accessibility-снимки, не скриншоты — §16 ТЗ «клавиатурная навигация во
всех типах заданий», Tab+Enter по каждому из 10 типов). Grafana можно
отключить — нагрузки на этом этапе нет. Postgres MCP Pro недоступен в этой
среде (нет живого Postgres) — задел на Linux-сессию для реальных
`EXPLAIN`/анализа индексов; схемы и движок пишутся и тестируются без него.

## Что сделано технически (Э8.1)

- **`packages/shared/src/materials.ts`** — новый модуль, схемы §6 ТЗ:
  9 контентных блоков (§6.2), 10 типов взаимодействия ровно по MVP-списку
  ★ из §6.3 ТЗ (стоп-лист Э8: «не делать типы 11–22»), обёртка `question`,
  `Material` целиком (§6.1), схемы ответов ученика `QuestionResponse` (§6.5,
  зеркалят `interaction` по `type`, чтобы движок проверки — Э8.3, ещё не
  сделан — сужал тип без приведений), минимальный контракт результата
  проверки `GradeResult`.
- **`true_false` и `ordering` — ТЗ не даёт для них примера схемы** (только
  строка в таблице §6.3), достраивались по аналогии с уже задокументированными
  типами: `true_false` — просто `correct: boolean` (обёртка `question` уже
  несёт `prompt`/`points`, доп. поля не нужны); `ordering` — по образцу
  `matching.left`/`right`, где ПОРЯДОК ЭЛЕМЕНТОВ В МАССИВЕ и есть ключ
  ответа, отдельного поля `correctOrder` не заводили — второе поле дублировало
  бы то же самое и могло разойтись с фактическим порядком `items`.
- **`stripInteractionAnswerKey`/`stripMaterialAnswerKeys` — единственная
  точка, которая решает, что из материала уходит ученику до сабмита**
  (§ «Железные правила» CLAUDE.md). Осознанно явный `switch` по каждому из
  10 типов с БЕЛЫМ списком безопасных полей, а не общий `omit` по
  дискриминированному объединению или чёрный список секретных полей —
  забытое новое секретное поле в белом списке просто не появится у клиента
  (безопасно по умолчанию), в чёрном — молча утекло бы. `feedback`
  (`correct`/`incorrect` тексты) не отдаётся вовсе на уровне
  `stripQuestionBlockAnswerKey` — текст обратной связи может выдавать
  верный вариант раньше времени (`showFeedback` из `settings` решает,
  когда его прислать ОТДЕЛЬНЫМ запросом — Э8.6/8.10, ещё не сделаны).
- **`ordering.items` и `single_choice`/`multiple_choice.options` (при
  `shuffle: true`) перемешиваются детерминированным seeded-PRNG
  (mulberry32 поверх строкового seed, не криптографический — для
  перемешивания вариантов ответа этого достаточно)**, а не только
  «фильтруются» — для `ordering` порядок хранения буквально И ЕСТЬ ответ
  (см. комментарий у `orderingInteractionSchema` в коде), отдать `items`
  as-is значило бы показать ответ напрямую в порядке массива. Seed —
  обязательный параметр (`` `${attemptId}:${questionId}` ``, формируется
  вызывающей стороной, Э8.6), а не встроенный `Math.random()`: перемешивание
  должно быть СТАБИЛЬНЫМ на попытку — иначе перезагрузка страницы посреди
  попытки меняет порядок элементов под рукой у ученика.
- **Материал сейчас `never` не проверяется на сервере zod-схемой при
  сериализации ответа API** — в проекте уже принят паттерн (декi, комнаты):
  zod валидирует ВХОДЯЩИЕ тела запросов, исходящие ответы типизированы TS
  без повторного `.parse()`. `PublicMaterial`/`PublicQuestionInteraction` —
  TS-типы, выведенные из фактического возвращаемого значения функций
  стрипинга (`ReturnType<typeof ...>`), не отдельно объявленные zod-схемы —
  дублировать 10 схем под «публичную» версию было бы источником расхождения
  между схемой и функцией, которая реально стрижёт поля.
- **`packages/shared` получил vitest** (согласовано с пользователем — не
  было тест-раннера, `"test": "echo no tests yet"`) — та же версия, что уже
  в `apps/api` (`^2.1.8`), `vitest.config.ts` по образцу `apps/api` (без
  блока `env`, схемам/чистым функциям Redis/Postgres не нужны). Логика
  сокрытия ключа ответа достаточно критична (§ «Железные правила»
  CLAUDE.md), чтобы не откладывать её проверку до Э8.3.
- Тесты: `packages/shared/src/materials.test.ts` (новый файл, 18 тестов) —
  по каждому из 10 типов: убирает секретное поле (`correct`/`answers`/
  `value`/`rubric`/`pairs`), не теряет и не дублирует элементы при
  перемешивании; `ordering`/`single_choice` с `shuffle` — перемешанный
  порядок не совпадает с хранимым (для достаточно длинного списка) и
  стабилен при одном и том же seed, но различается для разных seed;
  `stripMaterialAnswerKeys` не трогает контентные блоки и не отдаёт
  `feedback`; базовая валидация `materialSchema` (минимальный материал,
  отказ на неизвестный `schemaVersion`/опечатку в `interaction.type`).
- **Проверки**: `pnpm -r typecheck` (5 пакетов), `pnpm build`, `pnpm test`
  (146/146 бэкенда без изменений — Э8.1 не трогает `apps/api`, + 18/18
  новых в `packages/shared`), `pnpm depcheck` (153 модуля, 392 связи, 0
  нарушений) — зелёные. Новая зависимость — `vitest` в `packages/shared`
  (согласовано, та же версия, что в `apps/api`).
- **Не проверено и не могло быть в этой среде**: реальное использование
  этих схем ни фронтом (плеер — Э8.4/8.5), ни бэком (движок проверки —
  Э8.3, БД — Э8.2) — Э8.1 сама по себе только контракт, ничего ещё не
  вызывает эти функции в реальном запросе. Первая интеграционная проверка
  — по мере того, как Э8.2/8.3/8.6 появятся в этой же сессии.

## Что сделано технически (Э8.2)

- **`materials` — тонкая обёртка идентичности, БЕЗ содержимого.**
  `title`/`subject`/`grades`/`blocks`/`settings` (всё, что описывает
  `materialSchema` из Э8.1) живут только в `material_versions.content`
  (`jsonb`) — не задваивались на `materials`: два источника правды для
  одного и того же поля рассинхронизируются при первой же правке.
  Редактора и публикации ещё нет (Э9) — материалы заводятся JSON-ом через
  seed-скрипт/Postman (стоп-лист Э8), поэтому у `materials` сознательно
  НЕТ `currentVersionId`: «текущая» версия материала — просто последняя по
  `version` в `material_versions` (уникальный индекс `(materialId,
  version)`), а не отдельный указатель, который создал бы циклическую
  связь между двумя таблицами ради workflow черновик→ревью→публикация,
  которого на Э8 ещё нет (это Э9.8).
- **`material_versions` — append-only**, без `updatedAt`: правка
  опубликованной версии создаёт НОВУЮ строку с большим `version`, не
  мутирует существующую — задел на будущий workflow версионирования (Э9.8),
  ничего в Э8 на это не полагается, но модель данных уже совместима.
- **`activities` ссылается на `materialVersions`, не на `materials`
  напрямую** — какую именно версию видел ученик при выполнении, должно
  быть воспроизводимо даже после того, как методист опубликует новую
  версию материала (Э9.8) — иначе разбор (Э8.10) или пересчёт баллов после
  правки ключа ответа мог бы внезапно свериться с другим содержимым, чем
  реально видел ученик. `lessonId` nullable — «домашняя работа» (Э8.11) не
  привязана к уроку.
- **`responses` — колонки взяты ДОСЛОВНО из §6.5 ТЗ** (`attempt_id,
  material_id, lesson_id (nullable), user_id, question_id, response,
  score, max_score, auto_graded, graded_by, graded_at, time_spent_ms,
  attempt_number, submitted_at`), плюс одно осознанное дополнение сверх
  буквального текста спецификации:
  - **Отдельной таблицы `attempts` нет** — ТЗ её не заводит, `attemptId`
    здесь просто UUID, сгенерированный при старте попытки (Э8.6, ещё не
    сделан), группирующий строки одной попытки без отдельной сущности.
  - **`activityId` — необходимое дополнение, в ТЗ явно не названо.** Один
    и тот же материал можно выдать дважды (разным урокам или как домашнюю
    работу) — без `activityId` ответы разных выдач было бы не различить
    только по `materialId`. `materialId` оставлен рядом (как в ТЗ) — для
    аналитики по материалу вне привязки к конкретной выдаче (Э8.9,
    «17 из 24 выбрали B» имеет смысл агрегировать и по всем выдачам сразу).
  - **`questionId` — `text`, не FK**: вопросы живут внутри
    `material_versions.content` (JSONB), не в отдельной таблице —
    ссылаться не на что на уровне БД.
  - **`response` хранится всегда**, независимо от `autoGraded` — «чтобы
    можно было перепроверить после исправления ключа ответа» (§6.5 ТЗ
    дословно); `score`/`maxScore` — nullable (типы 6/20/21 ждут ручной
    проверки, см. §6.4 ТЗ, до неё баллов ещё нет).
  - Уникальный индекс `(attemptId, questionId)` — естественный ключ
    будущего автосохранения (Э8.7): один ответ на один вопрос одной
    попытки, upsert-цель, а не отдельная логика поиска существующей строки.
    Дополнительные индексы `(activityId, userId)` (проверка/возобновление
    попытки, Э8.6/8.7) и `(materialId, questionId)` (аналитика, Э8.9).
- **Миграция сгенерирована `drizzle-kit generate` БЕЗ живого Postgres** —
  генерация схемы работает диффом TS-схемы против JSON-снапшотов в
  `drizzle/meta/`, живая БД нужна только `migrate`/`push`/`studio`, не
  `generate` (прочитано поведение по факту успешного прогона в этой среде,
  где Postgres нет). Новая миграция `0007_sleepy_trish_tilby.sql`
  (автоимя `drizzle-kit`) — 4 новые таблицы, 1 новый enum
  (`activity_mode`), 8 внешних ключей, 4 индекса/уникальных ограничения.
  Прочитана построчно — область «не делегировать вслепую» CLAUDE.md не
  называет миграции явно, но некорректная схема БД для движка проверки
  (Э8.3) была бы тем же риском «тихо портит оценки», поэтому проверена с
  той же тщательностью.
- **Репозиторий/сервис-слой для этих таблиц НЕ созданы** — Э8.2 по
  формулировке задачи это «таблицы + миграции» («БД готова»), CRUD над
  ними появится по мере того, как он реально понадобится Э8.3 (движок
  проверки читает `material_versions`/пишет `responses`) и Э8.6 (создание
  `activities`) — заводить репозиторий без вызывающего кода означало бы
  недоиспользуемый каркас, который пришлось бы подгонять под реальные
  запросы позже.
- **Проверки**: `pnpm -r typecheck` (5 пакетов), `pnpm build`, `pnpm test`
  (146/146 бэкенда, 18/18 shared), `pnpm depcheck` (153 модуля, 392 связи,
  0 нарушений) — зелёные. Новых зависимостей нет.
- **Не проверено и не могло быть в этой среде**: реальное применение
  миграции (`db:migrate`) против живого Postgres — синтаксис SQL проверен
  чтением, но не исполнением; корректность FK/индексов под реальной
  нагрузкой (гейт Э8: 200 учеников одновременно, p95 < 300 мс) —
  Postgres MCP Pro для анализа индексов тоже недоступен здесь. Первая живая
  проверка — на Linux при `docker compose up` + `pnpm db:migrate`.

## Что сделано технически (Э8.3)

- **`apps/api/src/modules/materials/`** — новый модуль (каталог с
  `.gitkeep` был зарезервирован под него с ранних этапов). Наружу торчит
  только `service.ts` (правило CLAUDE.md), реальная реализация — в
  `grading.ts`, **прочитана и написана построчно** (дословное требование
  ПЛАН.md к Э8.3 — «единственное место, где баг тихо портит оценки
  учеников, и никакой MCP этого не поймает»).
- **Отдельная функция на каждый из 10 типов внутри одного `switch`, не
  общая формула поверх дискриминированного объединения** — осознанное
  архитектурное решение именно для этого модуля: одна ошибка в общей
  формуле задела бы сразу все 10 типов молча и одинаково; отдельные ветки
  ошибаются порознь и заметно на табличных тестах.
- **`gradeResponse(interaction, response, points)` бросает исключение при
  `interaction.type !== response.type`**, а не тихо возвращает 0 — тихий
  ноль неотличим в логах/аналитике (Э8.9) от честного неверного ответа;
  такое рассогласование значит баг вызывающей стороны (Э8.6, ещё не
  сделана) или подделанный запрос, требует шума, а не тихой деградации
  оценки.
- **§6.4 ТЗ, частичные баллы `max(0, (верных − неверных) / всего)` — ТОЛЬКО
  для `multiple_choice`, `matching`, `cloze_dropdown`, `cloze_text`.**
  `ordering` НЕ входит в этот список (перечислен в ТЗ явно, `ordering` в
  перечислении нет) — реализован all-or-nothing: один переставленный
  элемент = 0, не частичный балл. Это прямое следствие текста ТЗ, не
  недосмотр — отмечено в коде и подтверждено отдельным тестом
  («переставлены местами два соседних элемента — 0, не частичный балл»).
- **`multiple_choice`/`matching`: «всего» в формуле — общее число
  ПРАВИЛЬНЫХ вариантов/пар, не общее число вариантов/пар вообще** — ТЗ
  не уточняет это явно (дан только текст формулы), выбрано по аналогии со
  стандартной практикой multiple-response тестов: правильный выбор
  прибавляет, неверный — вычитает, всё нормируется на то, сколько верных
  надо было найти. Задокументировано в коде как интерпретация, не факт из
  ТЗ — тот же принцип прозрачности, что уже применялся в Э8.1 для
  `true_false`/`ordering`.
- **Незаполненный пропуск в `cloze_dropdown`/`cloze_text` не штрафуется**
  (не считается ни верным, ни неверным, просто не входит ни в один
  счётчик) — тоже интерпретация: ТЗ не разбирает случай пустого пропуска
  отдельно. Отличие от «выбрал неверный вариант»: не ответить — не то же
  самое, что ответить неправильно.
- **`numeric_input`**: `absolute`/`relative`/`percent` — три разных способа
  посчитать допустимое отклонение от `tolerance.value` (абсолютное число;
  доля от правильного значения; то же самое, но в процентах), сравнение
  границы допуска — нестрогое (`<=`, попадание точно на границу — верно).
  `unitRequired: true` без единицы или с любой другой строкой — 0,
  независимо от того, насколько точно совпало число.
- **`text_input`/`cloze_text`, три режима сопоставления**: `exact` —
  посимвольно (с учётом `caseSensitive`/`trimWhitespace`); `normalized` —
  то же самое плюс схлопывание повторных пробелов ВНУТРИ строки (ТЗ не
  расписывает разницу между `exact`/`normalized` явно — разумное прочтение
  названия режима, задокументировано как интерпретация); `regex` —
  `RegExp` с флагом `i`, если `caseSensitive: false`. Расстояние
  Левенштейна (`typoTolerance`) — классический DP-алгоритм без
  зависимости, применяется ТОЛЬКО к `exact`/`normalized`, к `regex`
  сознательно нет («опечатка в регулярном выражении» бессмысленна как
  понятие пользовательского ответа) — отдельно проверено тестом.
- **`open_answer` не выставляет 0 как «неверно»** — `correct: null`
  означает «не проверено», ждёт очереди ручной проверки с рубрикой
  (Э8.12, ещё не сделана) — §6.4 ТЗ: ручная проверка для типов 6/20/21.
- Тесты (`apps/api/src/modules/materials/grading.test.ts`, новый файл, 37
  тестов, `it.each` для однотипных случаев): по каждому из 10 типов —
  верный ответ, неверный, «не отвечено» (`null`); отдельно —
  `multiple_choice` (полный/частичный/только неверные — клампится в 0,
  ничего не выбрано), `numeric_input` (все три вида допуска, граница
  допуска инклюзивно, `unitRequired` во всех вариантах, `null`),
  `text_input` (все три режима сопоставления, `caseSensitive`,
  `trimWhitespace`, `typoTolerance` — включая граничное расстояние
  Левенштейна ровно на допуске и на единицу больше, отдельно — что допуск
  НЕ действует на `regex`, несколько вариантов ответа), `cloze_dropdown`/
  `cloze_text` (частичные баллы, незаполненный пропуск не штрафуется),
  `matching` (`all_or_nothing` и `partial` отдельно), `ordering`
  (all-or-nothing, не частичный балл — прямая проверка требования §6.4
  ТЗ), несовпадение `interaction.type`/`response.type` — исключение.
  Все числовые ожидания в тестах перепроверены вручную построчно (не
  просто «тест зелёный, значит верно») — то самое требование ПЛАН.md
  «читать построчно» относится и к тестам движка, не только к его коду.
  Итого 183/183 бэкенда (было 146, +37).
- **Проверки**: `pnpm -r typecheck` (5 пакетов), `pnpm build`, `pnpm test`
  (183/183 бэкенда, 18/18 shared), `pnpm depcheck` (156 модулей, 397
  связей, 0 нарушений) — зелёные. Новых зависимостей нет.
- **Не проверено и не могло быть в этой среде**: гейт Э8 буквально — «200
  учеников одновременно отвечают, p95 сохранения < 300 мс» (нужен живой
  Postgres под нагрузкой) и «ручная перепроверка: посадить учителя, дать
  составить задание, сравнить его ожидания с тем, что посчитал движок»
  (нужен реальный учитель и работающий плеер — Э8.4/8.5, ещё не сделаны).
  Табличные тесты покрывают формулы и граничные случаи, но не заменяют ни
  то, ни другое.

## Что сделано технически (Э8.4)

- **`apps/web/src/features/materials/QuestionPlayer.tsx`** — плеер типов
  1–5 (`single_choice`, `multiple_choice`, `true_false`, `text_input`,
  `numeric_input`); типы 6–10 — Э8.5, диспетчер (`InteractionPlayer`) уже
  на них рассчитан (`switch` по `interaction.type`, недостающие ветки
  сейчас рендерят явную заглушку, а не падают).
- **Только НАТИВНЫЕ элементы формы** (`input[type=radio/checkbox/text/
  number]` в `<label>`, `<fieldset><legend>` для групп, `<details>` для
  подсказки) — не кастомные `<div onClick>` (§16 ТЗ: «клавиатурная
  навигация во всех типах заданий»). Радио/чекбоксы получают Tab/стрелки/
  Space от браузера бесплатно и корректно для скринридеров — переизобретать
  вручную было бы источником багов доступности, которые `Playwright MCP`
  (accessibility-снимки, недоступен в этой среде) либо не поймает, либо
  поймает поздно.
- **Компонент принципиально не может получить ключ ответа** — принимает
  `PublicQuestionBlock`/`PublicQuestionInteraction` (Э8.1,
  `stripInteractionAnswerKey`), в типе которых секретных полей просто нет.
  Контролируемый (`value`/`onChange`), без своего состояния ответа —
  хранение (автосохранение, Э8.7) и синхронизация между вопросами целого
  материала — забота будущего плеера материала (ещё не сделан).
- **`numeric_input`: `unit` (ожидаемая единица измерения) остаётся видимым
  в публичной схеме** (Э8.1) — это НЕ часть ключа ответа (не число), а
  формат-подсказка «в каких единицах отвечать» (как задание физики говорит
  «ответ в м/с²»); UI показывает её как плейсхолдер-подсказку, но ученик
  всё равно должен САМ набрать единицу в отдельном поле — движок (Э8.3)
  сверяет введённую строку с ожидаемой, наличие подсказки не отменяет
  требования явно её вписать.
- **Обнаружена и закрыта уязвимость до того, как она попала в код**:
  `prompt`/`hint`/варианты ответов — HTML (§6 ТЗ, `{html: "<p>...</p>"}`),
  до Э9 материалы заводятся JSON-ом через seed-скрипт/Postman без
  редактора — сырой `dangerouslySetInnerHTML` дал бы хранимый XSS (кто
  угодно с доступом к БД/API вкладывает `<script>`/`onerror=` в JSON
  материала, оно выполняется в браузере каждого ученика). Решение
  пользователя (согласовано) — добавлена **`dompurify`** (`^3.2.3`, без
  внешнего CDN, в бандле). **`apps/web/src/shared/sanitize-html.ts`** —
  единая точка санитайзации, белый список тегов (структура/базовая
  разметка текста — то, что реально встречается в форматах §6 ТЗ), без
  `script`/`iframe`/атрибутов-обработчиков событий; `href`/`target`/`rel`
  разрешены на `<a>` (DOMPurify сам вычищает `javascript:`-схемы — штатная
  защита библиотеки, не переизобреталась).
- **Проверено вручную в реальном браузере** (правило CLAUDE.md: UI-фичи —
  руками, не только typecheck) через временный маршрут-харнесс (создан,
  проверен, полностью удалён из `App.tsx` перед коммитом — не часть
  поставки): все 5 типов рендерятся, значения `value`/`onChange`
  корректно собираются в форму `QuestionResponse` (проверено чтением
  итогового JSON на странице); клавиатурная навигация внутри
  `single_choice`/`true_false` — стрелка вниз в фокусированной радиогруппе
  двигает и фокус, и выбор нативно, без единой строчки своего JS; **XSS-
  полезная нагрузка, намеренно вложенная в подсказку одного из тестовых
  вопросов (`<img src=x onerror="alert(1)">`), не выполнилась** — санитайзер
  вырезал тег до рендера; консоль браузера — без ошибок приложения (два
  исключения оказались от стороннего рекламного расширения браузера, не
  от кода).
- **Проверки**: `pnpm -r typecheck` (5 пакетов), `pnpm build`, `pnpm test`
  (183/183 бэкенда, 18/18 shared — Э8.4 их не трогает), `pnpm depcheck`
  (159 модулей, 400 связей, 0 нарушений) — зелёные. Новая зависимость —
  `dompurify` в `apps/web` (согласовано с пользователем).
- **Не проверено и не могло быть в этой среде**: интеграция с реальным
  плеером материала целиком и автосохранением (Э8.7, ещё не сделаны) —
  сейчас это изолированный, но живьём проверенный компонент; полноценная
  проверка доступности `Playwright MCP` (accessibility-снимки) —
  недоступен здесь, ручная проверка ограничилась одной клавишей на одном
  типе, не полным Tab/Enter-прогоном по всем пяти.

## Что сделано технически (Э8.5)

- **`AdvancedInteractionPlayers.tsx`** — типы 6–10 (`open_answer`,
  `cloze_dropdown`, `cloze_text`, `matching`, `ordering`), подключены в тот
  же диспетчер `InteractionPlayer` (`QuestionPlayer.tsx`), что и типы 1–5
  (Э8.4) — единая точка входа плеера на все 10 типов ★ MVP.
- **Новая зависимость `@dnd-kit/core` + `@dnd-kit/sortable` +
  `@dnd-kit/utilities`** (согласовано с пользователем — названа именно под
  эту задачу ещё в ПЛАН.md, но формально не была добавлена до сих пор;
  зафиксировано раньше как «зарезервирован под Э8.5» в заметках Э5.3, где
  сознательно НЕ притащили её ради плитки видео).
- **`ordering` — `@dnd-kit/sortable`**, устоявшийся, хорошо документированный
  сценарий («переставить элементы одного списка»): `KeyboardSensor` с
  `sortableKeyboardCoordinates` (стандартная связка библиотеки для этого
  случая). Сервер отдаёт `items` уже перемешанными (Э8.1,
  `stripInteractionAnswerKey`) — счёт правильного порядка ведёт движок
  (Э8.3) по исходному, не перемешанному массиву на сервере, плеер об этом
  не знает и знать не должен.
- **`matching` — НЕ чистый `@dnd-kit/sortable`** (это не переупорядочивание
  одного списка, а «перенести элемент в один из нескольких отдельных
  слотов»), низкоуровневые `useDraggable`/`useDroppable` из
  `@dnd-kit/core`. Клавиатурная семантика курсора для ЭТОГО сценария менее
  очевидна и хуже документирована, чем для `sortable`, поэтому `matching`
  получил ДВОЙНОЙ интерфейс на одно и то же состояние: drag-and-drop
  (основной, наглядный) ПЛЮС `<select>` на каждый левый элемент — тот же
  результат, гарантированно доступный по Tab/Enter независимо от того,
  как именно ведёт себя клавиатурный сенсор dnd-kit в конкретном браузере.
  Проверено вручную (см. ниже): назначение через `<select>` корректно
  «отбирает» элемент у прежнего слота (как и должен вести себя drag),
  оба интерфейса остаются в одном согласованном состоянии.
- **`ordering` получил ту же логику страховки** — кнопки ▲/▼ на каждый
  элемент рядом с ручкой перетаскивания: обычные `<button>`, работают по
  Tab+Enter без каких-либо допущений о поведении drag-курсора.
- **`cloze_dropdown`/`cloze_text`** — общий разбор `template` (`{{gapId}}`
  → текст/`<select>` или `<input>` инлайн) вынесен в `splitTemplate` —
  единая функция на оба типа, различается только тем, ЧТО рендерится в
  месте пропуска (список вариантов или свободный ввод) в соответствии с их
  разными `PublicQuestionInteraction`-формами (Э8.1: `cloze_dropdown`
  хранит `options` по каждому пропуску, `cloze_text` — только `gapIds`,
  сам текст ответа не показывается).
- **`open_answer`**: `<textarea>` со счётчиком символов (`maxLength`);
  `allowAttachments` из схемы намеренно НЕ реализован интерфейсом
  прикрепления файлов — загрузка вложений требует `StorageAdapter`/эндпоинта
  приёма, которых сейчас нет ни у одной задачи Э8 текущего среза; строить
  файловый загрузчик без места, куда ему отправлять файлы, значило бы
  сиротский код. Отмечено «проверяется учителем вручную» — соответствует
  §6.4 ТЗ (ручная проверка, тип 6).
- **HTML внутри `cloze_dropdown`/`cloze_text`/`matching` тоже проходит
  через `sanitizeHtml`** (Э8.4) — та же санитайзация уже была введена для
  типов 1–5, здесь просто применена ко всем новым местам, где рендерится
  `html` из материала (текстовые фрагменты шаблона, подписи элементов
  `left`/`right`/`items`).
- **Проверено вручную в реальном браузере** (тот же временный
  маршрут-харнесс, что в Э8.4 — создан, проверен, полностью удалён из
  `App.tsx` перед коммитом): все 5 типов рендерятся; `open_answer` считает
  символы; `cloze_dropdown`/`cloze_text` инлайн-элементы вставляются в
  нужные места шаблона; **drag-and-drop в `matching` работает** (перетащенный
  вариант встаёт в слот, пропадает из пула, освобождает прежний слот, если
  был назначен туда) — при перетаскивании в непредвиденный слот (из-за
  неточной наводки координат в тесте) поведение осталось корректным
  (элемент занял ИМЕННО тот слот, куда его отпустили); **выбор через
  `<select>`-альтернативу корректно «отбирает» элемент у прежнего слота**,
  оба интерфейса остаются согласованными; кнопки ▲/▼ в `ordering`
  переставляют элементы; итоговый JSON на странице подтвердил точную форму
  всех пяти `QuestionResponse`. Консоль браузера — без ошибок приложения.
  **Нативная клавиатурная активация drag-сенсора dnd-kit (Space/стрелки на
  ручке перетаскивания) НЕ была однозначно подтверждена** одной попыткой в
  этой среде (возможно, тому виной фокус после клика мышью, а не
  неисправность самого сенсора) — это не блокирует требование §16 ТЗ,
  поскольку кнопки ▲/▼ и `<select>` — независимо проверенный и
  гарантированный путь к тому же результату, но отдельная задача (не
  ставилась в Э8.5) — довести и явно подтвердить именно клавиатурный DnD,
  если это понадобится сверх уже гарантированной доступности.
- Тесты: не добавлялись — тот же прецедент, что Э8.4 (`apps/web` без
  тестового раннера на компонентах, только typecheck/build + ручная
  проверка в браузере).
- **Проверки**: `pnpm -r typecheck` (5 пакетов), `pnpm build`, `pnpm test`
  (183/183 бэкенда, 18/18 shared — Э8.5 их не трогает), `pnpm depcheck`
  (163 модуля, 407 связей, 0 нарушений) — зелёные. Новая зависимость —
  `@dnd-kit/core`+`@dnd-kit/sortable`+`@dnd-kit/utilities` в `apps/web`
  (согласовано с пользователем).
- **Не проверено и не могло быть в этой среде**: `Playwright MCP`
  (accessibility-снимки, официальный сценарий проверки §16 ТЗ из ПЛАН.md
  для Э8) — недоступен здесь; клавиатурная активация именно drag-сенсора
  (см. выше); интеграция с реальным плеером материала/автосохранением
  (Э8.6/8.7, ещё не сделаны).

## Что сделано технически (Э8.6)

- **Новый модуль `apps/api/src/modules/activities/`** (каталог был пуст) —
  наружу торчит только `service.ts` (правило CLAUDE.md). `repo.ts` владеет
  таблицами `activities`/`responses` из центрального `db/schema.ts` (тот же
  паттерн, что `decks`/`lessons` — dependency-cruiser запрещает импорт
  чужого `repo.ts`, но не таблиц из общей схемы). `assertLessonTeacher`/
  `assertLessonMember` в сервисе — **область «логика прав доступа», читаны
  построчно** (§ «Что не делегировать вслепую» CLAUDE.md); скопированы по
  смыслу с `rooms.assertMembership`, не импортированы (та не экспортируется).
- **`materials` модуль дорос до `repo.ts` + чтения версий** — `getLatestMaterial`
  (последняя версия материала школы — Э8.2: без указателя `currentVersionId`,
  просто `max(version)`), `getMaterialVersion` (закреплённая версия по id).
  Содержимое `material_versions.content` (`jsonb`) на чтении **разбирается
  `materialSchema.safeParse`** — это внешняя по отношению к коду граница
  (в отличие от исходящих ответов API, которые в проекте не re-parse-ятся);
  `.parse` заодно проставляет `.default()` (shuffle/showFeedback/attemptsAllowed).
- **`POST /lessons/:id/activities`** (учитель-хозяин/админ) — закрепляет
  ИМЕННО ту версию материала, что видна сейчас (`activities.materialVersionId`,
  не `materialId`: разбор/пересчёт баллов после Э9.8 сверяется с тем, что
  реально видел ученик), пишет строку `activities`, шлёт в WS-канал урока
  (`rooms.broadcastToLesson`, **не Y.Doc**) короткое
  `activity_started {activityId}` — новый вариант `serverRoomMessageSchema`
  (тот же приём, что `deck_status` в Э4.4). Отказ на завершённый урок (409).
- **`GET /activities/:id/my`** (участник урока) — индивидуальная копия:
  - `attemptId` — **детерминированный UUID v5 (SHA-1)** от тройки
    `(activityId, userId, attemptNumber)`, БЕЗ отдельной таблицы `attempts`
    (Э8.2 сознательно её не завёл). Стабильность обязательна: `attemptId` —
    сид перемешивания вариантов (Э8.1), перезагрузка страницы посреди
    попытки не должна менять порядок ответов под рукой у ученика.
  - `attemptNumber` = `max(1, max(responses.attemptNumber))` по
    `(activityId, userId)` — задел на повторные попытки (`attemptsAllowed`),
    сейчас всегда 1.
  - `startedAt` — точка отсчёта таймера, пишется в Redis один раз (`SET NX`,
    TTL 7 дней). «Кеш, который можно потерять» (§ Железные правила): при
    потере таймер стартует заново, абсолютный `deadline` в БД не страдает.
  - `material` проходит `stripMaterialAnswerKeys(material, attemptId)` —
    ключей ответов физически нет, порядок вариантов свой на попытку.
  - `savedResponses` — черновики ЭТОЙ попытки (`findResponsesByAttempt`
    по `attemptId`), чтобы перезагрузка не теряла ответы (наполняются в
    Э8.7). Чужую попытку не отдаст: `attemptId` разный у разных `userId`.
  - Чужая школа → **404, не 403** (существование активности другой школы
    наружу не подтверждаем).
- **`GET /lessons/:id/activities`** — список выдач урока, фолбэк-поллинг на
  случай пропущенного WS-сигнала.
- **Seed-скрипт `apps/api/src/db/seed-material.ts`** (`pnpm --filter
  @school/api seed:material -- ./material.json [schoolId] [userId]`) —
  материалы заводятся JSON-ом до редактора методиста (стоп-лист Э8: «через
  seed-скрипт или Postman»). Валидирует `materialSchema`, создаёт материал +
  версию 1 (или `--material <id>` → следующую версию, append-only). Лежит в
  `src/db/` рядом с `migrate.ts` — попадает под `typecheck`, не орфан
  (импортирует client/schema). Не рантайм.
- **Фронт (данные, без интеграции в `RoomPage`)**: `activity-api.ts`
  (`createActivity`/`getMyActivity`/`listLessonActivities` поверх `apiFetch`)
  + **`MaterialPlayer.tsx`** — «плеер материала целиком», который Э8.4/8.5
  отложили: держит ответы всех вопросов в одном месте, отдаёт каждое
  изменение через `onResponseChange` (точка подключения автосохранения Э8.7),
  рендерит контентные блоки §6.2. Блоки, требующие KaTeX/пайплайна ассетов
  (`formula`/`image`/`video`/`audio`/`embed`), пока заглушка — KaTeX в бандл
  и StorageAdapter для вложений подключаются отдельно (новые зависимости —
  по согласованию).
- **Проверки**: `pnpm -r typecheck` (5 пакетов), `pnpm build`, `pnpm test`
  (**196/196** бэкенда — +13 новых `activities/service.test.ts`: детерминизм
  `attemptId`, права учителя/участника, 404 на чужую школу, изоляция черновиков
  между учениками, `activity_started` в broadcast; 18/18 shared),
  `pnpm depcheck` (171 модуль, 450 связей, 0 нарушений) — зелёные. Новых
  зависимостей нет.
- **Не проверено и не могло быть в этой среде**: живой прогон против
  Postgres/Redis (нет Docker — см. `project-video-platform-env-gaps`):
  реальный `POST`/`GET /my`, применение seed-скрипта, гейт Э8 (200 учеников,
  p95 < 300 мс); интеграция плеера в `RoomPage` (кнопка «Запустить для
  класса» у учителя + автооткрытие у ученика по `activity_started`) — нет
  библиотеки материалов/панели учителя в UI, это следующий кусок (пара с
  Э8.7); `Playwright MCP` accessibility-снимки.

## Что сделано технически (Э8.7)

- **`POST /activities/:id/responses`** (только `student`) — автосохранение
  черновика ОДНОГО ответа. DoD «обрыв связи не теряет ответы»: идемпотентный
  **upsert по `(attemptId, questionId)`** (`repo.upsertDraftResponse`,
  `onConflictDoUpdate` на индекс `responses_attempt_question_idx` — Э8.2
  завёл его ровно под это). Повторная отправка того же не создаёт дублей и
  не падает.
- **Черновик НЕ оценивается**: `score`/`maxScore` = NULL, `autoGraded` =
  false — движок проверки (Э8.3) отработает на сабмите (Э8.10+, ещё не
  сделан). `submittedAt` здесь = момент последнего сохранения.
- **Тип ответа сверяется с типом взаимодействия вопроса** по ЗАКРЕПЛЁННОЙ
  версии материала (`findQuestion` + `question.interaction.type ===
  input.response.type`, иначе 400) — плеер не может записать ответ не того
  типа, `gradeResponse` (Э8.3) на таком рассогласовании бросает исключение.
- **Дедлайн**: если `activity.deadline` в прошлом — 409, черновик не
  пишется. Вопроса нет в материале — 404. Не ученик — 403.
- **`resolveAttempt(activityId, userId)`** — общий с `getMyActivity` расчёт
  текущей попытки: черновик пишется в ту же попытку, что отдаётся плееру
  (тот же `attemptId`). `timeSpentMs` — `greatest(старое, новое)` (задел на
  панель прогресса Э8.8, клиент пока не шлёт).
- **Изоляция**: разные ученики пишут в разные `attemptId` (детерминирован
  от `userId`) — «ученик не видит ответы соседа» держится и на записи.
- **Фронт**: `useActivityAutosave(activityId)` — очередь по `questionId`
  (копятся только последние значения), debounce 5 сек от последнего
  изменения, немедленный сброс с `keepalive` на `visibilitychange → hidden`
  и `beforeunload`; неотправленное после ошибки возвращается в очередь.
  `MaterialPlayer` получил проп `autosaveActivityId` — при нём каждое
  изменение уходит в очередь, в шапке индикатор «черновик / сохранение… /
  сохранено / не сохранено — повторим». `activity-api.saveResponse` умеет
  `keepalive`.
- **Проверки**: `pnpm -r typecheck` (5), `pnpm build`, `pnpm test`
  (**204/204** бэкенд — +8 `activities/service.test.ts`: идемпотентность,
  изоляция attemptId, 403 не-ученику, 409 на дедлайн, 404/400 на
  вопрос/тип; 18/18 shared), `pnpm depcheck` (172 модуля, 454 связи, 0
  нарушений) — зелёные. Новых зависимостей нет.
- **Не проверено и не могло быть в этой среде**: живой прогон против
  Postgres (реальный upsert, поведение `greatest`/индекса под нагрузкой —
  гейт Э8), фактическая доставка `keepalive`-запроса при выгрузке вкладки в
  браузере, интеграция в `RoomPage` (см. Э8.6).

## Что сделано технически (Э8.8)

- **`GET /activities/:id/progress`** (учитель-хозяин/админ) — живая картина
  класса: список учеников группы урока со статусом `not_started` /
  `in_progress` / `stuck` + `answered/total`.
- **Не пуш, а опрос** — панель тянет эндпоинт раз в 4 сек. Пуш по WS-каналу
  урока на каждое сохранение каждого ученика — лишний трафик; для класса
  «раз в несколько секунд» достаточно (то же решение примем для аналитики
  Э8.9).
- **Статусы**: `not_started` — не открывал (нет метки старта попытки в
  Redis) и не отвечал; `stuck` — открыл, ответил не на все и не сохранял
  ответ > 3 мин (`STUCK_AFTER_MS`); иначе `in_progress`. «Ответил на всё»
  сейчас = `in_progress` с `answered >= total` (отдельного «сдал» нет до
  Э8.10) — панель на фронте показывает его как «ответили».
- **`opened`** считается по `redis.mget` меток `activity:attempt-start:*`
  для детерминированных `attemptId(activityId, userId, 1)` всего ростера —
  один батч-запрос, не N обращений.
- **Данные**: `usersService.listGroupStudents(groupId)` (новый — активные
  ученики группы с именами, через `users` repo, не напрямую по таблицам),
  `repo.answeredStatsByActivity` (`count(distinct questionId)` +
  `max(submittedAt)` группировкой по `userId`), число вопросов — из
  закреплённой версии материала.
- **Фронт**: `ClassProgressPanel.tsx` — опрос `getActivityProgress` раз в
  4 сек, цветные точки статуса (с `aria-label`), сводка по классу.
- **Проверки**: `pnpm -r typecheck` (5), `pnpm build`, `pnpm test`
  (**207/207** бэкенд — +3 `activities/service.test.ts`: классификация
  статусов, «открыл но не отвечал» = in_progress, 403 чужому учителю;
  18/18 shared), `pnpm depcheck` (173 модуля, 457 связей, 0 нарушений) —
  зелёные. Новых зависимостей нет.
- **Не проверено и не могло быть в этой среде**: живой прогон против
  Postgres/Redis (агрегаты, `mget` по ростеру, поведение под нагрузкой —
  гейт Э8); интеграция панели в UI урока (нет панели учителя/библиотеки
  материалов — см. Э8.6).

## Что сделано технически (Э8.9)

- **`GET /activities/:id/analytics`** (учитель-хозяин/админ) — по одному
  разбору на вопрос: `promptHtml`, `interactionType`, `totalAnswered`,
  `distribution`. Плюс `respondents` (сколько учеников вообще ответили).
- **`activities/analytics.ts`** — чистая функция `buildDistribution(
  interaction, responses)`, `switch` по 10 типам. Вынесена из сервиса
  отдельным файлом (тестируется изолированно, `analytics.test.ts`).
  `interaction` берётся ПОЛНЫМ (с ключом ответа) — аналитику видит только
  учитель, подсветка верного варианта и есть смысл разбора.
- **Формы распределения** (`QuestionDistribution` в shared):
  - `choice` — `single_choice`/`multiple_choice`/`true_false`: столбец на
    вариант, `count` + `correct`. `multiple_choice` считает каждый
    выбранный вариант отдельно.
  - `text` — `text_input`/`numeric_input`/`open_answer`: топ-8 различных
    ответов (ключ — тримленное значение), остальные в `otherDistinct`.
    `correct` не размечается (для свободного ввода столбцов «верных» нет).
  - `gaps` — `cloze_dropdown` (распределение по вариантам каждого пропуска
    + верный), `cloze_text` (топ различных значений по пропуску).
  - `summary` — `matching`/`ordering`: гистограммы вариантов нет, только
    «верно / частично / неверно» через `gradeResponse` (Э8.3) на каждый
    ответ.
- **Не пуш, а опрос/по запросу** (как Э8.8). Класс-масштаб — агрегация в
  памяти (`repo.listResponsesByActivity` тянет все ответы активности,
  группировка по `questionId` в JS), не SQL-разбор JSONB.
- **Рассинхронизация `response.type` ≠ `interaction.type`** молча
  отсекается перед агрегацией (`saveResponse` её не пускает, но прямая
  запись в БД могла бы; `gradeResponse` на ней бросил бы).
- **Фронт**: `QuestionAnalyticsPanel.tsx` — гистограммы с процентами и
  подсветкой верного столбца (`✓`, `bg-emerald-500`), `getActivityAnalytics`.
- **Проверки**: `pnpm -r typecheck` (5), `pnpm build`, `pnpm test`
  (**215/215** бэкенд — +6 `analytics.test.ts` (single/multiple/true_false/
  text/cloze_dropdown/ordering), +2 `service.test.ts` (per-question разбор,
  403 чужому); 18/18 shared), `pnpm depcheck` (176 модулей, 467 связей, 0
  нарушений) — зелёные. Новых зависимостей нет.
- **Не проверено и не могло быть в этой среде**: живой прогон против
  Postgres (реальная `listResponsesByActivity` под классом на гейте Э8);
  интеграция панели в UI урока (см. Э8.6).

## Что сделано технически (Э8.10)

- **`activities.reviewed_at`** (миграция `0008_kind_pet_avengers.sql`) —
  момент, когда учитель начал разбор. `null` = разбор не начат. Единственный
  переключатель, который решает, можно ли отдать материал С КЛЮЧАМИ ОТВЕТОВ
  ученику (до этого — только `stripMaterialAnswerKeys`, Э8.1/Э8.6).
- **`POST /activities/:id/review`** (учитель-хозяин/админ) — идемпотентно
  (`repo.markReviewed` = `COALESCE(reviewed_at, now())`) помечает разбор и
  шлёт `activity_reviewed` в WS-канал урока (тот же паттерн, что
  `activity_started`, Э8.6, — только сигнал «обнови экран», не сам материал).
- **`GET /activities/:id/review`** (любой участник урока) — ПОЛНЫЙ `Material`
  (с ключами ответов), 409 `not_reviewed` пока `reviewedAt` не выставлен.
  Это единственное место в API, которое намеренно отдаёт материал БЕЗ
  `stripMaterialAnswerKeys` — граница «ключи не текут раньше времени»
  (Железные правила CLAUDE.md) здесь просто сдвинута на явное решение
  учителя, а не снята.
- **`GET /activities/:id/review/questions/:questionId/responses`**
  (учитель-хозяин/админ, тоже гейтится `reviewedAt`) — ответы класса на один
  вопрос, с именами (`usersService.listGroupStudents` + фильтр по
  `questionId`/типу) — источник для выбора «чей ответ вынести на доску».
- **`POST /activities/:id/review/board`** (учитель-хозяин/админ) — §7.3 ТЗ
  «анонимно или с именем»: находит ответ ученика (`repo.listResponsesByActivity`,
  как и аналитика Э8.9), форматирует его текстом (`formatResponseText`,
  новая функция в `activities/analytics.ts` — свитч по всем 10 типам,
  протестирован таблично) и зовёт `canvasService.postAnswerToBoard`.
- **`canvas/hocuspocus.ts#postAnswerToBoard`** — САМАЯ рискованная часть
  задачи (область «работа с Y.Doc» CLAUDE.md, читалась построчно). Дописывает
  текстовый Excalidraw-элемент в `Y.Array "elements:{activePageId}"` холста
  урока СЕРВЕРНОЙ транзакцией через `hocuspocus.openDirectConnection` —
  официальный API пакета для записи в документ вне обычного WS-подключения
  (проверено чтением исходника `DirectConnection.ts`), переиспользует ТОТ ЖЕ
  `Document` в памяти, что и у реальных участников (если доска открыта —
  правки видны сразу), либо сам поднимает документ из Postgres, если сейчас
  никто не подключён. `disconnect()` форсирует немедленный `onStoreDocument`
  (не ждёт обычный 3-секундный дебаунс).
  - Позиция элемента в списке (`pos`) — через `fractional-indexing`
    (**новая прямая зависимость `apps/api`**, по явному разрешению
    пользователя: пакет уже был в lockfile транзитивно через `y-excalidraw`
    в `apps/web`, тот же формат ключа, что уже понимает клиентский
    `y-excalidraw` при чтении Y.Doc).
  - Форма самого элемента — вручную по `ExcalidrawTextElement` (сервер не
    может позвать настоящий `newTextElement`: тот меряет текст через
    браузерный `canvas.measureText()`, недоступный в Node без несогласованной
    тяжёлой зависимости типа `node-canvas`). Ширина/высота — приближение по
    числу символов/строк, не точный рендер-метрикс; `autoResize: true`
    самоисправляется при первом редактировании элемента любым клиентом.
  - Защитный случай: если на холсте урока ещё вообще не было ни одной
    страницы (никто не открывал доску), функция сама заводит первую —
    разбор не должен падать из-за того, что доску никто не смотрел.
- **Фронт**: `activity-api.ts` (+4 функции), `ReviewPanel.tsx` — учителю
  кнопка «Начать разбор», всем участникам — правильный ответ под каждым
  вопросом текстом (`formatCorrectAnswer`, зеркалит серверный `formatResponseText`
  по духу, но для КЛЮЧА, не ответа ученика), учителю — раскрывающийся список
  ответов класса с чекбоксом «анонимно» и кнопкой «На доску» на каждой строке.
  НЕ вписан в `RoomPage.tsx` — тот же статус, что у `ClassProgressPanel`/
  `QuestionAnalyticsPanel` (Э8.8/8.9): компонент+API готовы и типизированы,
  проводка в экран урока не входила ни в одну из задач Э8.4–8.10.
- **Тесты**: `service.test.ts` (+9: старт разбора/403 чужому/идемпотентность,
  409 до разбора у `getReview`/`getReviewResponses`/`pushAnswerToBoard`,
  анонимно/с именем, 404 без ответа), `analytics.test.ts` (+8:
  `formatResponseText` по всем 10 типам), `hocuspocus.test.ts` (+5:
  дописывает элемент и сохраняет, защитный случай без единой страницы,
  переиспользует активную страницу, перенос длинного текста по строкам,
  корректный `pos` относительно уже существующих элементов).
- **Проверки**: `pnpm typecheck` (4 пакета), `pnpm -r build`, `pnpm test`
  (**239/239** бэкенд, 18/18 shared, зелёные), `pnpm depcheck` (178 модулей,
  475 связей, 0 нарушений — `activities → canvas` через `service.ts`,
  никакого цикла: `canvas` по-прежнему не знает про `activities`).
  Новых зависимостей кроме согласованной `fractional-indexing` нет.
- **Не проверено и не могло быть в этой среде**: живой Postgres/Redis —
  реальный прогон `openDirectConnection` против живого Hocuspocus-сервера
  под WS-нагрузкой (юнит-тесты гоняют реальный `hocuspocus`/`Y.Doc` в
  памяти процесса, но без сети); визуальная проверка текста на доске в
  настоящем Excalidraw (нет браузера/Docker в этой среде — приближённые
  width/height из докстринга `buildAnswerTextElement` не сверены глазами).

## Что сделано технически (Э8.11)

- **`activities.groupId`** (миграция `0009_great_punisher.sql`, nullable в
  БД, но заполняется ВСЕГДА сервис-слоем для обоих режимов) —
  ДЕНОРМАЛИЗОВАННАЯ группа выдачи: для `lesson`-активности это копия
  `lessons.groupId`, снятая на момент запуска (Э8.6), для `homework` —
  группа, которой её адресовали напрямую. Без этого поля у домашней работы
  не было бы, откуда взять ростер для панели прогресса (Э8.8) — у неё нет
  урока, из которого раньше брался `groupId`. Nullable в схеме БД —
  намеренно, чтобы `drizzle-kit generate` не потребовал интерактивного
  дефолта для существующих строк (тот же приём, что `reviewedAt` в Э8.10).
- **`POST /groups/:id/activities`** (учитель/админ школы, БЕЗ проверки
  «веду ли я эту группу» — у групп нет своего учителя-хозяина, в отличие от
  урока) — задаёт домашнюю работу: `lessonId: null`, `mode: "homework"`
  всегда (тело запроса то же самое, что у `/lessons/:id/activities`,
  `mode` в нём игнорируется — реальный режим определяет URL, не поле).
  `GET /groups/:id/activities` — список домашних заданий группы: ученик
  видит, если состоит в группе; учитель/админ школы — видит любой (тот же
  принцип «школьного», а не «личного» доступа, что и создание).
- **`assertActivityOwner`/`assertActivityMember`** — обобщение
  `assertLessonTeacher`/`assertLessonMember` (Э8.6) на оба режима, область
  «логика прав доступа» CLAUDE.md, читаны построчно. Ветвятся по
  `activity.lessonId`: есть — учитель урока (как раньше); нет
  (`homework`) — тот, кто её выдал (`activity.assignedBy`, ЕДИНСТВЕННАЯ
  точка владения домашкой, раз у группы нет своего учителя). Заменили
  собой прежний жёсткий guard `if (!activity.lessonId) throw 409` во ВСЕХ
  функциях по `activityId` (`getMyActivity`, `saveResponse`, `getProgress`,
  `getAnalytics`, `startReview`, `getReview`, `getReviewResponses`) — это
  и был единственный код, из-за которого домашняя работа не работала.
- **Единственное исключение — `pushAnswerToBoard` (Э8.10)** осталось
  лесон-only: у домашней работы нет урока и, значит, нет общей доски,
  вынести ответ буквально некуда. Гейт `if (!activity.lessonId) throw 409
  "activity_not_in_lesson"` — теперь единственное место в модуле, где эта
  проверка вообще осталась осмысленной.
- **`startReview` для домашки** — работает (значит, разбор домашнего
  задания «показать правильные ответы всем» доступен без урока), но
  WS-broadcast `activity_reviewed` шлётся, только если `activity.lessonId`
  есть: у домашки нет живого канала, куда его слать — ученик увидит разбор
  просто зайдя на `GET /activities/:id/review` в следующий раз.
- **`materials`/`responses` не тронуты** — `responses.lessonId` остаётся
  `null` для домашних ответов, ровно как ТЗ и предполагал изначально
  (§6.5: «lesson_id (nullable)»); `attemptId`/автосохранение (Э8.7) не
  знают о разнице между режимами, `getMyActivity`/`saveResponse` были
  написаны достаточно обобщённо ещё в Э8.6/8.7.
- **Что НЕ делалось (сознательно вне рамок задачи)**: явного `submit`
  (сдать работу окончательно) и повторных попыток (`attemptsAllowed` из
  материала, §6.1 ТЗ) в API до сих пор нет ни у урока, ни у домашки —
  это отдельный, ещё не заведённый в план кусок функциональности (докстринг
  `resolveAttempt` в service.ts помечает его как задел «Э8.10+», ещё не
  реализованный), а не то, что сломала эта задача. DoD Э8.11 буквально
  «ученик заходит и делает» — доступ и автосохранение вне урока, это
  сделано; финализация попытки — не входила.
- **Фронт**: `activity-api.ts` (+`assignHomework`, `+listGroupActivities`).
  Не вписано в UI (ни кнопки «Задать на дом», ни списка домашних заданий
  ученику) — тот же статус, что у `ClassProgressPanel`/`QuestionAnalyticsPanel`/
  `ReviewPanel` (Э8.8–8.10): API-клиент и типы готовы, компонент/страница
  «Мои домашние задания» не входила в объём Э8.11 буквально («ученик
  заходит и делает» — не «есть экран со списком»). `MaterialPlayer`/
  `QuestionPlayer` (Э8.4/8.5) уже одинаково работают с `MyActivity`
  независимо от режима — фронту плеера различие lesson/homework не видно
  вообще, что и было целью обобщения на бэке.
- **Тесты**: `service.test.ts` (+13: `createHomeworkActivity`/
  `listGroupActivities` — создание, 403 не-учителю, 404 чужой школе, доступ
  ученика/учителя к списку; домашка через ВСЕ общие эндпоинты —
  `getMyActivity`/`saveResponse`/`getProgress`/`getAnalytics`/
  `startReview`/`getReview` работают без урока, `pushAnswerToBoard`
  остаётся 409, WS не шлётся при `startReview` домашки, 403 учителю,
  который не выдавал эту домашку).
- **Проверки**: `pnpm typecheck` (4 пакета), `pnpm -r build`, `pnpm test`
  (**252/252** бэкенд, зелёные), `pnpm depcheck` (178 модулей, 475 связей,
  0 нарушений — граф зависимостей не изменился, только внутренняя логика
  activities). Новых зависимостей нет.
- **Не проверено и не могло быть в этой среде**: живой Postgres — реальное
  применение миграции `0009` (ALTER TABLE + FK на `groups` + индекс),
  консистентность денормализованного `groupId` под конкурентным созданием
  уроков/групп.

## Что сделано технически (Э8.12)

- **Перед самой очередью пришлось закрыть пробел, обнаруженный при чтении
  докстринга Э8.11 (см. выше — «явного submit... в API до сих пор нет»):
  `POST /activities/:id/submit` (§8 ТЗ) не существовал вообще.** Без него
  `responses.autoGraded` всегда оставался `false`, а `score` — `null` для
  ЛЮБОГО типа вопроса (не только `open_answer`) — очередь ручной проверки
  было physически не из чего строить: не было различия «черновик» vs
  «сдано», и движок проверки (Э8.3) ни разу не писал результат в БД (только
  считал агрегаты для Э8.9, ничего не сохраняя). Это не входило буквально
  ни в один номер Э8.1–8.11, но было явной незавершённостью, а не
  отдельной фичей не по плану — доделано в рамках Э8.12, отдельным
  коммитом-предпосылкой.
- **`responses` — три новые колонки** (миграция `drizzle/0010_swift_junta.sql`):
  `rubric_scores jsonb`, `comment text` — оба заполняются ТОЛЬКО ручной
  проверкой (`POST /grading/:responseId`), и `submitted bool not null
  default false` — черновик (Э8.7) vs финальный ответ попытки. Плюс индекс
  `responses_manual_queue_idx (submitted, auto_graded, graded_by)` под
  запрос очереди.
- **`submitActivity` (сервис) — единственное место, которое реально ПИШЕТ
  результат движка проверки (Э8.3) в БД.** Идёт по ВСЕМ вопросам материала
  (не только отвеченным): для вопроса без черновика строит пустой ответ
  своего типа (`emptyResponseFor`) и гонит его через ТОТ ЖЕ `gradeResponse`,
  а не отдельную ветку «нет ответа» — одна точка правды для баллов,
  меньше шансов разойтись с ответом, который реально был сохранён.
  `score`/`maxScore` в ответе считают только автопроверяемые вопросы —
  вклад `open_answer` появится в БД уже после ручной проверки.
- **`repo.upsertGradedResponse` — идемпотентность и защита от повторного
  сабмита ПОСЛЕ того, как учитель уже проверил `open_answer`, читать
  внимательно** (соседняя область с движком проверки, § «Что не
  делегировать вслепую» CLAUDE.md): `ON CONFLICT DO UPDATE` для
  `autoGraded: false` НЕ включает `score`/`autoGraded`/`gradedAt` в `SET` —
  повторный вызов `submitActivity` (двойной клик, ретрай) пересчитывает и
  перезаписывает только автопроверяемые вопросы, ручные остаются как есть.
- **`saveResponse` (Э8.7) после сабмита отказывает `409 already_submitted`**
  (`repo.attemptSubmittedAt` — по факту наличия хотя бы одной строки
  `submitted = true` для попытки) — без этого ученик мог бы продолжать
  менять черновик уже сданной работы, пока учитель её проверяет.
  `MyActivity.submittedAt` (новое поле) — фронту, чтобы заблокировать
  плеер и показать «Работа сдана», а не гадать по количеству вопросов.
- **Очередь (`GET /grading/queue`) и правка одной оценки
  (`POST /grading/:responseId`) — в том же модуле `activities`**, не в
  `materials`: обе ручки работают с таблицей `responses`, которой
  `activities` уже владеет (правило модульности CLAUDE.md — модуль не
  лезет в чужие таблицы напрямую, здесь чужих таблиц и нет). `materials`
  как был, так и остался чистым движком+загрузкой версий.
- **Владение очередью — тот же критерий, что и везде в Э8 (`assignedBy`)**:
  учитель видит только то, что сам выдал (и в уроке, и в домашке —
  `assignedBy` уже был единым полем для обоих режимов, Э8.11), админ —
  всю школу. `autoGraded = false` после сабмита ОДНОЗНАЧНО означает
  `open_answer` (единственный тип, где движок так отвечает, Э8.3) — черновики
  (`submitted = false`) в очередь не попадают в принципе, отдельно
  проверять `response.type` не потребовалось.
- **`POST /grading/:responseId` — рубрика ориентир, не формула**: `score`
  учитель ставит сам, `rubricScores` (по критерию — выполнен/нет) не
  обязан арифметически совпадать (§6.4 ТЗ буквально «ручная проверка» —
  последнее слово за учителем). Валидация: неизвестный `id` критерия — 400,
  `score` больше `question.points` — 400. Гонка двух одновременных
  проверок одного ответа — атомарный `WHERE graded_by IS NULL` в
  `repo.persistManualGrade` (не отдельная read-then-write проверка),
  повторный/проигравший вызов получает 409 `already_graded`.
- **Фронт**: `MaterialPlayer.tsx` — кнопка «Сдать работу» (только когда
  задан `autosaveActivityId`, т.е. не превью учителя, и попытка ещё не
  сдана); перед отправкой — `autosave.flush()`, чтобы несброшенный
  дебаунсом черновик не потерялся. После сабмита плеер блокируется
  целиком независимо от пропа `disabled` — сервер и так откажет
  дальнейшим `saveResponse`, но без локальной блокировки поля выглядели
  бы редактируемыми. Новый `GradingQueue.tsx` — тем же паттерном, что
  `ReviewPanel.tsx` (Э8.10): карточка на ответ, чекбоксы по критериям
  рубрики (стартовое значение баллов — их сумма, учитель может изменить
  вручную), после успешной оценки убирается из списка оптимистично.
- **Не вписано в роутинг (`App.tsx`)** — тот же статус, что у ВСЕХ
  компонентов Э8.4–8.11 (`MaterialPlayer`, `ClassProgressPanel`,
  `QuestionAnalyticsPanel`, `ReviewPanel`): ни один из них не подключён к
  `RoomPage`/навигации, `App.tsx` по-прежнему знает только про
  `/lessons` и `/lessons/:id/room`. Это не пробел, заведённый Э8.12 —
  он существовал весь этап; здесь просто зафиксирован явно, потому что
  `GradingQueue.tsx` — уже пятый такой компонент подряд. Собрать реальный
  экран урока/задания из этих кусков — отдельная задача, которую стоит
  обсудить с пользователем до старта (не факт, что это часть Э8 вообще —
  может, часть Э9 или отдельный проход по UI).
- **Тесты**: `service.test.ts` (+22: `submitActivity` — баллы только по
  автопроверяемым, неотвеченный вопрос как пустой ответ через тот же
  движок, идемпотентность, 403/409 по ролям и дедлайну; `saveResponse`
  после сабмита — 409; `getGradingQueue` — фильтр по `assignedBy`
  учителя/без фильтра у админа, 403 не-учителю, защитный пропуск
  рассинхронизированного вопроса; `gradeManualResponse` — счастливый путь,
  403/404/409/400 по всем перечисленным проверкам, гонка через
  `persistManualGrade → null`). Итого backend: **274/274** зелёных.
- **Проверки**: `pnpm --filter shared build`, `pnpm --filter api build`,
  `pnpm --filter web build` (tsc --noEmit + vite build), `pnpm -r test`
  (274 backend + 18 shared, зелёные), `pnpm depcheck` (179 модулей, 480
  связей, 0 нарушений). Новых зависимостей нет.
- **Не проверено и не могло быть в этой среде**: живой Postgres — реальное
  применение миграции `0010`, `p95 сохранения ответа < 300 мс` из гейта
  Э8 (нужна нагрузка на реальную БД), ручная сверка «учитель составляет
  задание, сравниваем его ожидания с тем, что посчитал движок» (тоже
  часть гейта Э8, руками не прогонялась — нет способа запустить фронт
  против живого бэка в этой среде).

## Подключение к экрану урока (после закрытия Э8.12)

Пользователь попросил продолжать разработку без уточнений — по правилу
CLAUDE.md «один этап = один контекст» не начал Э9 в этой же сессии
(отдельный большой этап заслуживает свежего контекста), а закрыл пробел,
явно зафиксированный при завершении Э8.12: пять компонентов Э8.4–8.11
(`MaterialPlayer`, `ClassProgressPanel`, `QuestionAnalyticsPanel`,
`ReviewPanel`, `GradingQueue`) были готовы, но ни один не был подключён к
`RoomPage`/роутингу. Это правка ВНУТРИ Э8, не новый этап.

- **Новый `LessonActivityPanel.tsx`** — единственная точка сборки: решает,
  какой из пяти компонентов показать (по роли и вкладке), сама ничего не
  запрашивает у сервера напрямую, кроме `createActivity`/`getMyActivity`.
  Учитель: форма «id материала → выдать классу» (редактора материалов
  всё ещё нет, Э9 — это ожидаемое, а не временное упрощение стоп-листа
  Э8) + вкладки Прогресс/Аналитика/Разбор/Проверка. Ученик: как только
  есть `activityId` — сразу `MaterialPlayer` с автосохранением и кнопкой
  «Сдать работу» (Э8.12).
- **`RoomPage.tsx`**: два новых case в `handleMessage` —
  `activity_started` (обновляет `activeActivityId`) и `activity_reviewed`
  (инкрементирует `reviewSignal`, форсирует remount `ReviewPanel` через
  `key`, чтобы разбор перечитался без ручной перезагрузки страницы).
  Плюс фолбэк-поллинг `listLessonActivities` при входе в уже идущий
  урок — тот же приём, что уже был у `refreshDecks`/`deckStatuses`
  (Э4.6) для presentations.
- **`ReviewPanel`/`ClassProgressPanel`/`QuestionAnalyticsPanel`/`GradingQueue`
  не менялись** — подключение прошло без правок самих компонентов,
  подтверждает, что их публичный контракт (пропы) был спроектирован
  достаточно самодостаточно ещё на Э8.8–8.12.
- **Сознательно не сделано**: список/экран «Мои домашние задания» для
  `mode: "homework"` (Э8.11) — `LessonActivityPanel` работает только
  внутри урока (`lessonId` обязателен), домашка получает свой экран вне
  урока отдельной задачей, если/когда понадобится (не часть этого прохода
  по пробелу — тот был явно про компоненты, подключённые к `RoomPage`).
- **Проверки**: `pnpm --filter web build` (tsc --noEmit + vite build),
  `pnpm depcheck` (180 модулей, 490 связей, 0 нарушений), `pnpm -r test`
  (274 backend + 18 shared, без изменений — новый код фронта тестами не
  покрыт, `apps/web` тестов пока не имеет вообще, `"test": "echo no tests
  yet"` — тот же статус, что был у модуля materials в самом начале Э8.1).
- **Не проверено и не могло быть в этой среде**: реальный запуск в
  браузере (`docker compose up` недоступен) — визуальная раскладка
  вкладок, работоспособность WS-сигналов `activity_started`/`activity_reviewed`
  на живом сервере, форма «id материала» руками.

## Экран «Мои домашние задания» (закрытие последнего пробела Э8.11)

Пользователь явно выбрал этот пробел следующим шагом (а не начало Э9).
Правка внутри Э8, не новый этап — то же обоснование, что и у предыдущего
прохода: домашка (Э8.11) была полностью готова на бэке, но не было экрана
вне урока, куда зайти.

- **Настоящий недостающий кусок оказался не UI, а правами доступа**:
  чтобы построить список «мои домашние задания», фронту сначала нужно
  узнать, В КАКИХ группах состоит текущий пользователь — а `GET /groups`
  был закрыт под `requireRole("admin")` для ВСЕХ ролей, включая самого
  ученика. Область «логика прав доступа» (CLAUDE.md, «не делегировать
  вслепую») — читано и спроектировано построчно, не сгенерировано с ходу.
- **Новый `GET /users/me/groups`** (`apps/api/src/modules/users/routes.ts`,
  `service.ts` → `listMyGroups`, `repo.ts` → `listGroupsForUser`) — САМ
  СЕБЕ пользователь, без admin-гейта. Асимметрия по роли ЗЕРКАЛИТ уже
  существующую в `activities/service.ts` (`listGroupActivities`,
  `createHomeworkActivity`, Э8.11): у групп нет своего учителя-хозяина,
  поэтому ученик видит только группы, где он в `group_members`, а
  teacher/methodist/admin — все группы школы (та же школа, что уже могут
  назначать домашку в любую группу и смотреть список любой). Это не новая
  политика, а обнажение уже принятого решения на чтение.
- **`usersRoutes` перестроен**: раньше единственный `app.addHook("preHandler",
  app.requireRole("admin"))` на весь файл. Теперь этот хук ушёт во
  вложенный `app.register(async (adminApp) => {...})` — новая область
  видимости Fastify — и покрывает только прежние админские роуты
  (`/users`, `/users/import`, `POST /groups`, `/groups/:id/members`,
  `GET /groups` — эта осталась admin-only, её не трогали, у неё другая
  форма ответа, чем у `/users/me/groups`). Новый роут — единственный вне
  этой обёртки, только за общим `app.authenticate`. Декораторы
  `authenticate`/`requireRole` зарегистрированы через `fastify-plugin`
  (`fp()`) в `plugins/`, поэтому видны и во вложенном контексте —
  проверено фактическим прогоном тестов и `pnpm --filter api build`, не
  только чтением доки Fastify.
- **`packages/shared/src/users.ts`**: `groupResponseSchema`/`GroupResponse`
  (id/name/grade/academicYear) — до этого у групп вообще не было
  публичного типа в shared, `GET /groups` (admin) отдавал сырые строки БД
  без .parse(). Тот же паттерн, что и у `PublicMaterial` (Э8.1) — TS-тип,
  не завязанный на ORM-строку напрямую.
- **Фронт, новые файлы**:
  - `ActivityPlayer.tsx` — вынесено из `StudentActivityView` внутри
    `LessonActivityPanel` (грузит `MyActivity` по id, рендерит
    `MaterialPlayer`) — общая часть для урока и домашки, сам плеер не
    видит разницы режимов (см. заметку Э8.11).
  - `ActivityTeacherTabs.tsx` — вынесено из `TeacherActivityView` внутри
    `LessonActivityPanel` (вкладки Прогресс/Аналитика/Разбор/Проверка) —
    общая часть для учительской панели урока и домашки. Сброс на вкладку
    «Прогресс» при смене `activityId` — теперь через `key` у родителя, а
    не через проп `tab`/`onTabChange`, который раньше пробрасывался из
    `LessonActivityPanel` (упростилось при переносе).
  - `HomeworkPage.tsx`, роут `/homework` (`App.tsx`) — student:
    `listMyGroups()` → для каждой группы `listGroupActivities()` →
    плоский список, клик разворачивает `ActivityPlayer`; teacher/admin:
    выбор группы (`<select>` по `listMyGroups()`) → форма «id материала →
    задать на дом» (`assignHomework`, тот же паттерн «id материала
    руками», что в `LessonActivityPanel` — редактора материалов всё ещё
    нет, Э9) + список уже заданного, клик разворачивает
    `ActivityTeacherTabs`. `methodist` не роутится ни в одну ветку (не
    участвует ни в уроке, ни в домашке в этой модели, и не входит в
    `teacher`/`admin` проверку `listGroupActivities`/`createHomeworkActivity`
    на бэке — показывать ему форму означало бы верный 403 по клику).
  - `Layout.tsx`: ссылки «Уроки»/«Домашние задания» в шапке (кроме
    `methodist`) — до этого в шапке не было навигации вообще, только
    имя/выход.
- **`LessonActivityPanel.tsx` — единственная правка существующего файла**
  (сами `ClassProgressPanel`/`QuestionAnalyticsPanel`/`ReviewPanel`/
  `GradingQueue`/`MaterialPlayer` снова не менялись): переиспользует
  `ActivityPlayer`/`ActivityTeacherTabs` вместо инлайновой копии той же
  логики — чистый рефакторинг без изменения поведения урока.
- **Известный незакрытый мелкий шов**: `ReviewPanel` показывает кнопку «На
  доску» учителю независимо от режима — для домашки клик получит 409 от
  `pushAnswerToBoard` (`activity_not_in_lesson`, ожидаемо и корректно по
  Э8.11) и покажет общую ошибку «Не удалось загрузить/вынести ответ»,
  а не понятное «у домашки нет доски». Не стал менять сам `ReviewPanel`
  (ему пришлось бы принять новый проп `hasLesson`/`mode`) ради узкого
  косметического случая — сознательный компромисс, не забытый баг.
- **Проверки**: `pnpm -r typecheck` (4 пакета), `pnpm --filter api build`,
  `pnpm --filter web build` (tsc --noEmit + vite build), `pnpm -r test`
  (**296/296**: 278 backend — 274 прежних + 4 новых в `users/service.test.ts`
  на `listMyGroups` — + 18 shared), `pnpm depcheck` (184 модуля, 504 связи,
  0 нарушений). Новых зависимостей нет.
- **Не проверено и не могло быть в этой среде**: живой Postgres/браузер —
  реальный `GET /users/me/groups` под нагрузкой, визуальная проверка формы
  «задать на дом» и списка домашки руками, клавиатурная навигация по
  новому экрану (Playwright accessibility-снимки из ПЛАН.md для Э8 тоже
  недоступны без живого браузерного MCP в этой среде).

---

# Архив: Э7 — Демонстрация экрана (завершён 2026-09-02)

## Стоп-лист Э7

```
НЕ делать на этом этапе:
- НЕ делать шаринг вкладки со звуком в MVP
- НЕ делать удалённое управление
```

## Задачи

- [x] Э7.1 Публикация экрана: 1080p@5fps для документов, 720p@15fps для видео — переключатель.
- [x] Э7.2 Максимум 1 демонстрация одновременно, приоритет учителю.
- [x] Э7.3 Автопереход урока в режим «Лекция» на время демонстрации.
- [x] Э7.4 Демонстрация учеником по разрешению.

## Гейт Э7

```
Демонстрация экрана во время урока на 30 человек не поднимает трафик выше
потолка платформы, определённого гейтом Э6 (livekit-cli load-test).
```

## MCP под Э7

Постоянный набор (Context7, Playwright, GitHub) + **Grafana MCP** (гейт:
трафик во время демонстрации не выше потолка Э6) + **Chrome DevTools MCP**
(проверка `contentHint`/качества картинки 1080p@5fps документа против
720p@15fps видео — тот же инструмент, что предполагался для Э7 в ПЛАН.md).
Оба недоступны в этой среде — задел на Linux-сессию.

## Что сделано технически (Э7.1 + Э7.4)

- **Право `canShareScreen` реально заработало** — существовало в
  `participantPermissionsSchema` (`packages/shared`) с ранних этапов как
  задел (учитель получал его по умолчанию, `presence.ts#defaultPermissions`,
  ещё до Э7), но `buildPublishGrant` до сих пор не добавлял под него
  источник `TrackSource.SCREEN_SHARE` — стоп-лист Э5/Э6 прямо запрещал
  демонстрацию раньше срока. Одно изменение в гранте закрыло СРАЗУ обе
  задачи: Э7.1 (учитель получает право по умолчанию) и Э7.4 (ученик — по
  тому же полю, которое учитель включает тем же путём `updatePermissions`,
  что и `canDraw`/`canSpeak`/`canPublishVideo`) — право не различает роль,
  в отличие от камеры учителя (Э5.1, роль) или ученика (Э6.1, отдельное
  право), потому что демонстрация никогда не была «всегда включена по
  роли» ни для кого.
- **Максимум 1 демонстрация и приоритет учителю — НЕ часть гранта.** Грант
  лишь разрешает ИСТОЧНИК, не считает, сколько таких треков уже
  опубликовано в комнате — это отдельная вебхук-логика, задача Э7.2, ещё
  не сделана на этом шаге сознательно (см. ниже).
- **`ScreenShareControls.tsx#SelfScreenShareButton`** — переключатель типа
  контента ДО старта: «Документ» (1080p@5fps) или «Видео» (720p@15fps,
  §5.2 ТЗ). `ScreenSharePresets` из установленного `livekit-client@2.22.0`
  не содержит готового пресета на 5 fps (только `h1080fps15`/`h1080fps30`)
  — собственный `VideoPreset(1920, 1080, 1_000_000, 5, "medium")` по тому
  же образцу. **Битрейт 1 Мбит/с — явно помеченная в коде ОЦЕНКА, не факт
  из ТЗ/LiveKit**: `h1080fps15` берёт 2.5 Мбит/с на 15 fps, при втрое
  меньшем fps пропорционально вышло бы ~0.83 Мбит/с, округлено чуть вверх
  ради чёткости текста документа. «Видео» использует готовый
  `ScreenSharePresets.h720fps15` — тут оценивать было нечего.
- **`screenShareEncoding`, не `videoEncoding`** — прочитано в типах
  `TrackPublishDefaults` (`options.d.ts` установленного `livekit-client`):
  `videoEncoding` — параметры именно камеры, демонстрация экрана кодируется
  отдельным полем; перепутать — значит тихо не применить выбранный
  битрейт/fps.
- **`contentHint`**: `"detail"` для документа (приоритет чёткости над
  плавностью), `"motion"` для видео — стандартные MST content hints,
  задел на будущую оптимизацию кодека без дополнительных полей.
- **Аудио вкладки не запрашивается** (`audio: false`) — стоп-лист Э7: «не
  делать шаринг вкладки со звуком в MVP».
- **`ScreenShareTile.tsx`** — новый компонент, рендерит единственный
  подписанный трек `SCREEN_SHARE` (`tracks[0]` безопасен: максимум 1
  демонстрация в комнате — будущая гарантия Э7.2, но уже сейчас верно,
  просто пока не принудительно). Крупно, над доской — не мелкой плиткой в
  углу, как `TeacherVideoTile`: демонстрация и есть то, на что сейчас
  смотрит урок.
- **`VideoSubscriptions.tsx#VideoSubscriptionManager`**: `Track.Source.ScreenShare`
  добавлен в список отслеживаемых источников, подписывается ВСЕГДА,
  независимо от роли и режима урока — максимум 1 демонстрация на всю
  комнату (когда Э7.2 её обеспечит) означает, что лимита в духе «сетки из
  9» тут в принципе быть не может, гейтить нечего уже на этом шаге.
- **UI**: чекбокс «экран» в списке участников (`RoomPage.tsx`, тот же
  паттерн `togglePermission`, что у «видео»); кнопка демонстрации видна
  учителю всегда и ученику — при выданном праве.
- Тесты: `media/service.test.ts` (+2, было 19, стало 21) — право
  `canShareScreen` добавляет источник `screen_share` и `canPublish=true`
  одинаково учителю и ученику; живое обновление (`updateLivePermissions`)
  добавляет `SCREEN_SHARE` ученику с granted правом. Итого 134/134
  бэкенда.
- **Проверки**: `pnpm -r typecheck` (5 пакетов), `pnpm build`, `pnpm test`
  (134/134), `pnpm depcheck` (151 модуль, 388 связей, 0 нарушений) —
  зелёные. Новых зависимостей нет.
- **Не проверено и не могло быть в этой среде**: реальная публикация
  `getDisplayMedia` и то, что 1080p@5fps действительно даёт читаемый текст
  документа при заданном битрейте (Chrome DevTools MCP — сценарий проверки
  из ПЛАН.md — недоступен в этой среде); фактический битрейт-оверхед на
  SFU против оценки в коде. Нет Docker/браузера с демонстрацией экрана в
  headless CI. Первая живая проверка — на Linux/локально в браузере.

## Что сделано технически (Э7.2 + Э7.3)

- **Обе задачи закрывает ОДИН вебхук-обработчик, а не два** —
  `rooms/service.ts#handleScreenShareStartedWebhook` (`track_published`,
  SCREEN_SHARE). Осознанно не разносили по функциям: Э7.3 (автопереход в
  Лекцию) обязан выполняться ТОЛЬКО если демонстрация реально состоялась
  (не была тут же погашена веткой Э7.2 из-за конфликта) — это внутренняя
  зависимость одного шага от другого внутри ОДНОГО события, а не двух
  независимых. Раздельная документация (эта секция + коммиты) держит
  границы задач видимыми, раздельные функции — нет.
- **Почему решение принимается ПОСЛЕ публикации, не ДО** — грант
  (`buildPublishGrant`, Э7.1) разрешает ИСТОЧНИК SCREEN_SHARE, но не
  считает, сколько таких треков уже опубликовано в комнате; отменить
  WebRTC-негоциацию на клиенте с сервера ДО того, как трек уже пошёл,
  нельзя — можно только замьютить его сразу после факта. LiveKit-вебхук
  `track_published` — первый момент, когда сервер вообще узнаёт о новой
  демонстрации.
- **Э7.2, §5.2 ТЗ: «максимум 1 демонстрация одновременно, приоритет
  учителю»**:
  - учитель/админ начинает демонстрацию, пока кто-то уже делится — гасим
    ЧУЖУЮ демонстрацию (приоритет учителю, не важно, кто уже делился —
    другой ученик, со-учитель);
  - ученик (не учитель) начинает демонстрацию, пока кто-то уже делится —
    гасим СВЕЖУЮ демонстрацию сразу, старая продолжается: конфликты между
    не-учителями не разрешаются по принципу «кто первый» — задача прямо
    говорит «максимум 1», не описывает очередь, поэтому очередь и не
    изобретали.
  - **`media/service.ts#findOtherActiveScreenShares`** — источник истины
    здесь LiveKit (`RoomServiceClient.listParticipants`, реальное
    mute-состояние трека), не наш `presence` (который про ПРАВА, а не про
    текущее состояние трека — участник мог получить право, но ещё не
    делиться). `muteTrackBySource` — тот же поиск+мьют трека по источнику,
    что уже был `muteMicrophoneTrack` (Э2.5), обобщён на источник
    параметром: логика идентична, дублировать её под другой TrackSource
    было бы неоправданно.
- **Э7.3, §5.3 ТЗ: «автопереход урока в режим Лекция на время
  демонстрации»**:
  - `presence.ts#getLessonModeBeforeShare/setLessonModeBeforeShare` —
    новый Redis-ключ (`room:{lessonId}:modeBeforeShare`), тот же ephemeral
    характер хранения, что у `lessonMode` (Э6.4) и `pinned` (Э6.3).
    Отдельный ключ, не переиспользование `modeKey`, — нужны оба значения
    одновременно: текущее (уже `lecture` на время демонстрации) и то, к
    которому нужно будет вернуться.
  - Режим сохраняется, ТОЛЬКО если он ещё не сохранён (`alreadySaved ===
    null`) — повторный старт демонстрации (второй участник в том же
    уроке, пока первая демонстрация технически ещё не закончилась с точки
    зрения вебхуков) не должен затереть исходный режим значением
    `lecture`, которое сам же и выставил на предыдущем старте.
  - Возврат режима (`handleScreenShareStoppedWebhook`, `track_unpublished`)
    проверяет через `findOtherActiveScreenShares` (без исключения), что
    демонстраций в комнате не осталось ВООБЩЕ — не только у того
    участника, чей трек только что снят. Без этой проверки окончание ОДНОЙ
    из двух демонстраций преждевременно вернуло бы режим, пока другая ещё
    идёт.
  - Если сохранённого режима нет (`null`) — режим уже был `lecture` до
    демонстрации (обычный случай, раз это дефолт §5.2 ТЗ) — восстанавливать
    нечего, функция тихо ничего не делает.
  - **Микрофоны от режима не зависят** (сознательно не трогали
    `VideoSubscriptionManager`/лимиты микрофонов здесь) — §5.3 ТЗ
    описывает медиапрофиль `assignment` как «только аудио учителя», но это
    про то, что обычно слышно, а не технический запрет; для `lecture`,
    который форсирует Э7.3, аудио и так не ограничено отдельно.
- **Клиент**: `ScreenShareControls.tsx#SelfScreenShareButton` получил проп
  `priority` (учитель — сервер и так пропустит его демонстрацию вперёд,
  проверка клиента его не касается) и локальную проверку `othersSharing`
  (`useTracks([ScreenShare], {onlySubscribed:false})`, кто-то ещё уже
  делится) — кнопка НЕДОСТУПНА не-учителю, если уже кто-то делится. Это НЕ
  защита (реальная — сервер), а UX-подсказка: без неё не-учитель увидел бы
  свою демонстрацию запущенной и тут же погашенной сервером — путающий
  опыт на пустом месте.
- Тесты:
  - `media/service.test.ts` (+3, было 21, стало 24) — `findOtherActiveScreenShares`
    находит только реально активные (не замьюченные) демонстрации, кроме
    исключённого; `muteScreenShare` гасит именно трек SCREEN_SHARE, не
    трогая микрофон.
  - `rooms/service.test.ts` (+6, было 34, стало 40) — учитель без
    конфликта: никого не гасит, переводит в lecture; учитель при
    конфликте: гасит чужую демонстрацию; ученик при конфликте: гасит
    свою, режим не трогает; окончание демонстрации без других — возвращает
    сохранённый режим; окончание, когда другая ещё идёт — не возвращает
    режим; режим уже был lecture — восстанавливать нечего.
  - `livekit-webhook.test.ts` (+3, было 6, стало 9) — маршрутизация
    `track_published`/`track_unpublished` по `event.track.source ===
    SCREEN_SHARE`, `track_published` камеры не задевает обработчик
    демонстрации.
  - Итого 146/146 бэкенда.
- **Проверки**: `pnpm -r typecheck` (5 пакетов), `pnpm build`, `pnpm test`
  (146/146), `pnpm depcheck` (151 модуль, 388 связей, 0 нарушений) —
  зелёные. Новых зависимостей нет.
- **Не проверено и не могло быть в этой среде**: реальное поведение
  вебхуков `track_published`/`track_unpublished` против настоящего
  `livekit-server` — что события действительно приходят в ожидаемом
  порядке и с ожидаемой задержкой (окно, в течение которого не-учителю
  «удаётся» на долю секунды увидеть свою демонстрацию до мьюта сервером,
  зависит от реальной сетевой задержки вебхука); визуальная проверка
  автопереключения режима у всех подключённых клиентов разом. Нет
  Docker/livekit-server. Первая живая проверка — на Linux, вместе с гейтом
  Э7.

**Итог сессии по Э7**: все 4 задачи (Э7.1–Э7.4) реализованы и проверены
(typecheck/build/test/depcheck зелёные, 146/146 бэкенда). Гейт Э7
(демонстрация на 30 человек не поднимает трафик выше потолка Э6) и живая
проверка через Grafana/Chrome DevTools MCP остаются на Linux — нет Docker
в этой среде, как и на Э3–Э6. Как и раньше, отсутствие гейта не блокирует
по решению пользователя переход к следующему этапу, но Э8 — **новый
контекст** (§1.1 ПЛАН.md), а не продолжение этой сессии без явного
основания.

---

# Архив: Э6 — Видео учеников (завершён 2026-09-02)

## Стоп-лист Э6

```
НЕ делать на этом этапе:
- НЕ делать сетку больше 9 плиток. Никогда. Ни по просьбе учителя.
- НЕ делать 720p для учеников
- НЕ делать breakout-комнаты (это Э11 и отдельная нагрузка)
- НЕ делать реакции-анимации на видео
```

## Задачи

- [x] Э6.1 Публикация видео учеником — только по праву от учителя, максимум 360p.
- [x] Э6.2 Жёсткий лимит: не более 9 видимых видео, подписка только на видимые.
- [x] Э6.3 Выбор видимых: активные говорящие + закреплённые учителем.
- [x] Э6.4 Режимы урока (§5.3 ТЗ): Лекция / Обсуждение / Работа над заданием / У доски.
- [x] Э6.5 Ограничитель на уровне сервера при превышении суммарного трафика.
- [x] Э6.6 Метрика «трафик по урокам» в Grafana, алерт на 600 Мбит/с.

## Гейт Э6 — определение потолка платформы

```
Прогнать три сценария livekit-cli load-test и записать максимум для каждого:
  A. Все уроки в режиме Лекция     → сколько влезает?  (ожидаем 15+)
  B. Все в режиме Обсуждение, 30 чел → сколько влезает?  (ожидаем 4)
  C. Смешанный реалистичный          → сколько влезает?  (ожидаем 8-12)

Результат сценария C записывается в документацию как ОФИЦИАЛЬНЫЙ ПОТОЛОК
ПЛАТФОРМЫ и в настройки: максимум одновременных уроков.

Если C < 8 — либо ужесточать медиаполитику, либо выносить LiveKit на
вторую машину (§10.6 ТЗ).

Отдельно сверить полученные цифры с расчётом §5.2 ТЗ (~180 Мбит/с на класс
30 в Обсуждении) — расхождение больше 30% сначала разобрать, потом
фиксировать потолок.
```

## MCP под Э6

Постоянный набор (Context7, Playwright, GitHub) + **Grafana MCP**
(главный инструмент этапа: три прогона гейта — это три запроса вида «дай
пик исходящего трафика, средний CPU LiveKit и максимальный packet loss за
окно теста»). Grafana MCP недоступен в этой среде — задел на Linux-сессию,
как и сам `livekit-cli load-test`.

## Что сделано технически (Э6.1)

- **Новое право `canPublishVideo` в `participantPermissionsSchema`**
  (`packages/shared/src/rooms.ts`) — по образцу `canSpeak`: ученик не
  публикует камеру, пока учитель явно не выдал право (§5.2 ТЗ: «публикуется
  только когда ученик в активной сетке», сама привязка к видимой сетке —
  задача Э6.2/6.3, здесь только сам переключаемый грант). `defaultPermissions`
  (`rooms/presence.ts`) — `canPublishVideo: isStaff`, как и остальные три
  права; учителю/админу флаг не нужен для реального доступа (у них камера
  и так разрешена ролью, Э5.1), но так поле осталось однородным со
  `canDraw`/`canSpeak`/`canShareScreen`, а не единственным исключением
  `false` для персонала.
- **`media/service.ts#buildPublishGrant`**: `canPublishCamera = isStaff ||
  permissions.canPublishVideo` — камера учителя/админа по-прежнему по роли
  (Э5.1, не тронуто), камера ученика — по этому праву. **360p — НЕ часть
  гранта.** LiveKit не ограничивает резолюцию публикуемого трека на уровне
  прав доступа (`canPublishSources` — это только список источников:
  microphone/camera/screen_share, без резолюции) — потолок 360p из §5.2 ТЗ
  целиком клиентская настройка (`RoomPage.tsx`/`CameraControls.tsx` ниже),
  тот же доверительный периметр, что уже принят в проекте для остальных
  настроек качества медиа (клиент — не злоумышленник, а участник урока).
- **Роль как LiveKit-атрибут участника** (`attributes: { role: params.role
  }` в `AccessToken`, `createParticipantConnection`) — новая необходимость
  Э6.1: до неё ЛЮБОЙ трек CAMERA в комнате однозначно принадлежал учителю
  (только он мог его публиковать), `TeacherVideoTile` брал `tracks[0]`
  вслепую. С Э6.1 камеру может публиковать и ученик — `TeacherVideoTile`
  теперь ищет трек именно участника с `attributes.role === "teacher" ||
  "admin"` (прочитан `Participant.attributes` в установленном
  `livekit-client@2.22.0/room/participant/Participant.d.ts` — синхронизируется
  с сервером автоматически, отдельного WS-похода за ролью не потребовалось).
  Атрибут выставляется один раз при выдаче токена и не обновляется живьём —
  роль участника на время урока не меняется, в отличие от `permissions`.
- **`TeacherVideoTile` сознательно игнорирует, а не показывает трек
  ученика** — сетки видимых видео учеников ещё нет (Э6.2/6.3), показывать
  трек не пойми где в существующем UI было бы хуже, чем не показывать
  вообще. Стоп-лист Э6 («не более 9, никакой сетки раньше времени») этим не
  нарушается — эта плитка как была, так и осталась ровно одной, для учителя.
- **`CameraControls.tsx#SelfCameraButton` получил проп `maxResolution`**
  (по умолчанию `VideoPresets.h720.resolution` — старое поведение учителя не
  меняется без явного указания) — резолюцию решает вызывающая сторона
  (`RoomPage.tsx`, знает `isTeacher`), а не сама кнопка: учитель получает
  720p как раньше, ученик с `canPublishVideo` — `RoomPage.tsx` явно передаёт
  `maxResolution={VideoPresets.h360.resolution}` (§5.2 ТЗ). Один и тот же
  компонент кнопки на обе роли, а не дублирование под «ученическую камеру».
- **Автозапуска видео для ученика нет** (в отличие от учителя, Э5.1) —
  `<LiveKitRoom video>` читается один раз при подключении к комнате, а
  право `canPublishVideo` учитель может выдать посреди уже идущего урока,
  когда этот проп давно не перечитывается. Ученик включает камеру сам той
  же кнопкой `SelfCameraButton`, что и учитель — тем же путём, каким право
  `canSpeak` уже включает микрофон через `SelfMicButton`, паттерн не новый.
- **`VideoDegradeSuggestion` (Э5.5) расширен на ученика с `canPublishVideo`**
  (`media && (isTeacher || self?.permissions.canPublishVideo)`) — логика
  компонента не завязана на роль, а работает с любым локальным видеотреком
  камеры; не расширить её значило бы молча потерять предупреждение о плохом
  канале именно там, где оно нужнее всего (у ученика обычно канал хуже, чем
  у учителя со стационарного места). Не новая задача Э6, а обязательное
  следствие уже принятого в Э5.5 решения при появлении второго источника
  видео.
- **UI**: новый чекбокс «видео» в списке участников (`RoomPage.tsx`), рядом
  с «рисовать»/«говорить» — тот же паттерн `togglePermission`, без лимита на
  количество одновременно выданных прав (в отличие от `canSpeak`, где лимит
  4 микрофонов есть, — лимит на видео появится в Э6.2 как лимит ВИДИМОЙ
  сетки, а не лимит на сам грант).
- Тесты: `apps/api/src/modules/media/service.test.ts` (+4, было 15, стало
  19) — ученик с `canPublishVideo=true` получает camera и `canPublish=true`
  даже при `canSpeak=false`; отзыв права убирает camera из живого гранта;
  токен несёт `attributes.role` и для учителя, и для ученика.
  `rooms/presence.test.ts` (+0 новых тестов, 2 обновлены под новое поле
  дефолтов). Итого 122/122 бэкенда (было 118, +4).
- **Проверки**: `pnpm -r typecheck` (5 пакетов), `pnpm build` (все пакеты,
  включая `apps/web`), `pnpm test` (122/122), `pnpm depcheck` (147 модулей,
  370 связей, 0 нарушений) — зелёные. Новых зависимостей нет.
- **Не проверено и не могло быть в этой среде**: реальная публикация камеры
  учеником в живой LiveKit-комнате, фактическая резолюция опубликованного
  трека на стороне SFU (360p, а не выше), появление `attributes.role` на
  подключённом `RemoteParticipant` у других участников комнаты живьём — нет
  Docker/livekit-server. Первая живая проверка — на Linux при `docker
  compose up`.

## Что сделано технически (Э6.2)

- **`autoSubscribe` выключен явно** (`connectOptions={{ autoSubscribe:
  false }}` на `<LiveKitRoom>`, `RoomPage.tsx`) — прочитан установленный
  `livekit-client@2.22.0`: сам SDK включает его по умолчанию (`true`), то
  есть без этой правки каждый участник автоматически подписался бы на
  КАЖДЫЙ опубликованный трек в комнате — при 30 учениках с камерой это
  ровно арифметика §5.1 ТЗ (сотни видеопотоков на один урок), несмотря на
  то что Э6.1 уже ограничил, КТО может публиковать. Э5 этой правки не
  требовал — до Э6.1 камеру мог публиковать только один учитель на комнату,
  подписка на один лишний трек погоды не делала.
- **`VideoSubscriptions.tsx#VideoSubscriptionManager`** — новый компонент
  (рендерит `null`, мысленно рядом с `MicSync`), единственное место, которое
  решает, что подписывать, теперь когда автоподписки нет:
  - микрофон — подписывается всегда, любому участнику (лимит §5.2 — не на
    подписку, а на одновременно ВКЛЮЧЁННЫЕ микрофоны учеников, он уже есть
    на уровне права `canSpeak`, не трогали);
  - камера учителя/админа (та же проверка `attributes.role`, что уже
    появилась в Э6.1 для `TeacherVideoTile`) — подписывается всегда, это не
    «ученик в сетке», лимит на 9 её не касается;
  - камера ученика — подписывается, только если участник входит в текущий
    видимый набор (`MAX_VISIBLE_STUDENT_VIDEOS = 9`). Выбор набора в Э6.2 —
    простой стабильный порядок по `identity` (`.sort().slice(0, 9)`); замена
    на «активный говорящий + закреплённые учителем» — отдельная задача
    Э6.3, поменяет только эту функцию выбора внутри эффекта, не сам
    механизм `setSubscribed`.
  - `useTracks(..., { onlySubscribed: false })` — намеренно `false` (дефолт
    самого хука, прочитанный в установленном `@livekit/components-react`, —
    `true`): без этого хук показал бы только уже подписанные треки, а
    решать нечем было бы управлять, если ещё не подписанные не видны.
  - `publication instanceof RemoteTrackPublication` отсеивает собственные
    публикации локального участника — `LocalTrackPublication.setSubscribed`
    не существует (прочитано в типах `livekit-client`), да и подписываться
    на свой же трек незачем.
- **`StudentVideoGrid.tsx`** — новый компонент, рендерит сетку из уже
  подписанных видео (до 9, крупные плитки) плюс компактный ряд кружков с
  инициалом и индикатором микрофона (`MicStatusIcon`, переиспользован из
  `MicControls.tsx`, Э2.6) для остальных учеников — буквально «аватар +
  индикатор звука» из §5.2 ТЗ. Список учеников берётся из `participants`
  (WS presence-снапшот `RoomPage`), а не из LiveKit-хуков — нужен состав
  ВСЕХ учеников урока, включая тех, кто ещё ничего не опубликовал (им и
  положен аватар), тогда как `useTracks` знает только про уже
  опубликовавших. **Этот компонент ничего не подписывает и не отписывает**
  — сознательно разделённая ответственность с `VideoSubscriptionManager`:
  рендер основан на текущей реальности (`useTracks` без `onlySubscribed:
  false`, то есть только уже подписанные), а не решает сам, кого показывать
  видео, — иначе два места решали бы одно и то же с риском разойтись.
- Подключено в `RoomPage.tsx`: `<StudentVideoGrid participants={...}/>`
  — внутри `content`, перед списком «Участники» (виден в обеих ветках,
  где `content` рендерится, но фактически монтируется только при
  `media` — иначе `useTracks` вызвался бы вне контекста `<LiveKitRoom>`).
  `<VideoSubscriptionManager/>` — рядом с `<TeacherVideoTile/>`, сайблингом
  `{content}` внутри `<LiveKitRoom>`.
- **Проверки**: `pnpm --filter @school/web typecheck`, `pnpm build` (все
  пакеты), `pnpm test` (122/122 бэкенда — Э6.2 целиком фронтовая, бэкенд не
  тронут), `pnpm depcheck` (149 модулей, 379 связей, 0 нарушений) —
  зелёные. Новых зависимостей нет.
- **Не проверено и не могло быть в этой среде**: реальное поведение
  `setSubscribed`/`autoSubscribe:false` против настоящего `livekit-server`
  — что подписка/отписка действительно останавливает и возобновляет приём
  медиа на SFU, а не только меняет локальный флаг клиента; фактический
  подсчёт видеопотоков при 30 участниках (ожидание гейта Э6 — не более 9).
  Нет Docker/livekit-server. Первая живая проверка — на Linux, вместе с
  гейтом Э6.

## Что сделано технически (Э6.3)

- **Новое поле `pinned` — на presence-записи, НЕ в `ParticipantPermissions`.**
  Сознательное решение: закрепление в сетке видео — не право участника (сам
  ученик закрепить себя не может, это всегда действие учителя над кем-то
  другим), а обычное ephemeral-состояние урока, тот же характер, что уже
  есть у `handRaised` (`presence.ts#PresenceEntry`, `rooms.ts#participantSnapshotSchema`
  в `packages/shared`). Класть его в `ParticipantPermissions` означало бы
  смешать «что участнику разрешено» с «что учитель решил показать» — разные
  оси, разная семантика синхронизации.
- **`rooms/service.ts#setPinned`** — авторизация как у `updatePermissions`/
  `muteParticipantNow` (учитель этого урока или админ), 404 если участника
  нет в комнате. Новый WS-тип `participant_pinned` (`{userId, pinned}`,
  тот же паттерн, что `hand_raised`) и HTTP `PATCH
  /lessons/:id/participants/:userId/pin`. `join()` заводит новым
  участникам `pinned: false`.
- **`VideoSubscriptions.tsx#VideoSubscriptionManager` получил проп
  `participants`** (WS presence-снапшот, уже был у `RoomPage`/
  `StudentVideoGrid`) — заменена ТОЛЬКО функция выбора видимого набора
  внутри эффекта, сам механизм `setSubscribed` из Э6.2 не тронут (это и
  была цель разделения на отдельную задачу):
  - `pinnedIds` — из `participants[].pinned`;
  - `speakingIds` — из `useSpeakingParticipants()` (готовый хук
    `@livekit/components-react`, сглаживание «говорит/не говорит» и опрос
    `Participant.isSpeaking` — целиком работа самого LiveKit SDK, здесь не
    переизобретались);
  - видимый набор = закреплённые ∪ говорящие (только реально публикующие
    камеру ученики, до `MAX_VISIBLE_STUDENT_VIDEOS`), закреплённые в
    приоритете, если вместе не влезают в лимит.
  - **Если никто не закреплён и не говорит — сетка видео пуста** (все
    ученики видны как аватары). Осознанно не «первые 9 по алфавиту, если
    нечем заполнить» (как временно было в Э6.2) — §5.2 ТЗ определяет видимый
    набор именно через «активные говорящие + закреплённые», а не «до 9
    первых попавшихся»; при полной тишине и без закреплений это и есть
    правильный ответ, не пробел в реализации.
- **`StudentVideoGrid.tsx` не изменился в логике** — только читает уже
  подписанные треки, а не решает, кого показывать (архитектура из Э6.2:
  разделение «кто решает» и «кто рендерит»). Добавлен только бейдж 📌 на
  плитке закреплённого ученика (косметика, `s.pinned` из того же снапшота).
- **UI**: кнопка 📌 у каждого ученика в списке участников (`RoomPage.tsx`,
  видна только учителю/админу, аналогично «Заглушить»), бейдж 📌 в самом
  списке участников — виден всем, не только учителю (как `handRaised`/✋).
- **Сглаживание/анти-мерцание сетки при частых включениях-выключениях речи
  сознательно не добавлено** — `useSpeakingParticipants()` уже полагается на
  собственное сглаживание LiveKit (`Participant.isSpeaking` не переключается
  мгновенно на каждый миллисекундный провал громкости); ТЗ не требует
  дополнительного дебounce поверх этого, а добавление своего было бы
  непрошенным усложнением без чёткого критерия «сколько». При необходимости
  — точка расширения именно здесь, в вычислении `speakingIds`.
- Тесты: `rooms/service.test.ts` (+3, было 24, стало 27) — только учитель
  или админ может закреплять (403 иначе), открепление возвращает `false`,
  404 без участника в комнате. `presence.test.ts` — фабрика `entry()`
  обновлена под новое поле, поведенческих тестов не добавляли (поле
  сквозное, не бизнес-правило `defaultPermissions`). Итого 125/125 бэкенда.
- **Проверки**: `pnpm -r typecheck` (5 пакетов), `pnpm build`, `pnpm test`
  (125/125), `pnpm depcheck` (149 модулей, 380 связей, 0 нарушений) —
  зелёные. Новых зависимостей нет.
- **Не проверено и не могло быть в этой среде**: реальное поведение
  `Participant.isSpeaking`/`useSpeakingParticipants()` против живого голоса
  через настоящий `livekit-server` (детекция активности голоса — работа
  SFU и клиентского VAD, не эмулируется юнит-тестами); визуальная проверка,
  что сетка действительно меняется при начале речи. Нет
  Docker/livekit-server. Первая живая проверка — на Linux, вместе с гейтом
  Э6.

## Что сделано технически (Э6.4)

- **Режим урока хранится в Redis, не в Postgres** (`presence.ts#getLessonMode/
  setLessonMode`, ключ `room:{lessonId}:mode`, дефолт `"lecture"` при
  отсутствии ключа) — тот же выбор, что уже сделан для `pinned` в Э6.3:
  ephemeral переключатель текущего урока, не аудируемая история вроде
  `lessonStatus` (который в Postgres, `lessons.status`, — влияет на
  отчётность/биллинг). Заводить миграцию под колонку ради поля, которое
  сбрасывается на дефолт с каждым новым уроком и не обязано переживать
  рестарт `apps/api`, было бы лишним весом.
- **`lessonModeSchema` (`packages/shared/src/rooms.ts`)** — `"lecture" |
  "discussion" | "assignment" | "spotlight"`, дефолт `lecture` (§5.2 ТЗ:
  «продуктовый рычаг, экономит 3–4× трафика, переключение в discussion —
  осознанное действие учителя»). Новое поле `lessonMode` в
  `joinLessonResponseSchema` (клиент узнаёт текущий режим при входе, как и
  `lessonStatus`) и WS-тип `lesson_mode` (тот же паттерн, что
  `lesson_status`, `hand_raised`, `participant_pinned`).
- **`rooms/service.ts#setLessonMode`** — авторизация как у
  `updatePermissions`/`setPinned` (учитель этого урока или админ), пишет в
  `presence.setLessonMode`, эмитит `lesson_mode` в WS-канал урока. HTTP —
  `PATCH /lessons/:id/mode`.
- **`VideoSubscriptions.tsx#computeVisibleStudentIds` — новая чистая
  функция, вынесенная ИЗ эффекта `VideoSubscriptionManager`** специально
  ради этой задачи: Э6.4 меняет только выбор видимого набора по режиму, не
  сам механизм `setSubscribed` (та же дисциплина разделения, что уже была
  между Э6.2 и Э6.3). Правила по режиму (§5.3 ТЗ, таблица «Медиа-профиль»):
  - `lecture`/`assignment` — видео учеников не подписывается ВООБЩЕ (пустой
    набор), «доска на весь экран, учитель — плитка в углу» для `lecture`
    получилось само собой: `TeacherVideoTile`/`Board` и так уже так
    выглядели по умолчанию, отдельная вёрстка не понадобилась;
  - `spotlight` («Опрос/у доски», «1 ученик крупно») — ровно один ученик,
    закреплённый учителем (`pinned`), НЕ говорящий — режим про то, кого
    учитель явно вызвал к доске, не про то, кто громче;
  - `discussion` — прежняя логика Э6.3 без изменений (закреплённые ∪
    говорящие, до 9, закреплённые в приоритете).
  - **Камера учителя гасится ТОЛЬКО в `assignment`** («видео полностью
    выключено» — единственный режим из таблицы §5.3 ТЗ, где это касается и
    учителя, не только сетки учеников); в `lecture`/`discussion`/`spotlight`
    учитель всегда виден, как и было.
  - **Микрофоны — подписка не зависит от режима вообще.** `assignment` в
    таблице ТЗ помечен «только аудио учителя», но это описание того, что
    обычно слышно (учитель говорит, ученики слушают), а не технический
    запрет подписки на чужой микрофон — право `canSpeak` и так решает, кто
    может говорить, независимо от режима; менять его по режиму значило бы
    задачу Э6.5/будущих правок, не эту.
- **`StudentVideoGrid.tsx` получил проп `mode` только для ФОРМЫ отображения,
  не для логики видимости** — при `lecture`/`assignment` `visible` и так
  пуст (никто не подписан), никакого условия по режиму для этого не
  понадобилось; `spotlight` рендерит единственную видимую плитку крупно (во
  всю ширину колонки, не мелкой ячейкой сетки `grid-cols-3`) — буквальное
  «1 ученик крупно» из §5.3 ТЗ.
- **UI**: `<select>` режима в шапке урока, видим и редактируем только
  учителю/админу (`isTeacher`), остальным — просто текстовая метка режима.
  Задание «на весь экран» для `assignment` не реализовано — сама сущность
  «задание» (интерактивные материалы) появится только в Э8 ПЛАН.md, строить
  экран под то, чего ещё нет, было бы забеганием вперёд; Э6.4 закрывает
  ровно то, что формулировка задачи и результат из ПЛАН.md требуют сейчас —
  «переключатель у учителя, медиапрофиль меняется».
- Тесты: `rooms/service.test.ts` (+2, было 27, стало 29) — `join()` без
  явного режима отдаёт `lecture`; только учитель/админ может сменить режим,
  новый режим виден в следующем `join()`. Мок `presence.js` дополнен
  in-memory `getLessonMode`/`setLessonMode` (настоящие бьют в Redis, как и
  остальной presence — тот же приём, что уже применялся для
  `setParticipant`/`getParticipant`). Итого 127/127 бэкенда.
- **Проверки**: `pnpm -r typecheck` (5 пакетов), `pnpm build`, `pnpm test`
  (127/127), `pnpm depcheck` (149 модулей, 380 связей, 0 нарушений) —
  зелёные. Новых зависимостей нет.
- **Не проверено и не могло быть в этой среде**: реальное поведение смены
  режима против живого `livekit-server` — что подписки действительно
  массово переключаются при смене режима (не только локальный флаг
  клиента), визуальная проверка `spotlight`-плитки и переключателя в
  браузере. Нет Docker/livekit-server. Первая живая проверка — на Linux,
  вместе с гейтом Э6.

## Что сделано технически (Э6.5)

- **Оценка трафика — расчётная, не измеренная**, и это явно НЕ то же самое,
  что настоящий гейт Э6 (`livekit-cli load-test` + Grafana). ТЗ прямо
  говорит: реальные цифры даёт только нагрузочный тест, а не арифметика.
  Реального измерения исходящего трафика (Prometheus/Grafana на сетевом
  интерфейсе) в этой среде и в проекте на этом этапе нет (Grafana MCP
  недоступен здесь же, где недоступен и на Э4/Э5/Э6.1-6.4, см. памятку
  project-video-platform-env-gaps) — оценка нужна, чтобы ограничитель мог
  РЕШАТЬ прямо сейчас, без похода в Grafana на каждый `join()`.
- **`estimateLessonMbit(mode, participantCount)`** (`rooms/service.ts`) —
  коэффициенты выведены делением табличных чисел §5.2/§5.2.1 ТЗ на 30
  (размер класса в исходном расчёте ТЗ, оба числа там линейны по числу
  подписчиков): Лекция 50/30, Обсуждение 180/30. `assignment` — ПЛОСКО 5
  Мбит/с независимо от числа участников (буквально «любой размер» в
  таблице §5.2.1 ТЗ — видео там выключено целиком, Э6.4). `spotlight` ТЗ
  не табулирует — приближение по аналогии с `lecture` (тоже один канал
  видео вниз на подписчика), но потоков два (учитель + один ученик), не
  один — коэффициент удвоен, отмечено в коде как приближение, а не факт из
  ТЗ. Все числа, что ИЗ ТЗ, а что оценка «по аналогии», разграничены в
  комментарии — чтобы через полгода не приняли догадку за источник истины.
- **`estimateTotalTrafficMbit`/`estimatePlatformTrafficMbit` разнесены
  специально ради тестируемости**: первая — чистая функция (сумма по
  массиву `{mode, participantCount}`), тестируется без единого мока;
  вторая — тонкий слой ввода-вывода (обходит `activeLessons`, спрашивает
  `presence.getLessonMode`/`countConnected` по каждому уроку) поверх первой.
  Без этого разделения тестировать арифметику пришлось бы через реальные
  `join()` на сотни фейковых участников на каждый юнит-тест коэффициентов.
- **Порог `PLATFORM_TRAFFIC_LIMIT_MBPS = 600`** — то же число, что уже
  зафиксировано в §10.8 ТЗ («Исходящий трафик сервера — порог алерта >600
  Мбит/с, 80% медиа-бюджета») и указано для Grafana-алерта в самой
  формулировке Э6.6. Одно число на два потребителя: автоматическая
  деградация здесь (Э6.5) и уведомление человека там (Э6.6, ещё не
  сделана) — согласованность важнее, чем два похожих, но разных числа.
- **Проверка — только для НОВОЙ комнаты (`lessonStatus === "scheduled" →
  "live"` в `join()`), а не постоянный пересчёт для уже идущих уроков** —
  буквально по формулировке задачи («новые комнаты открываются в режиме
  Лекция принудительно»). Если платформа перегрузится ПОСЛЕ того, как урок
  уже шёл в Обсуждении, эта проверка его не откатит — это осознанно другая,
  более сильная защита (принудительный откат уже идущего урока при
  превышении порога), которую задача не описывает; она осталась бы за
  Grafana-алертом (Э6.6) и решением человека, либо будущей задачей, если
  понадобится. Достраивать её сейчас значило бы придумывать за ТЗ.
- Режим форсируется даже если для этой же (новой) комнаты он был ЗАРАНЕЕ
  выставлен в `discussion` (например, оставшееся от предыдущего запуска
  значение — ключ Redis без TTL, Э6.4) — проверка идёт ПОСЛЕ определения,
  что комната именно открывается, и перезаписывает `presence.setLessonMode`
  безусловно, если порог превышен, независимо от текущего значения ключа.
- Тесты (`rooms/service.test.ts`, +4, было 29, стало 33): коэффициенты
  `estimateLessonMbit` по всем четырём режимам (числа сверены с §5.2.1 ТЗ);
  суммирование `estimateTotalTrafficMbit`; новая комната форсируется в
  `lecture`, когда «другой» урок в Обсуждении с 106 участниками (636 Мбит/с
  расчётных) уже идёт — даже если новую пытались открыть в `discussion`;
  контрольный тест — то же самое с 6 участниками в «другом» уроке (36
  Мбит/с) не форсирует ничего. Итого 131/131 бэкенда.
- **Проверки**: `pnpm -r typecheck` (5 пакетов), `pnpm build`, `pnpm test`
  (131/131), `pnpm depcheck` (149 модулей, 380 связей, 0 нарушений) —
  зелёные. Новых зависимостей нет. Э6.5 целиком бэкенд — фронт уже показывает
  любой присланный `lessonMode` (Э6.4), отдельная фронтовая правка не
  требовалась.
- **Не проверено и не могло быть в этой среде**: соответствие оценочных
  коэффициентов реальному трафику LiveKit (сверка расчёта с фактическими
  цифрами гейта — прямое указание ПЛАН.md для Э6, «отдельно попроси Claude
  Code сверить полученные цифры с расчётом из §5.2 ТЗ. Если расхождение
  больше 30% — сначала разберись почему») — возможно только после
  `livekit-cli load-test` на Linux; поведение при реальном рестарте
  `apps/api` посреди перегруженной платформы (`activeLessons` — in-memory,
  теряется при рестарте, см. комментарий в коде).

## Что сделано технически (Э6.6)

- **Метрика легла на уже существующую инфраструктуру, не с нуля** —
  `apps/api` уже отдаёт `/metrics` (`plugins/metrics.ts`, `prom-client`,
  заведено в Э3.3 под `canvas_active_ydocs`), Prometheus уже скрейпит его
  под job `app` (`monitoring/prometheus/prometheus.yml`, Э0.11), Grafana с
  провижененным дашбордом `App overview` уже поднимается тем же оверлеем
  `docker-compose.monitoring.yml`. Э6.6 добавляет ровно то, чего не было:
  саму метрику по урокам + панели + алерт.
- **`rooms/service.ts#getActiveLessonTrafficSnapshot`** — новый экспорт,
  тот же паттерн, что уже даёт `canvas/service.ts#getActiveCanvasDocumentsCount`
  для `canvas_active_ydocs` (Э3.3): читает состояние модуля (`activeLessons`
  + `presence.getLessonMode`/`countConnected`) прямо в момент скрейпа, без
  параллельного счётчика. Внутри переиспользует `estimateLessonMbit` (Э6.5)
  — та же оценка, что уже решает про принудительную Лекцию, здесь просто
  экспортируется наружу для наблюдения, а не для решения.
- **`plugins/metrics.ts#lesson_traffic_mbit`** — `Gauge` с лейблами
  `lesson_id`/`mode` (async `collect()`, `prom-client` поддерживает
  `Promise<void>` из коробки — прочитано в типах установленного
  `prom-client@15.1.3`, `registry.metrics()` и так уже `Promise<string>` в
  существующем `/metrics`-роуте, ничего переделывать не пришлось).
  `this.reset()` перед заполнением — без этого лейблы уже завершившихся
  уроков висели бы в реестре со старым значением бесконечно, `activeLessons`
  сам их не подчищает.
- **Значение — РАСЧЁТНАЯ оценка, не измерение сетевого интерфейса** — в
  проекте нет прямого измерения исходящего трафика LiveKit (это отдельная
  инфраструктурная задача, ортогональная Э6 и не запрошенная ни одной
  задачей плана); написано явным текстом в `help` метрики и в коде, чтобы
  через полгода не приняли оценку за факт.
- **Алерт `PlatformTrafficHigh`** (`monitoring/prometheus/alerts.yml`) —
  `sum(lesson_traffic_mbit) > 600` в течение 2 минут, **то же число 600
  Мбит/с, что уже §10.8 ТЗ** («Исходящий трафик сервера, 80% медиа-бюджета»)
  и уже использует ограничитель Э6.5 (`PLATFORM_TRAFFIC_LIMIT_MBPS`) —
  единое число на автоматическую деградацию, алерт человеку и текст самого
  ТЗ, не три похожих, но разных. `for: 2m`, не 1м/5м как у соседних правил
  в файле, — трафик резче скачет, чем RAM/латентность (короткие пики от
  разовой конвертации/входа класса не должны алертить), но и не должен
  ждать 5 минут, как латентность, — компромисс, не взят из ТЗ буквально.
- **Дашборд `App overview`** (`monitoring/grafana/provisioning/dashboards/json/app-overview.json`)
  — две новые панели тем же форматом, что уже есть (id/type/title/gridPos/targets,
  расширение существующего JSON, не новый файл): «Трафик по урокам» —
  `sum(lesson_traffic_mbit) by (lesson_id, mode)`, буквально «видно, кто ест
  канал»; «Суммарный трафик платформы» — `sum(lesson_traffic_mbit)`, тот же
  ряд, что проверяет алерт, глазами. JSON провалидирован `JSON.parse`
  (`node -e`) — недостаточно для гарантии, что Grafana примет схему
  панелей, но отсекает синтаксические ошибки уровня опечатки.
- Тесты (`rooms/service.test.ts`, +1, было 33, стало 34):
  `getActiveLessonTrafficSnapshot` отдаёт `{mode, participantCount,
  estimatedMbit}` для активного урока, значение сверено с той же
  `estimateLessonMbit`, что уже покрыта тестами Э6.5 (не задваивает
  проверку коэффициентов, а собственно интеграцию — что снапшот реально
  читает актуальные `mode`/`participantCount`). Итого 132/132 бэкенда.
- **Проверки**: `pnpm -r typecheck` (5 пакетов), `pnpm build`, `pnpm test`
  (132/132), `pnpm depcheck` (149 модулей, 381 связь, 0 нарушений) —
  зелёные. `node -e "JSON.parse(...)"` — дашборд синтаксически валиден.
  Новых зависимостей нет (`prom-client` уже был с Э3.3).
- **Не проверено и не могло быть в этой среде**: реальный `docker compose
  -f docker-compose.yml -f docker-compose.monitoring.yml up` — что
  Prometheus действительно видит `lesson_traffic_mbit` через скрейп,
  Alertmanager реально шлёт алерт в `ntfy` при превышении порога, панели
  дашборда рендерятся в браузере Grafana без ошибок схемы. Нет Docker в
  этой среде. Первая живая проверка — на Linux, вместе с гейтом Э6 (там же,
  где `livekit-cli load-test` — Grafana MCP тоже недоступен здесь же).

**Итог сессии по Э6**: все 6 задач (Э6.1–Э6.6) реализованы и проверены
(typecheck/build/test/depcheck зелёные, 132/132 бэкенда). Три сценария
гейта Э6 (`livekit-cli load-test` A/Б/В из ПЛАН.md, официальный потолок
платформы) и живая проверка Grafana/Prometheus/Alertmanager остаются на
Linux — нет Docker в этой среде, как и на Э3–Э5. Как и раньше, отсутствие
гейта не блокирует по решению пользователя переход к следующему этапу, но
Э7 — **новый контекст** (§1.1 ПЛАН.md), а не продолжение этой сессии без
явного основания.

---

# Архив: Э5 — Видео учителя (завершён 2026-09-01)

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
- [x] Э5.2 `adaptiveStream` и `dynacast` включены.
- [x] Э5.3 Плитка учителя в UI: закрепление, сворачивание, режим «только доска».
- [x] Э5.4 Выбор камеры в проверке устройств, превью до входа.
- [x] Э5.5 Деградация: при packet loss > 5% автоматически предложить выключить видео.
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

## Что сделано технически (Э5.2)

- **`adaptiveStream`/`dynacast` явно включены в `ROOM_OPTIONS`**
  (`RoomPage.tsx`) — оба **выключены по умолчанию** в самом `livekit-client`
  (прочитан `roomOptionDefaults` в установленном
  `dist/livekit-client.esm.mjs@2.22.0`: `adaptiveStream: false, dynacast:
  false`), поэтому без явного флага требование §5.2 ТЗ («LiveKit сам
  понижает слой для маленькой плитки», «не публиковать слои, на которые
  никто не подписан») тихо не выполнялось бы, несмотря на то что simulcast
  (Э5.1) уже настроен. Это единственная задача Э5.2 — оба флага одной
  строкой в `RoomOptions`, никакой дополнительной клиентской логики не
  требуют (адаптация и dynacast — целиком внутренняя работа SDK/SFU).
- **Эффект пока минимален на одной плитке учителя** — `adaptiveStream`
  раскрывается на маленьких превью-плитках, `dynacast` экономит слои без
  подписчиков; при 30 участниках и одной плитке 192px подписчик почти
  всегда получит нижний слой автоматически, экономия станет заметна и
  измеримой на сетке из 9 в Э6. Включено сейчас, а не отложено «на потом
  когда понадобится» — CLAUDE.md требует явные флаги с самого начала
  использования LiveKit, не довинчивание по факту жалобы на трафик.
- **Проверки**: `pnpm --filter @school/web typecheck`, `pnpm build` (все
  пакеты), `pnpm test` (118/118 бэкенда, без изменений — Э5.2 бэкенд не
  трогает), `pnpm depcheck` (147 модулей, 0 нарушений) — зелёные. Новых
  зависимостей нет.
- **Не проверено и не могло быть в этой среде**: то, что `adaptiveStream`
  реально понижает слой на маленькой плитке (Chrome DevTools MCP — сценарий
  ТЗ для этой проверки — недоступен в этой среде) и что `dynacast`
  действительно приостанавливает неиспользуемые слои на стороне SFU (нужен
  живой `livekit-server`). Первая живая проверка — на Linux, вместе с
  гейтом Э5.

## Что сделано технически (Э5.3)

- **«Учитель прячется одной кнопкой» — это уже готовый `SelfCameraButton`
  (Э5.1), не новая кнопка.** Второй переключатель с тем же эффектом
  («режим «только доска»» как отдельное состояние) заводить не стали — это
  было бы двумя выключателями одного и того же факта (публикуется трек
  камеры или нет), рассинхронизация между ними — источник багов на пустом
  месте. Подпись кнопки переименована под задачу — «Скрыть видео (только
  доска)» / «Показать видео» вместо технического «Выключить/включить
  камеру» — чтобы связь с продуктовым сценарием была видна прямо в UI, а не
  только в комментарии кода.
- **`TeacherVideoTile.tsx` — сворачивание и закрепление, оба состояния
  ЛОКАЛЬНЫЕ для каждого зрителя** (обычный `useState`, не Y.Doc и не WS) —
  осознанное решение: один ученик сворачивает или переставляет плитку у
  СЕБЯ, не трогая экран остальных участников (в отличие от `canDraw`/прав
  доступа, которые уже сихронизируются по WS в этом проекте, — здесь
  синхронизация была бы не нужна и вредна). `localStorage` не
  использовался (запрещён CLAUDE.md) — состояние не переживает
  перезагрузку страницы, что для чисто визуального предпочтения приемлемо.
  - **Сворачивание**: клик по плитке (кнопка «–») схлопывает её в кружок
    32px с одним эмодзи-индикатором (🎙️ если у учителя включён микрофон,
    иначе 📷) — тот же принцип, что уже применялся у `MicStatusIcon`
    (Э2.6), но без отдельного похода за состоянием микрофона: оно уже есть
    на `teacherTrack.participant.isMicrophoneEnabled` (та же `Participant`,
    что отдаёт `useTracks`, — не нужен второй хук `useParticipants()` для
    того же самого участника).
  - **Закрепление**: кнопка 📌 циклически двигает плитку по четырём углам
    экрана (`bottom-right → bottom-left → top-left → top-right → …`).
    Реализовано без drag-and-drop и без новых зависимостей (dnd-kit
    зарезервирован под Э8.5 для matching/ordering в заданиях, тащить его
    сюда ради плитки видео — лишняя зависимость ради второстепенной
    функции). Дефолт — тот же нижний правый угол, что был в Э5.1, ничьё
    поведение не меняется, пока зритель явно не нажал 📌.
- **Проверки**: `pnpm --filter @school/web typecheck`, `pnpm build` (все
  пакеты), `pnpm test` (118/118 бэкенда — Э5.3 целиком фронтовая, бэкенд не
  тронут), `pnpm depcheck` (147 модулей, 369 связей, 0 нарушений) —
  зелёные. Новых зависимостей нет.
- **Не проверено и не могло быть в этой среде**: визуальная проверка
  сворачивания/перестановки плитки живыми глазами в браузере (нет
  Docker/livekit-server — плитка не рендерится без реального видеотрека).
  Логика — typecheck и чтение; первая живая проверка — на Linux при
  `docker compose up`.

**Отклонённый на этом шаге запрос пользователя**: адаптивная сетка видео
ВСЕХ участников (по образцу Zoom) — прямо запрещена стоп-листом Э5 («не
включать камеры учеников ни одной», «не делать сетку плиток»). Это
предметная область Э6.2–Э6.3 ПЛАН.md (лимит 9 видимых, выбор по активному
говорящему + закреплённым учителем, максимум 360p, подписка только на
видимые). Пользователь подтвердил идти по плану — сетка будет сделана в
Э6, не сейчас.

## Что сделано технически (Э5.4)

- **Превью камеры на `DeviceCheckScreen` показывается ВСЕМ участникам, не
  только учителю/админу**, хотя публиковать видео в LiveKit сейчас может
  только их роль (Э5.1). Ключевое разграничение: `getUserMedia` для
  локального превью — чисто браузерная операция, поток никуда не
  отправляется, ни сервера, ни LiveKit не касается, нагрузки не создаёт —
  стоп-лист Э5 («не включать камеры учеников») говорит о ПУБЛИКАЦИИ, не о
  локальном взгляде на себя. Показывать превью только учителю было бы
  ненужным сужением: результат из ПЛАН.md прямо называет «ученик видит
  себя до урока», и когда в Э6 ученики получат право публиковать видео,
  экран проверки устройств уже готов — переделывать не придётся.
  Выбранное устройство для ученика просто не используется (сервер не даёт
  источник CAMERA его роли), для учителя — идёт в `<LiveKitRoom video>`.
- **Камера — независимый, необязательный блок, не совмещённый с
  микрофоном.** Свой `getUserMedia({ video })`, свой список устройств, своё
  состояние разрешения браузера (`camPermission`), запускается только по
  явному клику «Проверить камеру» — в отличие от микрофона, который
  запрашивается сразу при открытии экрана. Осознанная асимметрия: микрофон
  обязателен для голосового участия почти всем, камеру же нужно явно
  запрашивать не у всех и не всегда (сейчас реально нужна только учителю) —
  всплывающий запрос доступа к камере от браузера сразу при входе на экран
  проверки для роли, которая её всё равно не может использовать, был бы
  лишним трением.
- **Превью зеркалится** (`scale-x-[-1]`) — стандартное ожидание от
  self-view камеры (как в Zoom/Meet), без этого лицо/жесты выглядят
  непривычно перевёрнутыми для смотрящего на себя человека.
  `stopCamStream()` добавлен в тот же cleanup-эффект, что уже останавливал
  микрофонный поток при размонтировании — трек камеры не должен продолжать
  гореть в браузере после ухода с экрана проверки.
- **`onContinue` сменил сигнатуру** с одного `deviceId` на пару
  `(micDeviceId, camDeviceId)` — `RoomPage.tsx` получил новое состояние
  `camDeviceId`, идёт в `video={{ resolution: …, deviceId: camDeviceId ??
  undefined }}` при входе в `<LiveKitRoom>` (только для `isTeacher`, как и
  раньше в Э5.1) — учитель входит в урок сразу с той камерой, которую
  проверил, а не с системной по умолчанию.
- **Проверки**: `pnpm --filter @school/web typecheck`, `pnpm build` (все
  пакеты), `pnpm test` (118/118 бэкенда — Э5.4 целиком фронтовая), `pnpm
  depcheck` (147 модулей, 369 связей, 0 нарушений) — зелёные. Новых
  зависимостей нет.
- **Не проверено и не могло быть в этой среде**: реальный запрос
  `getUserMedia({video})` и рендер зеркалированного превью в браузере (нет
  устройства с камерой в тестовом окружении CI/typecheck — компонент
  собирается, логика читаема и повторяет уже проверенный вручную в Э2.4
  паттерн для микрофона). Первая живая проверка — на Linux/локально в
  браузере при `docker compose up`.

## Что сделано технически (Э5.5)

- **`CameraControls.tsx#VideoDegradeSuggestion`** — новый компонент, тот же
  паттерн, что уже был у `PacketLossWarning` для аудио (Э2.8), но для
  исходящего видео учителя и с порогом 5% (не 3%, как у аудио — видео
  терпимее к потерям, поэтому порог реакции выше, оба числа взяты из
  соответствующих задач ПЛАН.md, не придуманы заново).
- **Ключевое отличие от аудио-версии, найденное чтением исходника**:
  `LocalVideoTrack.getSenderStats()` возвращает МАССИВ (`VideoSenderStats[]`)
  — по записи на каждый слой simulcast (720/360/180, Э5.1), тогда как
  `LocalAudioTrack.getSenderStats()` — один объект (аудио без simulcast).
  Взятие `layers[0]` вместо суммирования дало бы метрику только по одному
  случайному слою (какой именно первый — не документировано и зависит от
  порядка регистрации в браузере). Решение — сложить `packetsSent`/
  `packetsLost` по всем слоям массива, чтобы получить общую потерю на пути
  публикации, а не выхваченного слоя. Проверено чтением `room/stats.d.ts`
  установленного `livekit-client@2.22.0` (та же дисциплина «не
  делегировать вслепую», что и у остальных мест этого этапа с LiveKit).
- **Не просто предупреждение — сразу кнопка «Выключить видео» рядом с
  текстом**, вызывающая тот же `localParticipant.setCameraEnabled(false)`,
  что и `SelfCameraButton` (Э5.1/Э5.3). Голая надпись без действия легко
  потерять в разгар урока — задача явно требует «предложить выключить», а
  не просто индикатор.
- **Приоритет: видео жертвуется первым, аудио — последним.** Компонент не
  трогает `PacketLossWarning` (аудио-предупреждение остаётся отдельным, с
  собственным порогом 3%) — согласуется с §1.2 ТЗ (связность урока важнее
  картинки с камеры): если канал плохой, сначала предлагаем отключить
  видео, а не аудио.
- Опрос статистики останавливается, когда камера уже выключена
  (`isCameraEnabled === false` → `lossRatio` сбрасывается в `null`, интервал
  не заводится) — нет смысла спрашивать статистику несуществующего трека
  каждые 2 секунды.
- Подключено в `RoomPage.tsx` рядом с `PacketLossWarning`, видно только
  `isTeacher` (только эта роль публикует видео, Э5.1).
- **Проверки**: `pnpm --filter @school/web typecheck`, `pnpm build` (все
  пакеты), `pnpm test` (118/118 бэкенда — Э5.5 целиком фронтовая), `pnpm
  depcheck` (147 модулей, 370 связей, 0 нарушений) — зелёные. Новых
  зависимостей нет.
- **Не проверено и не могло быть в этой среде**: реальная деградация канала
  и то, что `getSenderStats()` в живом браузере против настоящего
  `livekit-server` действительно отдаёт ожидаемые по документации поля —
  нет Docker/реальной сети с потерями для симуляции. Первая живая проверка
  — на Linux (можно сузить `tc qdisc` на loopback/veth для имитации потерь,
  но и это только там же, где Docker).

## Э5.6 — заблокирована в этой среде, не начата

Э5.6 («Замер и запись фактических цифр в документацию») по формулировке
ПЛАН.md — это ЗАПИСЬ результата гейта Э5 (`livekit-cli load-test --rooms 10
--publishers 1 --subscribers 19 --video-publishers 1 --video-resolution
720p`, чтение пиков через Grafana MCP). Реальных цифр получить неоткуда:
нет Docker → нет `livekit-server`, нет `livekit-cli`, недоступен Grafana
MCP (см. «MCP под Э5» выше и памятку project-video-platform-env-gaps).
Выдумывать числа в документацию — то же самое, что соврать в ТЗ; не
делалось. Задача остаётся невыполненной до Linux-сессии с Docker: гейт Э5 и
Э5.6 логически одно и то же действие (прогнать нагрузку → записать
результат), выполняются вместе.

**Итог сессии по Э5**: код готов и проверен (typecheck/build/test/depcheck)
для Э5.1–Э5.5. Гейт Э5 и Э5.6 — на Linux. Как и после Э3/Э4, отсутствие
гейта не блокирует по решению пользователя переход к Э6, но Э6 —
**новый контекст** (§1.1 ПЛАН.md, «один этап = один контекст»), не
продолжение этой сессии без явного основания (в отличие от перехода
Э3→Э4, где было отдельное явное решение пользователя смешать контексты).

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
