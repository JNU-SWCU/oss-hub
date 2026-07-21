-- 계정 생명주기를 역할과 분리한다. 기존 사용자는 모두 활성 상태로 이관한다(#187, #188).
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');

ALTER TABLE "User"
ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';
