-- #177 Org 전체 저장소의 canonical identity와 최소 파생 metric 이력을 추가한다.
-- 기존 Repository·CollectionRun·GithubRawObservation 계약은 변경하지 않는다.

CREATE TABLE "OrgRepositoryInventory" (
    "id" TEXT NOT NULL,
    "githubRepositoryId" BIGINT NOT NULL,
    "fullName" TEXT NOT NULL,
    "visibility" "RepositoryVisibility" NOT NULL,
    "archived" BOOLEAN NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repositoryId" TEXT,

    CONSTRAINT "OrgRepositoryInventory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrgRepositoryActivityEvent" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "commitDelta" INTEGER NOT NULL DEFAULT 0,
    "pullRequestDelta" INTEGER NOT NULL DEFAULT 0,
    "starDelta" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrgRepositoryActivityEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrgRepositoryInventory_githubRepositoryId_key"
ON "OrgRepositoryInventory"("githubRepositoryId");

CREATE UNIQUE INDEX "OrgRepositoryInventory_repositoryId_key"
ON "OrgRepositoryInventory"("repositoryId");

CREATE UNIQUE INDEX "OrgRepositoryActivityEvent_deliveryId_key"
ON "OrgRepositoryActivityEvent"("deliveryId");

CREATE UNIQUE INDEX "OrgRepositoryActivityEvent_dedupeKey_key"
ON "OrgRepositoryActivityEvent"("dedupeKey");

CREATE INDEX "OrgRepositoryActivityEvent_inventoryId_occurredAt_idx"
ON "OrgRepositoryActivityEvent"("inventoryId", "occurredAt");

ALTER TABLE "OrgRepositoryInventory"
ADD CONSTRAINT "OrgRepositoryInventory_repositoryId_fkey"
FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrgRepositoryActivityEvent"
ADD CONSTRAINT "OrgRepositoryActivityEvent_inventoryId_fkey"
FOREIGN KEY ("inventoryId") REFERENCES "OrgRepositoryInventory"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
