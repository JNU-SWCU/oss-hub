-- Public-safe allowlist projection for #126/#134. Public queries must not join private source tables.
CREATE TABLE "PublicShowcaseRepository" (
    "repositoryId" TEXT NOT NULL,
    "githubRepositoryId" BIGINT NOT NULL,
    "repositoryName" TEXT NOT NULL,
    "repositoryUrl" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "programId" TEXT NOT NULL,
    "programName" TEXT NOT NULL,
    "programCategory" "ProgramCategory" NOT NULL,
    "programEndAt" TIMESTAMP(3) NOT NULL,
    "teamName" TEXT,
    "displayName" TEXT NOT NULL,
    "approvedSubmissionCount" INTEGER NOT NULL,
    "projectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicShowcaseRepository_pkey" PRIMARY KEY ("repositoryId")
);

CREATE TABLE "PublicShowcaseContributor" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "githubNickname" TEXT NOT NULL,
    "avatarUrl" TEXT,

    CONSTRAINT "PublicShowcaseContributor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicShowcaseRepository_githubRepositoryId_key" ON "PublicShowcaseRepository"("githubRepositoryId");
CREATE INDEX "PublicShowcaseRepository_programId_idx" ON "PublicShowcaseRepository"("programId");
CREATE UNIQUE INDEX "PublicShowcaseContributor_repositoryId_userId_key" ON "PublicShowcaseContributor"("repositoryId", "userId");
CREATE INDEX "PublicShowcaseContributor_userId_idx" ON "PublicShowcaseContributor"("userId");

ALTER TABLE "PublicShowcaseContributor" ADD CONSTRAINT "PublicShowcaseContributor_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "PublicShowcaseRepository"("repositoryId") ON DELETE CASCADE ON UPDATE CASCADE;
