# Build context: the repository root (see infra/deploy.sh and CI).
FROM node:22-slim AS build
ENV CI=true
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --filter @hale/api...
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/contracts packages/contracts
RUN pnpm --filter @hale/api build
# Self-contained production tree with real (non-symlinked) dependencies.
RUN pnpm --filter @hale/api deploy --prod /out

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
USER node
EXPOSE 3000
# Migrations run on every start (idempotent), then the server.
CMD ["sh", "-c", "node dist/db/mig.js run && exec node dist/main.js"]
