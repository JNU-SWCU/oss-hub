-- 사람 축 활동 이력 — data-modeling.md §2 `user ↔ yearly activity history`.
--
-- 한 행 = "이 GitHub 계정이 이 해에 얼마나 활동했는가". 저장소 축(`Contribution`)과
-- 묻는 질문이 달라 키가 다르다 — 이쪽에는 `repositoryId`가 없다. 축이 다르면 합치지 않는다(§2).
--
-- 연도 축을 따라 행이 쌓이므로 이름이 `History`로 끝난다(§4 · `LoginHistory` 선례).
-- 당해 연도 행은 관측할 때마다 전량 재계산으로 덮어쓰고, 지난 연도 행은 그대로 둔다.
--
-- `User` FK를 걸지 않는다(§3). `githubId` 값으로 키를 잡고 `githubLogin`만 비정규화해
-- 행 하나로 공개 표시가 끝난다 — 미가입 기여자가 조용히 사라지지 않고, 공개 응답이
-- private 원본과 join할 구조적 여지도 만들지 않는다(루트 AGENTS.md §4).
-- 실명·학과는 담지 않는다(조회 시점 join).
--
-- 이 마이그레이션은 **추가만 한다.** 기존 테이블·데이터를 건드리지 않는다.

-- CreateTable
CREATE TABLE "GithubUserActivityHistory" (
    "githubId" BIGINT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "commitCount" INTEGER NOT NULL DEFAULT 0,
    "pullRequestCount" INTEGER NOT NULL DEFAULT 0,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "repositoryCount" INTEGER NOT NULL DEFAULT 0,
    "starCount" INTEGER NOT NULL DEFAULT 0,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubUserActivityHistory_pkey" PRIMARY KEY ("githubId","year")
);

-- CreateIndex
-- 랭킹 조회는 언제나 연도로 먼저 자른다.
CREATE INDEX "GithubUserActivityHistory_year_idx" ON "GithubUserActivityHistory"("year");
