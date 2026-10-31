CREATE TYPE "ActivityVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

ALTER TABLE "GithubUserActivityHistory"
ADD COLUMN "visibility" "ActivityVisibility" NOT NULL DEFAULT 'PUBLIC';

ALTER TABLE "GithubUserActivityHistory"
DROP CONSTRAINT "GithubUserActivityHistory_pkey",
ADD CONSTRAINT "GithubUserActivityHistory_pkey" PRIMARY KEY ("githubId", "year", "visibility");
