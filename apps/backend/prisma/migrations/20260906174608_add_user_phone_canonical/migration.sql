
ALTER TABLE "User" ADD COLUMN "phone" TEXT;

ALTER TABLE "TeamMember" DROP COLUMN "phone";

ALTER TABLE "User"
  ADD CONSTRAINT "User_phone_digits_check"
  CHECK ("phone" IS NULL OR "phone" ~ '^[0-9]{10,11}$');
