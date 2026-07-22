-- CreateEnum
CREATE TYPE "GithubWebhookObservationOutcome" AS ENUM (
    'ACCEPTED',
    'DUPLICATE',
    'IGNORED',
    'FAILED'
);

-- CreateTable
CREATE TABLE "GithubWebhookObservation" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "GithubWebhookObservationOutcome" NOT NULL,
    "errorCode" TEXT,

    CONSTRAINT "GithubWebhookObservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GithubWebhookObservation_errorCode_check" CHECK (
        ("outcome" = 'FAILED' AND "errorCode" IS NOT NULL)
        OR ("outcome" <> 'FAILED' AND "errorCode" IS NULL)
    )
);

-- CreateIndex: deliveryId is intentionally not unique because every retry is observed.
CREATE INDEX "GithubWebhookObservation_deliveryId_idx"
ON "GithubWebhookObservation"("deliveryId");

-- CreateIndex
CREATE INDEX "GithubWebhookObservation_receivedAt_idx"
ON "GithubWebhookObservation"("receivedAt");

-- CreateIndex
CREATE INDEX "GithubWebhookObservation_outcome_receivedAt_idx"
ON "GithubWebhookObservation"("outcome", "receivedAt");
