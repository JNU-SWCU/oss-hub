-- 신청 시 저장소 연결 방식(NEW/OWN) — 제출 시 1회 결정. 기존 행은 NEW로 기본 설정된다.
CREATE TYPE "RepositoryConnectionMode" AS ENUM ('NEW', 'OWN');

ALTER TABLE "Application"
ADD COLUMN "repositoryConnectionMode" "RepositoryConnectionMode" NOT NULL DEFAULT 'NEW',
ADD COLUMN "repositoryUrl" TEXT;
