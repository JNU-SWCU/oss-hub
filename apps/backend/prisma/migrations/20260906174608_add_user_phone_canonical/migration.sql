-- Add the canonical nullable user phone field and remove the unused team-member copy.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "phone" TEXT;

-- AlterTable
ALTER TABLE "TeamMember" DROP COLUMN "phone";

-- CheckConstraint
ALTER TABLE "User"
  ADD CONSTRAINT "User_phone_digits_check"
  CHECK ("phone" IS NULL OR "phone" ~ '^[0-9]{10,11}$');
