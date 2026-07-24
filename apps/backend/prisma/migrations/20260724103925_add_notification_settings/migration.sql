-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "notifyOnDeadline" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationEmail" TEXT,
ADD COLUMN     "notifyEnabled" BOOLEAN NOT NULL DEFAULT true;
