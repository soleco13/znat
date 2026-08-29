# syntax=docker/dockerfile:1
#
# Конвертер презентаций (Э4.1). Собирается из контекста корня монорепо
# (`docker compose` передаёт `context: .`), чтобы переиспользовать
# pnpm-workspace + единый lockfile при `--frozen-lockfile`.
#
# Образ тяжёлый (~1,5 ГБ из-за LibreOffice) — поэтому это ОТДЕЛЬНЫЙ контейнер,
# не слой в основном `app` (§10.2 ТЗ).

FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# --- установка зависимостей workspace (frozen) -------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY services/converter/package.json services/converter/package.json
RUN pnpm install --frozen-lockfile --filter @school/converter

# --- сборка TypeScript ------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY services/converter services/converter
RUN pnpm --filter @school/converter run build

# --- рантайм: node + LibreOffice + Poppler + ClamAV -------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# LibreOffice под read_only rootfs держит профиль во writable HOME (=/tmp,
# смонтирован как tmpfs в docker-compose).
ENV HOME=/tmp

RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-impress \
      libreoffice-writer \
      poppler-utils \
      clamav \
      fonts-liberation2 \
      fonts-dejavu \
      fonts-noto-core \
      fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# Сигнатурная база ClamAV скачивается на этапе СБОРКИ (у сборки есть интернет)
# и запекается в образ. В рантайме конвертер сети наружу не имеет
# (docker-сеть `convnet` c `internal: true`), поэтому freshclam там невозможен
# и не нужен — база освежается пересборкой образа (ночной ре-деплой).
RUN freshclam --quiet || (echo "freshclam failed — образ без свежей базы ClamAV" && exit 1)

WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --create-home app

# Рантайм-зависимостей у конвертера пока нет (Э4.1 — только stdlib + global
# fetch). BullMQ добавится в Э4.3 вместе с prod-deps слоем.
COPY --from=build /app/services/converter/dist ./dist
COPY services/converter/package.json ./package.json

# /data/assets монтируется томом в docker-compose; каталог-точка должна
# существовать и быть доступна пользователю app.
RUN mkdir -p /data/assets && chown -R app:app /data/assets /var/lib/clamav
USER app

CMD ["node", "dist/index.js"]
