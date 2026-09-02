BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "Milestone"
  ALTER COLUMN "submissionType" DROP NOT NULL;

CREATE TYPE "MilestoneDocumentSubmissionHistoryEvent" AS ENUM (
  'SUBMITTED',
  'RESUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED'
);

CREATE TABLE "MilestoneDocumentSubmissionHistory" (
  "id" TEXT NOT NULL,
  "milestoneDocumentSubmissionId" TEXT NOT NULL,
  "event" "MilestoneDocumentSubmissionHistoryEvent" NOT NULL,
  "revision" INTEGER,
  "content" JSONB,
  "comment" TEXT,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MilestoneDocumentSubmissionHistory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SubmissionFile"
  ADD COLUMN "milestoneDocumentSubmissionHistoryId" TEXT;

ALTER TABLE "MilestoneDocumentReviewHistory"
  ADD COLUMN "submissionHistoryId" TEXT;

CREATE INDEX "MilestoneDocumentSubmissionHistory_milestoneDocumentSubmissionId_createdAt_idx"
  ON "MilestoneDocumentSubmissionHistory"("milestoneDocumentSubmissionId", "createdAt");
CREATE INDEX "MilestoneDocumentSubmissionHistory_actorId_idx"
  ON "MilestoneDocumentSubmissionHistory"("actorId");
CREATE INDEX "SubmissionFile_milestoneDocumentSubmissionHistoryId_idx"
  ON "SubmissionFile"("milestoneDocumentSubmissionHistoryId");
CREATE INDEX "MilestoneDocumentReviewHistory_submissionHistoryId_idx"
  ON "MilestoneDocumentReviewHistory"("submissionHistoryId");

ALTER TABLE "MilestoneDocumentSubmissionHistory"
  ADD CONSTRAINT "MilestoneDocumentSubmissionHistory_submissionId_fkey"
  FOREIGN KEY ("milestoneDocumentSubmissionId")
  REFERENCES "MilestoneDocumentSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MilestoneDocumentSubmissionHistory"
  ADD CONSTRAINT "MilestoneDocumentSubmissionHistory_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubmissionFile"
  ADD CONSTRAINT "SubmissionFile_submissionHistoryId_fkey"
  FOREIGN KEY ("milestoneDocumentSubmissionHistoryId")
  REFERENCES "MilestoneDocumentSubmissionHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MilestoneDocumentReviewHistory"
  ADD CONSTRAINT "MilestoneDocumentReviewHistory_submissionHistoryId_fkey"
  FOREIGN KEY ("submissionHistoryId")
  REFERENCES "MilestoneDocumentSubmissionHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 파일이 둘 이상이면 어느 것이 현재 revision인지 스키마만으로 증명할 수 없다.
-- 이 경우 일부만 옮겨 원래 열리던 파일을 숨기지 말고, 변경 전 상태 그대로
-- 트랜잭션 전체를 중단해 운영 행 단위 대조를 요구한다.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SubmissionFile"
    WHERE "milestoneDocumentSubmissionId" IS NOT NULL
      AND "lifecycle" = 'ATTACHED'
    GROUP BY "milestoneDocumentSubmissionId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'ambiguous milestone document files require row-level reconciliation';
  END IF;
END
$migration$;

-- 현재 헤더가 증명하는 최신 snapshot만 옮긴다. 과거 revision·판정의 연결은 추정하지 않는다.
INSERT INTO "MilestoneDocumentSubmissionHistory" (
  "id",
  "milestoneDocumentSubmissionId",
  "event",
  "revision",
  "content",
  "actorId",
  "createdAt"
)
SELECT
  CONCAT('legacy_', MD5(submission."id")),
  submission."id",
  CASE
    WHEN submission."revision" = 1 THEN 'SUBMITTED'::"MilestoneDocumentSubmissionHistoryEvent"
    ELSE 'RESUBMITTED'::"MilestoneDocumentSubmissionHistoryEvent"
  END,
  submission."revision",
  submission."content",
  submission."submittedById",
  submission."submittedAt"
FROM "MilestoneDocumentSubmission" AS submission;

-- 기존 판정도 새 이력 화면에서 사라지지 않도록 사건 원장에 옮긴다. 당시 어느 제출 차수를
-- 검토했는지는 기존 스키마가 기록하지 않았으므로 revision은 추정하지 않고 NULL로 둔다.
INSERT INTO "MilestoneDocumentSubmissionHistory" (
  "id",
  "milestoneDocumentSubmissionId",
  "event",
  "revision",
  "comment",
  "actorId",
  "createdAt"
)
SELECT
  CONCAT('legacy_review_', MD5(review."id")),
  review."milestoneDocumentSubmissionId",
  review."decision"::TEXT::"MilestoneDocumentSubmissionHistoryEvent",
  NULL,
  review."comment",
  review."reviewerId",
  review."reviewedAt"
FROM "MilestoneDocumentReviewHistory" AS review;

-- 현재 header에 ATTACHED 파일이 딱 하나인 경우만 최신 snapshot으로 연결한다.
-- 둘 이상인 행은 위 preflight가 트랜잭션 전체를 이미 중단했으므로, 이 UPDATE가
-- 실행될 때는 단일 파일인 행만 존재한다. 모호한 행을 NULL로 남겨 조용히 넘기지 않는다.
WITH "UnambiguousAttachedFile" AS (
  SELECT "milestoneDocumentSubmissionId"
  FROM "SubmissionFile"
  WHERE "milestoneDocumentSubmissionId" IS NOT NULL
    AND "lifecycle" = 'ATTACHED'
  GROUP BY "milestoneDocumentSubmissionId"
  HAVING COUNT(*) = 1
)
UPDATE "SubmissionFile" AS file
SET "milestoneDocumentSubmissionHistoryId" = CONCAT(
  'legacy_',
  MD5(file."milestoneDocumentSubmissionId")
)
FROM "UnambiguousAttachedFile" AS unambiguous
WHERE file."milestoneDocumentSubmissionId" = unambiguous."milestoneDocumentSubmissionId"
  AND file."lifecycle" = 'ATTACHED';

ALTER TABLE "MilestoneDocument"
  DROP COLUMN "submissionType";

COMMIT;
