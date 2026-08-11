-- ADR-010 §4 — 기여 추적의 유일한 사실 테이블.
--
-- 한 행 = "이 저장소에서 이 사람이 이 날 남긴 기여".
-- grain 을 이름에 넣지 않는다. 이름은 `Contribution` 이고 grain 은 기본키가 정의한다 —
-- 앞선 `*YearAggregate` 는 grain 을 이름에 박았다가 grain 이 바뀌자 이름이 거짓말이 됐다.
--
-- `date` 는 DATE 다. 저장에 연도 개념이 없으므로 새해에 롤오버 작업이 필요 없고,
-- 읽을 때 범위로만 자른다. 연도로 접으면 랭킹이, 저장소로 접으면 팀 기여도가 나온다.
--
-- 이 마이그레이션은 **추가만 한다.** 옛 집계 테이블과 writer 는 그대로 두며,
-- 읽기 전환이 끝난 뒤 별도 PR 이 드롭한다(확장 → 재수집 → 읽기 전환 → 드롭).

-- CreateTable
CREATE TABLE "Contribution" (
    "repositoryId" TEXT NOT NULL,
    "githubId" BIGINT NOT NULL,
    "date" DATE NOT NULL,
    "commitCount" INTEGER NOT NULL DEFAULT 0,
    "pullRequestCount" INTEGER NOT NULL DEFAULT 0,
    "releaseCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contribution_pkey" PRIMARY KEY ("repositoryId","githubId","date")
);

-- CreateIndex
-- 두 축을 각각 받친다. 저장소 축(팀 기여도)은 기본키 선두가 커버하고,
-- 사람 축(랭킹·프로필처럼 githubId 로 시작하는 조회)은 아래 복합 인덱스가 받는다.
CREATE INDEX "Contribution_githubId_date_idx" ON "Contribution"("githubId", "date");
CREATE INDEX "Contribution_date_idx" ON "Contribution"("date");

-- AddForeignKey
-- 저장소가 사라지면 그 기여도 함께 사라진다. Contribution 은 GithubRepository
-- aggregate 내부 entity 이지 독립 aggregate 가 아니다.
ALTER TABLE "Contribution"
  ADD CONSTRAINT "Contribution_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "GithubRepository"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
