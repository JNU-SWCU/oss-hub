-- 단계 C(.omc/plans/github-repository-unification.md §3·§7 C1/C2) — CollectionRepository를
-- GithubRepository로 통합한다. 기존 행을 보존하는 마이그레이션이다 — DROP+CREATE로 갈아엎지 않는다
-- (GR-1 계열과 동일 원칙: 수집 이력을 날리지 않는다).
--
-- 이번 마이그레이션이 하지 않는 것: Repository 테이블 통합(단계 D, 별도 릴리즈),
-- RepositoryInvitation/RepositoryProvisionJob FK 전환(단계 D2), Canonical* 정리(범위 밖).

-- 1) 테이블 개명 + 제약 이름을 새 이름에 맞춘다.
ALTER TABLE "CollectionRepository" RENAME TO "GithubRepository";
ALTER TABLE "GithubRepository" RENAME CONSTRAINT "CollectionRepository_pkey" TO "GithubRepository_pkey";

-- 2) 컬럼 개명 — fullName은 GitHub 용어(nameWithOwner)에 맞춘다.
ALTER TABLE "GithubRepository" RENAME COLUMN "fullName" TO "nameWithOwner";

-- 3) nullable 전환 — 개인 계정(조직 밖) 저장소 추적을 막던 구조적 제약을 푼다(R4).
--    defaultBranch도 빈 저장소는 기본 브랜치가 없을 수 있어 nullable로 바꾼다.
ALTER TABLE "GithubRepository" ALTER COLUMN "githubOrganizationId" DROP NOT NULL;
ALTER TABLE "GithubRepository" ALTER COLUMN "defaultBranch" DROP NOT NULL;

-- 4) source 컬럼 추가. 기존 행은 전부 조직이 프로비저닝한 저장소이므로 NOT NULL을 걸기 전에
--    ORG_PROVISIONED로 backfill한다.
CREATE TYPE "RepositorySource" AS ENUM ('ORG_PROVISIONED', 'EXTERNAL_PUBLIC');
ALTER TABLE "GithubRepository" ADD COLUMN "source" "RepositorySource";
UPDATE "GithubRepository" SET "source" = 'ORG_PROVISIONED';
ALTER TABLE "GithubRepository" ALTER COLUMN "source" SET NOT NULL;

-- 5) unique 제약 단순화 — githubRepositoryId는 GitHub 전역 고유이므로 단독 키로 충분하다.
--    nullable해진 githubOrganizationId를 복합 unique에 남겨두면 NULL 의미론상 중복이 새어든다(GR-3).
DROP INDEX "CollectionRepository_githubOrganizationId_githubRepositoryI_key";
CREATE UNIQUE INDEX "GithubRepository_githubRepositoryId_key" ON "GithubRepository"("githubRepositoryId");

-- 6) 기존 인덱스 개명 + source 조회축 신설.
ALTER INDEX "CollectionRepository_visibility_presence_idx" RENAME TO "GithubRepository_visibility_presence_idx";
CREATE INDEX "GithubRepository_source_visibility_idx" ON "GithubRepository"("source", "visibility");

-- 7) 커서·리스 3종의 organizationLogin -> scope 일반화(§3.1). 외부 sweep이 org sweep과 리스·커서·
--    45분 예산을 다투지 않도록(GR-9) 독립 스코프를 쓴다. 기존 행은 전부 org sweep이 만든 값이므로
--    "org:<login>"으로 backfill한다 — 외부 sweep 행은 아직 존재하지 않는다(discovery는 단계 E).
ALTER TABLE "CollectionSyncCursor" RENAME COLUMN "organizationLogin" TO "scope";
UPDATE "CollectionSyncCursor" SET "scope" = 'org:' || "scope";

ALTER TABLE "CollectionSyncLease" RENAME COLUMN "organizationLogin" TO "scope";
UPDATE "CollectionSyncLease" SET "scope" = 'org:' || "scope";

ALTER TABLE "CollectionCutoverLease" RENAME COLUMN "organizationLogin" TO "scope";
UPDATE "CollectionCutoverLease" SET "scope" = 'org:' || "scope";
