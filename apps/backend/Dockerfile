# syntax=docker/dockerfile:1
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /workspace

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/backend/prisma/schema.prisma apps/backend/prisma/schema.prisma

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter backend... --store-dir /pnpm/store

FROM dependencies AS builder

COPY apps/backend apps/backend

RUN pnpm --filter backend exec prisma generate \
    && pnpm --filter backend build \
    && pnpm --filter backend --prod deploy --legacy /deploy \
    && rm -rf /deploy/prisma \
    && cp -R apps/backend/prisma /deploy/prisma \
    && cd /deploy \
    && ./node_modules/.bin/prisma generate

FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runtime

ENV NODE_ENV=production
ENV TZ=Asia/Seoul

WORKDIR /app

RUN apk add --no-cache curl

COPY --from=builder --chown=node:node /deploy ./
COPY --from=builder --chown=node:node /workspace/apps/backend/dist ./dist
COPY --from=builder --chown=node:node /workspace/apps/backend/prisma ./prisma
COPY --chown=node:node scripts/prisma-migration-ledger.mjs ./scripts/prisma-migration-ledger.mjs

USER node

EXPOSE 4000

CMD ["node", "dist/src/main.js"]
