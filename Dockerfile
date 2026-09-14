# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
RUN corepack enable
ENV CI=true
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
ENV NODE_OPTIONS="--max-old-space-size=6144"
RUN pnpm --filter @school/shared run build \
    && pnpm --filter @school/shared exec tsc -p tsconfig.json \
    && pnpm --filter @school/web run build \
    && pnpm --filter @school/api run build

FROM deps AS prod-deps
RUN pnpm install --frozen-lockfile --prod

FROM node:22-bookworm-slim AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system app && useradd --system --gid app --create-home app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY apps/api/package.json ./apps/api/package.json

# @school/shared ships main:"./src/index.ts" for tsx/vite (dev, bundler resolution).
# Plain node in this runtime image can't resolve the .js-suffixed relative
# imports inside that .ts source, so point this copy's main at the compiled
# dist produced above instead — repo source (dev workflow) is untouched.
RUN node -e "const p='./packages/shared/package.json';const j=require(p);j.main='./dist/index.js';require('fs').writeFileSync(p,JSON.stringify(j));"

RUN mkdir -p /data/assets && chown -R app:app /data/assets
USER app

EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
