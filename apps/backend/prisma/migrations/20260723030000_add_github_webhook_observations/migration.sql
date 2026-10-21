CREATE TYPE "GithubWebhookObservationOutcome" AS ENUM (
    'ACCEPTED',
    'DUPLICATE',
    'IGNORED',
    'FAILED'
);

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

CREATE INDEX "GithubWebhookObservation_deliveryId_idx"
ON "GithubWebhookObservation"("deliveryId");

CREATE INDEX "GithubWebhookObservation_receivedAt_idx"
ON "GithubWebhookObservation"("receivedAt");

CREATE INDEX "GithubWebhookObservation_outcome_receivedAt_idx"
ON "GithubWebhookObservation"("outcome", "receivedAt");
