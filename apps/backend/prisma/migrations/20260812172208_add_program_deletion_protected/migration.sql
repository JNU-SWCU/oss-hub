-- F2 finding #1: 가드 delete/purge 모두 서비스 계층에서 무조건 거부해야 하는 프로그램을
-- 표시하는 플래그. API에는 이 값을 바꾸는 경로가 없다 — 운영자가 DB에서 직접 켠다.
ALTER TABLE "Program" ADD COLUMN     "deletionProtected" BOOLEAN NOT NULL DEFAULT false;
