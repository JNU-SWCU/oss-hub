# syntax=docker/dockerfile:1
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /workspace

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/frontend/package.json apps/frontend/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter frontend... --ignore-scripts --store-dir /pnpm/store

FROM dependencies AS builder

COPY apps/frontend apps/frontend

RUN pnpm --filter frontend build

FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runtime

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

WORKDIR /app

RUN apk add --no-cache curl

COPY --from=builder --chown=node:node /workspace/apps/frontend/.next/standalone ./
COPY --from=builder --chown=node:node /workspace/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=builder --chown=node:node /workspace/apps/frontend/public ./apps/frontend/public

USER node

EXPOSE 3000

CMD ["node", "apps/frontend/server.js"]
