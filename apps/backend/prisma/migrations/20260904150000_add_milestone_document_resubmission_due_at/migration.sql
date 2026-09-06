-- 보완 요청에 「언제까지 다시 낼 수 있는가」를 붙인다.
--
-- Nullable 추가만 한다(백필 없음, 제약 없음). 이 컬럼이 생기기 전에 저장된 보완 요청은
-- 교직원이 어떤 기한을 골랐을지 알 방법이 없어 어떤 값도 지어낼 수 없고, 승인·반려 판정에는
-- 기한이라는 것 자체가 없다. 그래서 기존 행은 전부 NULL로 남는다.
--
-- 앞 이미지로의 롤백도 안전하다 — 이전 애플리케이션은 이 컬럼을 읽지도 쓰지도 않는다.

-- AlterTable
ALTER TABLE "MilestoneDocumentReviewHistory" ADD COLUMN "resubmissionDueAt" TIMESTAMP(3);
