-- #164 코어 스키마 불변식 보강 — 마이그1(#109)·마이그2(#113) 위에 직렬로 적용한다.
-- partial unique·CHECK는 Prisma schema로 표현할 수 없어 이 SQL이 원본이다.

-- [1/5] Team.joinCode 평문을 제거하고 joinCodeDigest로 전환한다.
-- 기존 참여코드는 secret 없이 HMAC으로 안전하게 옮길 수 없으므로 즉시 무효화한다. 새 값은 기존
-- 평문과 무관한 64자 토큰이며, 시드·향후 합류 API가 HMAC-SHA-256 값으로 갱신한다.
ALTER TABLE "Team" ADD COLUMN "joinCodeDigest" TEXT;

UPDATE "Team"
SET "joinCodeDigest" =
  md5('join-code-invalidated:1:' || "id") ||
  md5('join-code-invalidated:2:' || "id");

ALTER TABLE "Team" ALTER COLUMN "joinCodeDigest" SET NOT NULL;

CREATE UNIQUE INDEX "Team_joinCodeDigest_key" ON "Team"("joinCodeDigest");

DROP INDEX "Team_joinCode_key";

ALTER TABLE "Team" DROP COLUMN "joinCode";

-- [2/5] TeamMember.programId를 Team에서 backfill한 뒤 NOT NULL로 잠근다.
ALTER TABLE "TeamMember" ADD COLUMN "programId" TEXT;

UPDATE "TeamMember"
SET "programId" = "Team"."programId"
FROM "Team"
WHERE "TeamMember"."teamId" = "Team"."id";

ALTER TABLE "TeamMember" ALTER COLUMN "programId" SET NOT NULL;

CREATE UNIQUE INDEX "Team_id_programId_key" ON "Team"("id", "programId");

ALTER TABLE "TeamMember" DROP CONSTRAINT "TeamMember_teamId_fkey";

ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_programId_fkey"
FOREIGN KEY ("teamId", "programId") REFERENCES "Team"("id", "programId")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "TeamMember_programId_userId_key"
ON "TeamMember"("programId", "userId");

-- [3/5] 개인·팀 신청 중복을 DB 경계에서 방지한다.
CREATE UNIQUE INDEX "Application_programId_applicantId_personal_key"
ON "Application"("programId", "applicantId") WHERE "teamId" IS NULL;

CREATE UNIQUE INDEX "Application_programId_teamId_team_key"
ON "Application"("programId", "teamId") WHERE "teamId" IS NOT NULL;

-- [4/5] 사용자당 활성 교직원 역할 요청은 한 건만 허용한다.
CREATE UNIQUE INDEX "RoleRequest_userId_pending_key"
ON "RoleRequest"("userId") WHERE "status" = 'PENDING';

-- [5/5] NULL 피연산자는 CHECK를 통과하므로 개인형 프로그램의 nullable 인원은 유지된다.
ALTER TABLE "Program" ADD CONSTRAINT "Program_applicationWindow_check"
CHECK ("applicationStartAt" <= "applicationEndAt");

ALTER TABLE "Program" ADD CONSTRAINT "Program_teamMinSize_check"
CHECK ("teamMinSize" >= 1);

ALTER TABLE "Program" ADD CONSTRAINT "Program_teamSizeRange_check"
CHECK ("teamMinSize" <= "teamMaxSize");
