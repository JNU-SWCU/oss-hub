-- #617 단계 D: Repository(#449 프로비저닝 산출물) 테이블을 GithubRepository로 흡수한다.
-- 순서가 안전을 결정한다 — 반드시 이 순서를 유지한다.
--   1) GithubRepository에 4개 nullable 컬럼 추가
--   2) Repository 중 GithubRepository 짝(githubRepositoryId 일치)이 없는 행을 신규 삽입
--   3) 짝이 있는 GithubRepository 행에 id 승계 + 4개 컬럼 복사 + visibility 승계(단일 UPDATE)
--   4) RepositoryInvitation/RepositoryProvisionJob의 FK 대상을 Repository→GithubRepository로 재지정
--      (repositoryId 값은 그대로 두고 참조 테이블만 바꾼다 — 3)에서 GithubRepository.id가
--      이미 Repository.id 값으로 승계됐으므로 값 변경 없이 제약만 통과한다)
--   5) Repository 테이블 드롭 (자신 소유 FK도 함께 사라진다)
--   6) GithubRepository 신규 컬럼(applicationId/programId/teamId)의 FK 추가
--   7) 인덱스 추가
--
-- onDelete 의미는 그대로 보존한다: RepositoryInvitation은 RESTRICT(저장소 삭제를 초대 잔존이 막는다),
-- RepositoryProvisionJob은 SET NULL(잡은 저장소 삭제에도 살아남는다). 둘 다 ON UPDATE CASCADE로,
-- id 승계 시 자식 FK가 함께 갱신된다 — 이 원칙은 CollectionRepositoryStream/CollectionCommitFact/
-- CollectionPullRequestFact/CollectionReleaseFact/Contribution에도 이미 적용되어 있어(단계 C) 3)의
-- id UPDATE만으로 전부 cascade 전파된다.
--
-- 인벤토리 스윕 upsert(recordRepositoryObservation)는 명시적 필드 목록만 쓰고 이 4개 컬럼을
-- 절대 건드리지 않는다 — 이 마이그레이션이 만든 값이 스윕으로 지워지지 않는다.

-- 1) GithubRepository에 provision 컬럼 추가 (모두 nullable)
ALTER TABLE "GithubRepository"
  ADD COLUMN "applicationId" TEXT,
  ADD COLUMN "programId" TEXT,
  ADD COLUMN "teamId" TEXT,
  ADD COLUMN "publishedAt" TIMESTAMP(3);

-- 2) 짝이 없는 Repository 행을 GithubRepository로 신규 삽입한다.
--    url은 항상 `https://github.com/<owner>/<name>` 형태로만 저장된다
--    (isValidSucceededRepositoryIdentity가 NEW/OWN 양쪽 모두 이 형태만 통과시킨다) —
--    prefix를 제거하면 nameWithOwner를 안전하게 복원할 수 있다.
INSERT INTO "GithubRepository" (
  "id",
  "githubOrganizationId",
  "githubRepositoryId",
  "nameWithOwner",
  "defaultBranch",
  "archived",
  "source",
  "visibility",
  "presence",
  "lastCompleteInventoryObservedAt",
  "nextRunAt",
  "lastSuccessAt",
  "failureCount",
  "applicationId",
  "programId",
  "teamId",
  "publishedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  r."id",
  NULL,
  r."githubRepositoryId",
  regexp_replace(r."url", '^https://github\.com/', ''),
  NULL,
  false,
  'ORG_PROVISIONED',
  r."visibility",
  'PRESENT',
  NULL,
  now(),
  NULL,
  0,
  r."applicationId",
  r."programId",
  r."teamId",
  r."publishedAt",
  r."createdAt",
  r."updatedAt"
FROM "Repository" r
WHERE NOT EXISTS (
  SELECT 1 FROM "GithubRepository" g WHERE g."githubRepositoryId" = r."githubRepositoryId"
);

-- 3) 짝이 있는 GithubRepository 행: id를 Repository.id로 승계하고 provision 컬럼 +
--    visibility를 복사한다. 짝이 없는 GithubRepository 행(EXTERNAL_PUBLIC 등)은 이 UPDATE의
--    영향을 받지 않아 4개 컬럼이 계속 NULL로 남는다.
UPDATE "GithubRepository" g
SET
  "id" = r."id",
  "applicationId" = r."applicationId",
  "programId" = r."programId",
  "teamId" = r."teamId",
  "publishedAt" = r."publishedAt",
  "visibility" = r."visibility"
FROM "Repository" r
WHERE g."githubRepositoryId" = r."githubRepositoryId";

-- 4) RepositoryInvitation/RepositoryProvisionJob의 FK 대상을 GithubRepository로 재지정한다.
--    repositoryId 값 자체는 건드리지 않는다 — 3)에서 이미 GithubRepository.id = Repository.id다.
ALTER TABLE "RepositoryInvitation" DROP CONSTRAINT "RepositoryInvitation_repositoryId_fkey";
ALTER TABLE "RepositoryInvitation"
  ADD CONSTRAINT "RepositoryInvitation_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "GithubRepository"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RepositoryProvisionJob" DROP CONSTRAINT "RepositoryProvisionJob_repositoryId_fkey";
ALTER TABLE "RepositoryProvisionJob"
  ADD CONSTRAINT "RepositoryProvisionJob_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "GithubRepository"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 5) Repository 테이블을 드롭한다 (자신 소유 FK — applicationId/programId/teamId — 도 함께 사라진다).
DROP TABLE "Repository";

-- 6) GithubRepository 신규 컬럼의 FK를 추가한다. programId만 명시적으로 RESTRICT다
--    (설계 결정) — applicationId/teamId는 nullable 컬럼 기본값인 SET NULL을 그대로 쓴다.
ALTER TABLE "GithubRepository"
  ADD CONSTRAINT "GithubRepository_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GithubRepository"
  ADD CONSTRAINT "GithubRepository_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "Program"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GithubRepository"
  ADD CONSTRAINT "GithubRepository_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 7) 인덱스. applicationId unique는 옛 Repository.applicationId unique 계약을 그대로 잇는다.
CREATE UNIQUE INDEX "GithubRepository_applicationId_key" ON "GithubRepository"("applicationId");
CREATE INDEX "GithubRepository_programId_idx" ON "GithubRepository"("programId");
CREATE INDEX "GithubRepository_teamId_idx" ON "GithubRepository"("teamId");
-- todo 16 — `GET /projects` 목록 커서 페이지네이션(publishedAt desc, id desc)이 이 인덱스를 쓴다.
CREATE INDEX "GithubRepository_visibility_publishedAt_id_idx" ON "GithubRepository"("visibility", "publishedAt", "id");
