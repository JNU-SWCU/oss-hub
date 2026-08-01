CREATE TABLE "CollectionCutoverLease" (
  "appId" BIGINT NOT NULL,
  "organizationLogin" TEXT NOT NULL,
  "epoch" BIGINT NOT NULL DEFAULT 1,
  "ownerId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CollectionCutoverLease_pkey" PRIMARY KEY ("appId", "organizationLogin")
);
