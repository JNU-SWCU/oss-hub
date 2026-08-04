BEGIN;

-- D5: 모든 신청이 Team을 갖는다. 개인 참여는 멤버 1명인 팀이다.
--
-- 한 번에 적용한다. 예전에는 구조 변경 → Node 백필 → SET NOT NULL 3단으로 나눴는데,
-- 그건 기존 `teamId IS NULL` 신청을 살리려는 절차였다. `Team.joinCodeDigest`가
-- 런타임 시크릿 기반 HMAC이라 SQL에서 만들 수 없어 백필이 필요했던 것이다.
-- 이 릴리스는 스키마를 새로 만들고 배포하므로 살릴 레거시 행이 없다.
--
-- 그래도 fail-closed 가드는 남긴다. 데이터가 있는 DB에 잘못 적용되면
-- 조용히 깨지는 대신 여기서 멈추고, 운영자가 드롭 후 재생성을 선택하게 한다.

DO $$
DECLARE
  legacy_null_team_count BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO legacy_null_team_count
  FROM "Application"
  WHERE "teamId" IS NULL;

  IF legacy_null_team_count > 0 THEN
    RAISE EXCEPTION
      'Application.teamId NOT NULL blocked: % legacy application row(s) have teamId NULL',
      legacy_null_team_count
      USING ERRCODE = 'check_violation',
            HINT = 'This release assumes a schema created from scratch. Recreate the database (see docs/deploy/server-runbook.md M11) and redeploy.';
  END IF;
END
$$;

-- 개인/팀 partial unique 두 개를 (programId, teamId) full unique 하나로 대체한다.
-- `WHERE teamId IS NULL` 조건은 teamId가 NOT NULL이 되는 순간 항상 거짓이라
-- 그대로 두면 중복 신청 방지가 조용히 죽는다.
-- 중복 방지 근거는 TeamMember @@unique([programId, userId]) × 팀당 신청 1건으로 옮긴다.
DROP INDEX "Application_programId_applicantId_personal_key";
DROP INDEX "Application_programId_teamId_team_key";

CREATE UNIQUE INDEX "Application_programId_teamId_key"
ON "Application"("programId", "teamId");

-- NOT NULL teamId는 ON DELETE SET NULL을 유지할 수 없다 — 삭제 시 런타임에 터진다.
-- 팀 삭제를 거부하는 쪽이 맞다.
ALTER TABLE "Application" DROP CONSTRAINT "Application_teamId_fkey";

ALTER TABLE "Application"
ADD CONSTRAINT "Application_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Application" ALTER COLUMN "teamId" SET NOT NULL;

COMMIT;
