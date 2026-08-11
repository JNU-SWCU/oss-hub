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
--    주의: 쓰기 시점 검증이 url의 canonical 형태를 보장한다는 가정은 틀렸다 — OWN 모드는
--    resolveOwnGithubRepository(repository-provision.github.ts:59,76)가 학생이 입력한 URL
--    문자열을 그대로(verbatim) 저장한다. parseGithubRepositoryUrl은 파싱된 URL 객체만
--    검증하고 원본 문자열을 canonical 형태로 되쓰지 않으므로, host 대소문자 차이(URL
--    파서는 hostname만 소문자로 정규화하고 원본 문자열은 그대로 둔다)와 pathname 트레일링
--    슬래시가 저장된 문자열에 그대로 남을 수 있다. isValidSucceededRepositoryIdentity
--    (repositories.service.ts)도 읽기 시점에만 재검증할 뿐 쓰기 시점 강제가 아니다.
--    따라서 prefix 제거를 대소문자 무시 + http/https 허용 + 선택적 www.로 넓히고
--    트레일링 슬래시를 제거한 뒤, 정규화 후에도 owner/name 형태(슬래시 하나로 나뉘는
--    두 비공백 세그먼트)가 아닌 행이 있으면 아래 가드가 마이그레이션을 중단시킨다.
--    (2026-08-12 프로덕션 감사: Repository 1행, 비canonical 0행 — 이 가드는 현재 위반을
--    고치는 게 아니라 향후 회귀를 막는 방어 장치다.)
DO $$
DECLARE
  bad_id TEXT;
  bad_url TEXT;
BEGIN
  SELECT r."id", r."url" INTO bad_id, bad_url
  FROM "Repository" r
  WHERE NOT EXISTS (
    SELECT 1 FROM "GithubRepository" g WHERE g."githubRepositoryId" = r."githubRepositoryId"
  )
  AND regexp_replace(
        regexp_replace(r."url", '^https?://(www\.)?github\.com/', '', 'i'),
        '/+$', ''
      ) !~ '^[^/]+/[^/]+$'
  LIMIT 1;

  IF bad_id IS NOT NULL THEN
    RAISE EXCEPTION 'unify-repository-into-github-repository 마이그레이션 중단: Repository.id=% 의 url=% 이 정규화 후에도 canonical owner/name 형태가 아니다', bad_id, bad_url;
  END IF;
END $$;

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
  regexp_replace(
    regexp_replace(r."url", '^https?://(www\.)?github\.com/', '', 'i'),
    '/+$', ''
  ),
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
