CREATE TYPE "RepositoryConnectionMode" AS ENUM ('NEW', 'OWN');

ALTER TABLE "Application"
ADD COLUMN "repositoryConnectionMode" "RepositoryConnectionMode" NOT NULL DEFAULT 'NEW',
ADD COLUMN "repositoryUrl" TEXT;
