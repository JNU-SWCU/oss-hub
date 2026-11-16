ALTER TABLE "Program" ADD COLUMN "organizers" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "Program" SET "organizers" = ARRAY[btrim("organizer")] WHERE btrim("organizer") <> '';

ALTER TABLE "Program" DROP COLUMN "organizer";
