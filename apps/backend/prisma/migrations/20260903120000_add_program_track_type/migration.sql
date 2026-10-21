CREATE TYPE "ProgramTrackType" AS ENUM ('CURRICULAR', 'EXTRACURRICULAR');

ALTER TABLE "Program" ADD COLUMN "trackType" "ProgramTrackType";
