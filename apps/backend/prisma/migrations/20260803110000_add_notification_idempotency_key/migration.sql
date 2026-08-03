ALTER TABLE "Notification" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Notification_idempotencyKey_key" ON "Notification"("idempotencyKey");
