# Build context: the repository root (see infra/deploy.sh and CI).
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
# Self-contained production tree with real (non-symlinked) dependencies.
RUN pnpm --filter @tablo/api deploy --prod /out

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
USER node
EXPOSE 3000
# Migrations run on every start (idempotent), then the server.
CMD ["sh", "-c", "node dist/db/mig.js run && exec node dist/main.js"]
