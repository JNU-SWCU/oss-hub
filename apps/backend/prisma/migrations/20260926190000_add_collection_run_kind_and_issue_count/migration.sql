
CREATE TYPE "CollectionRunKind" AS ENUM ('SWEEP', 'REPOSITORY_LINK');

ALTER TABLE "CollectionSweepHistory" ADD COLUMN     "insertedIssueCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kind" "CollectionRunKind" NOT NULL DEFAULT 'SWEEP';
