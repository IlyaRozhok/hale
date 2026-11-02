# Build context: the repository root (see infra/compose.yml and deploy.yml).
FROM node:22-slim AS build
ENV CI=true
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @tablo/api...
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN pnpm --filter @tablo/api build

FROM node:22-slim AS prod-deps
ENV CI=true
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter @tablo/api...

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /repo/apps/api/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
USER node
EXPOSE 3000
# Migrations run on every start (idempotent), then the server.
CMD ["sh", "-c", "node dist/db/mig.js run && exec node dist/main.js"]
