# syntax=docker/dockerfile:1
FROM node:24-alpine AS dependencies

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

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
# 컨테이너의 로컬 시각을 KST로 고정한다.
#
# 앱 코드는 날짜를 UTC 절대값으로 다루거나 `timeZone: 'Asia/Seoul'`을 명시하므로 이 값에
# 기대지 않는다. 그런데 **타임존을 못 받는 형식**이 하나 있다 — 교직원 서류 ZIP이 적는
# 옛 DOS 수정 시각(`milestone-documents/domain/milestone-document-archive.ts`)이다. 그 필드는
# 「만든 쪽의 로컬 시각」이라 컨테이너가 UTC로 돌면 Windows 탐색기에서 9시간 이르게 보이고,
# 마감 직후 제출이 전날 제출로 읽힌다. 시각을 코드에서 밀어 맞추면 같은 ZIP의 UTC 확장 필드가
# 대신 틀려 7-Zip·macOS 쪽이 깨지므로, 고칠 자리는 여기다.
#
# ⚠ Alpine에 `tzdata`를 따로 깔지 않아도 되는 것은 이 이미지의 Node가 ICU에 tz 데이터를
# 안고 있기 때문이다(`node:24-alpine`에서 실측 확인). 더 작은 ICU를 쓰는 이미지로 바꾸면
# 이 값이 조용히 UTC로 되돌아간다.
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
