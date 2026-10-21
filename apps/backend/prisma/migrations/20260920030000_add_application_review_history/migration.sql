
CREATE TYPE "ApplicationReviewEventKind" AS ENUM ('SUBMITTED', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'REVERTED');

ALTER TABLE "Application" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "ApplicationReviewHistory" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "eventKind" "ApplicationReviewEventKind" NOT NULL,
    "revision" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejectionReason" TEXT,

    CONSTRAINT "ApplicationReviewHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApplicationReviewHistory_applicationId_occurredAt_idx" ON "ApplicationReviewHistory"("applicationId", "occurredAt");

CREATE INDEX "ApplicationReviewHistory_actorId_idx" ON "ApplicationReviewHistory"("actorId");

ALTER TABLE "ApplicationReviewHistory" ADD CONSTRAINT "ApplicationReviewHistory_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApplicationReviewHistory" ADD CONSTRAINT "ApplicationReviewHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
