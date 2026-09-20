-- 현재 유효한 발급 요청의 세대 식별자다.
-- 기존 행은 요청 세대를 증명할 수 없으므로 null로 남기고 worker claim에서 제외한다.
-- 이후 요청부터 수락 트랜잭션이 채운다. 순수 ADD COLUMN이라
-- docs/deploy/pre-deploy-verify.md ⓪의 리허설 트리거
-- DROP TABLE·DROP COLUMN·DROP CONSTRAINT 에 해당하지 않는다.

-- AlterTable
ALTER TABLE "RepositoryProvisionJob" ADD COLUMN     "currentEventId" TEXT;
