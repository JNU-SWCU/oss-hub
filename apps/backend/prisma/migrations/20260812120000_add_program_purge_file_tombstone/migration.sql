-- Program purge는 트랜잭션에서 객체 키를 이 tombstone으로 옮기고,
-- 실제 storage 삭제는 worker가 후속 수행한다. 기존 FK의 Cascade 동작은 바꾸지 않는다.
CREATE TYPE "ProgramPurgeFileTombstoneLifecycle" AS ENUM ('DELETE_PENDING', 'DELETED');

CREATE TABLE "ProgramPurgeFileTombstone" (
    "id" TEXT NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "lifecycle" "ProgramPurgeFileTombstoneLifecycle" NOT NULL DEFAULT 'DELETE_PENDING',
    "deleteClaimedAt" TIMESTAMP(3),
    "deleteClaimExpiresAt" TIMESTAMP(3),
    "deleteClaimOwner" VARCHAR(128),
    "deleteAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextDeleteAttemptAt" TIMESTAMP(3),
    "lastDeleteError" VARCHAR(64),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramPurgeFileTombstone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgramPurgeFileTombstone_storageKey_key"
ON "ProgramPurgeFileTombstone"("storageKey");

CREATE INDEX "ProgramPurgeFileTombstone_lifecycle_nextDeleteAttemptAt_deleteClaimExpiresAt_idx"
ON "ProgramPurgeFileTombstone"("lifecycle", "nextDeleteAttemptAt", "deleteClaimExpiresAt");

ALTER TABLE "ProgramPurgeFileTombstone"
ADD CONSTRAINT "ProgramPurgeFileTombstone_delete_attempt_count_check"
CHECK ("deleteAttemptCount" BETWEEN 0 AND 6) NOT VALID;

ALTER TABLE "ProgramPurgeFileTombstone"
ADD CONSTRAINT "ProgramPurgeFileTombstone_deleted_at_check"
CHECK (("lifecycle" = 'DELETED') = ("deletedAt" IS NOT NULL)) NOT VALID;
