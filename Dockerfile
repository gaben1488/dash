# Production-образ dash: один сервис отдаёт API + собранный SPA.
#
# ВАЖНО про рантайм: @aemr/shared и @aemr/core — ИСХОДНЫЕ TS-пакеты
# (package.json main = ./src/index.ts, в dist не собираются). tsc НЕ переписывает
# path-алиасы, поэтому `node dist/index.js` не резолвит их в рантайме. Сервер
# штатно запускается через tsx из исходников (packages/server: dep "tsx" +
# скрипт start:prod). Здесь так и делаем: tsx транспилирует TS-воркспейс на лету.
#
# node_modules — hoisted (плоский), чтобы tsx резолвил dotenv/better-sqlite3/
# @aemr/* из единого /app/node_modules. Нативный better-sqlite3 собирается в
# build-стадии (node:22-alpine) и бинарно совместим с production-стадией.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS build
# Плоский node_modules (npm-style), чтобы прод-стадия резолвила зависимости из /app/node_modules
RUN printf 'shamefully-hoist=true\nnode-linker=hoisted\n' > /app/.npmrc
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
# Собираем ТОЛЬКО web (SPA). Сервер и shared/core запускаются из исходников через tsx.
RUN pnpm --filter @aemr/web build

FROM base AS production
ENV NODE_ENV=production
WORKDIR /app
# Плоский node_modules (с нативным better-sqlite3) + исходники воркспейса,
# чтобы workspace-симлинки @aemr/shared|core резолвились в реальные src.
COPY --from=build /app/.npmrc ./.npmrc
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
# tsconfig.runtime.json нужен tsx: @aemr/shared|core резолвятся через его `paths`
# (baseUrl=/app), НЕ через pnpm-симлинки node_modules (их нет в этом образе).
# Отдельный от базового — чтобы `paths` не конфликтовали с per-package rootDir в typecheck.
COPY --from=build /app/tsconfig.runtime.json ./tsconfig.runtime.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/src ./packages/shared/src
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/src ./packages/core/src
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/src ./packages/server/src
# SPA в /app/public — сервер отдаёт его через fastifyStatic (cwd = /app).
COPY --from=build /app/packages/web/dist ./public
EXPOSE 3000
# tsx из исходников; --tsconfig tsconfig.runtime.json (paths @aemr/shared|core →
# packages/*/src). cwd = /app → public/ и data/ рядом.
CMD ["./node_modules/.bin/tsx", "--tsconfig", "tsconfig.runtime.json", "packages/server/src/index.ts"]
