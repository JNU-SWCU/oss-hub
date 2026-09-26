-- 팀 저장소의 「팀원이 아닌 사람의 기여」 합계(#1133 후속)를 담는 표를 추가한다.
--
-- 전부 additive다 — 기존 표·컬럼을 바꾸지 않으므로 이 마이그레이션이 배포된 뒤에도 직전 이미지가
-- 그대로 동작한다. 저장소마다 한 행이며, 팀 저장소를 수집할 때마다 덮어쓴다. 누가 했는지는 담지
-- 않는다(Commit·PR·Issue 수와 센 기준 프로그램·기간만). 과거 값은 따로 채우지 않는다 — 배포 뒤
-- 첫 정시 수집이 팀 저장소마다 한 행씩 만든다.
--
-- 이 파일은 `prisma migrate diff`(직전 커밋 schema → 현재 schema)로 생성했다
-- (`20260924090000_add_github_issue_history`와 같은 처리).

-- CreateTable
CREATE TABLE "GithubRepositoryOutsiderContribution" (
    "repositoryId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "windowStartAt" TIMESTAMP(3) NOT NULL,
    "windowEndAt" TIMESTAMP(3) NOT NULL,
    "commitCount" INTEGER NOT NULL,
    "pullRequestCount" INTEGER NOT NULL,
    "issueCount" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubRepositoryOutsiderContribution_pkey" PRIMARY KEY ("repositoryId")
);

-- AddForeignKey
ALTER TABLE "GithubRepositoryOutsiderContribution" ADD CONSTRAINT "GithubRepositoryOutsiderContribution_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "GithubRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
