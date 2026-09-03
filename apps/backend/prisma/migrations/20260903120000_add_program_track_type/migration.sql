-- CreateEnum
CREATE TYPE "ProgramTrackType" AS ENUM ('CURRICULAR', 'EXTRACURRICULAR');

-- AlterTable
ALTER TABLE "Program" ADD COLUMN "trackType" "ProgramTrackType";
