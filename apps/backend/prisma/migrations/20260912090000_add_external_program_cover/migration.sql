CREATE TYPE "ProgramCoverSource" AS ENUM ('OWNED', 'EXTERNAL');

ALTER TABLE "ProgramCover"
    ADD COLUMN "source" "ProgramCoverSource" NOT NULL DEFAULT 'OWNED',
    ADD COLUMN "sourceUrl" VARCHAR(2048),
    ADD COLUMN "imageUrl" VARCHAR(2048),
    ALTER COLUMN "storageKey" DROP NOT NULL,
    ALTER COLUMN "mimeType" DROP NOT NULL,
    ALTER COLUMN "sizeBytes" DROP NOT NULL;

ALTER TABLE "ProgramCover" ADD CONSTRAINT "ProgramCover_source_fields_check"
    CHECK (
      ("source" = 'OWNED' AND "storageKey" IS NOT NULL AND "mimeType" IS NOT NULL
        AND "sizeBytes" IS NOT NULL AND "sourceUrl" IS NULL AND "imageUrl" IS NULL)
      OR
      ("source" = 'EXTERNAL' AND "storageKey" IS NULL AND "mimeType" IS NULL
        AND "sizeBytes" IS NULL AND "sourceUrl" IS NOT NULL AND "imageUrl" IS NOT NULL
        AND "sourceUrl" LIKE 'https://sojoong.kr/notice/notice-board/?%'
        AND "imageUrl" LIKE 'https://sojoong.kr/wp-content/uploads/%')
    );
