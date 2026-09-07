-- 제품 도메인에 없는 삭제 보호 플래그를 제거한다.
ALTER TABLE "Program" DROP COLUMN "deletionProtected";
