
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

CREATE INDEX "Contribution_githubId_date_idx" ON "Contribution"("githubId", "date");
CREATE INDEX "Contribution_date_idx" ON "Contribution"("date");

ALTER TABLE "Contribution"
  ADD CONSTRAINT "Contribution_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "GithubRepository"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
