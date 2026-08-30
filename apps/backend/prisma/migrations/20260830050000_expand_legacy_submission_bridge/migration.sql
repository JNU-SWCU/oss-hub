-- #1034 expand 단계: 옛 마일스톤 단일 제출을 신규 사건 원장으로 복사하기 전에
-- 내부 슬롯과 provenance, SubmissionFile 공존 상태만 연다.
-- 이 migration은 데이터를 복사·수정·삭제하지 않는다. 기존 image는 추가 nullable/default
-- 컬럼을 무시하고 계속 레거시 테이블을 정본으로 쓸 수 있어 bridge 전 롤백이 가능하다.
BEGIN;

CREATE TYPE "MilestoneDocumentKind" AS ENUM (
  'DOCUMENT',
  'LEGACY_MILESTONE_SUBMISSION'
);

ALTER TABLE "MilestoneDocument"
  ADD COLUMN "kind" "MilestoneDocumentKind" NOT NULL DEFAULT 'DOCUMENT';

ALTER TABLE "MilestoneDocumentSubmission"
  ADD COLUMN "legacySubmissionId" TEXT;

CREATE UNIQUE INDEX "MilestoneDocumentSubmission_legacySubmissionId_key"
  ON "MilestoneDocumentSubmission"("legacySubmissionId");

-- 내부 레거시 슬롯은 마일스톤마다 하나뿐이다. 일반 DOCUMENT는 기존처럼 여러 개다.
CREATE UNIQUE INDEX "MilestoneDocument_one_legacy_submission_slot_key"
  ON "MilestoneDocument"("milestoneId")
  WHERE "kind" = 'LEGACY_MILESTONE_SUBMISSION';

-- bridge는 같은 물리 파일 행에 source revision과 target header/history provenance를 함께
-- 연결한다. contract가 source FK를 제거할 때 이 CHECK도 target-only 계약으로 다시 좁힌다.
ALTER TABLE "SubmissionFile"
  DROP CONSTRAINT "SubmissionFile_lifecycle_attachment_check";

ALTER TABLE "SubmissionFile"
  ADD CONSTRAINT "SubmissionFile_lifecycle_attachment_check" CHECK (
    (
      "lifecycle" = 'PENDING'
      AND "applicationId" IS NOT NULL
      AND "milestoneId" IS NOT NULL
      AND "submissionRevisionId" IS NULL
      AND "milestoneDocumentSubmissionId" IS NULL
      AND "milestoneDocumentSubmissionHistoryId" IS NULL
      AND "pendingExpiresAt" IS NOT NULL
      AND "expiresAt" IS NOT NULL
    )
    OR
    (
      "lifecycle" = 'ATTACHED'
      AND "applicationId" IS NOT NULL
      AND "milestoneId" IS NOT NULL
      AND "pendingExpiresAt" IS NULL
      AND (
        (
          "submissionRevisionId" IS NOT NULL
          AND "milestoneDocumentSubmissionId" IS NULL
          AND "milestoneDocumentSubmissionHistoryId" IS NULL
        )
        OR
        (
          "submissionRevisionId" IS NOT NULL
          AND "milestoneDocumentSubmissionId" IS NOT NULL
          AND "milestoneDocumentSubmissionHistoryId" IS NOT NULL
        )
        OR
        (
          "submissionRevisionId" IS NULL
          AND "milestoneDocumentSubmissionId" IS NOT NULL
          AND "milestoneDocumentSubmissionHistoryId" IS NOT NULL
        )
      )
    )
    OR "lifecycle" IN ('DELETE_PENDING', 'DELETED')
  );

COMMIT;
