-- 시스템 상태 관측성 2단계 — sweep 1회 종료 시점의 수집 활동 이력을 append-only로 남긴다.
--
-- 한 행 = "이 appId+scope sweep이 이 시각에 끝났을 때의 결과". 사이클(cycle)이 아니라
-- sweep이 grain이다 — 예산 초과로 중단된 사이클은 여러 sweep에 걸쳐 이어질 수 있어서,
-- 사이클 단위로 행을 잡으면 진행 중인 사이클의 중간 상태를 표현할 자리가 없다.
--
-- `CollectionSyncCursor`(appId+scope 프로세스 키, 같은 sweep 운영 bookkeeping 목적)를
-- 선례로 삼아 `data-modeling.md` §4의 두 모델링 축(user↔repository, repository↔history)
-- 밖에 있는 예외로 둔다. repositoryId/repository 이름은 담지 않는다 — 집계 전용이다.

-- CreateTable
CREATE TABLE "CollectionSweepHistory" (
    "id" TEXT NOT NULL,
    "appId" BIGINT NOT NULL,
    "scope" TEXT NOT NULL,
    "sweepFinishedAt" TIMESTAMP(3) NOT NULL,
    "cycleStartedAt" TIMESTAMP(3),
    "insertedCommitCount" INTEGER NOT NULL,
    "insertedPullRequestCount" INTEGER NOT NULL,
    "insertedReleaseCount" INTEGER NOT NULL,
    "attemptedRepositoryCount" INTEGER NOT NULL,
    "processedRepositoryCount" INTEGER NOT NULL,
    "failedRepositoryCount" INTEGER NOT NULL,
    "cycleCompleted" BOOLEAN NOT NULL,
    "stoppedForBudget" BOOLEAN NOT NULL,

    CONSTRAINT "CollectionSweepHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- system-status가 "최근 sweep 20건"을 sweepFinishedAt desc로 읽는 유일한 조회 경로다.
CREATE INDEX "CollectionSweepHistory_sweepFinishedAt_idx" ON "CollectionSweepHistory"("sweepFinishedAt");
