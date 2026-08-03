-- Additive lifecycle state; existing programs remain publicly published.
CREATE TYPE "ProgramLifecycle" AS ENUM ('PUBLISHED', 'ARCHIVED');

ALTER TABLE "Program"
ADD COLUMN "lifecycle" "ProgramLifecycle" NOT NULL DEFAULT 'PUBLISHED';
