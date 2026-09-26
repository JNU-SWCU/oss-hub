-- 관리자 회원 유형 전환에서 기존 학번을 보존할 수 있게 한다.
--
-- staffNumber는 별도 선택 필드다. 최대 100자 입력 정책은 쓰기 경계가 담당하며,
-- 기관별 형식·유일성은 이 스키마에 가정하지 않는다.
ALTER TABLE "UserProfile"
  ADD COLUMN "staffNumber" TEXT;

-- 기존 CHECK의 STAFF → studentId IS NULL 결합만 완화한다.
-- STAFF의 NULL은 계속 허용하고, 값이 있으면 기존 6~10자리 legacy 형식을 그대로
-- 적용한다. STUDENT의 실제 studentId·department 필수성은 기존 서비스가 담당한다.
-- PostgreSQL CHECK의 NULL 결과 통과도 기존과 동일하게 유지된다.
ALTER TABLE "UserProfile"
  DROP CONSTRAINT "UserProfile_studentId_memberKind_check";

ALTER TABLE "UserProfile"
  ADD CONSTRAINT "UserProfile_studentId_memberKind_check"
  CHECK (
    ("memberKind" = 'STAFF'
      AND ("studentId" IS NULL OR "studentId" ~ '^[0-9]{6,10}$'))
    OR
    ("memberKind" = 'STUDENT'
      AND "studentId" ~ '^[0-9]{6,10}$')
  );
