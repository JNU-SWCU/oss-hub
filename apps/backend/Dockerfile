FROM node:24-alpine AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /workspace

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/backend/prisma apps/backend/prisma

RUN pnpm install --frozen-lockfile --filter backend...

FROM dependencies AS builder

COPY apps/backend apps/backend

RUN pnpm --filter backend exec prisma generate \
    && pnpm --filter backend build \
    && pnpm --filter backend --prod deploy --legacy /deploy \
    && rm -rf /deploy/prisma \
    && cp -R apps/backend/prisma /deploy/prisma \
    && cd /deploy \
    && ./node_modules/.bin/prisma generate

FROM node:24-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

RUN apk add --no-cache curl

COPY --from=builder --chown=node:node /deploy ./
COPY --from=builder --chown=node:node /workspace/apps/backend/dist ./dist
COPY --from=builder --chown=node:node /workspace/apps/backend/prisma ./prisma

USER node

EXPOSE 4000

CMD ["node", "dist/main.js"]
