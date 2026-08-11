-- ADR-010 §6 — 수집 편입 큐.
--
-- 행이 존재한다는 것이 곧 "이 저장소는 수집 대상"이라는 뜻이다. 별도의 편입
-- 단계나 조건절을 두지 않는다. 프로비저닝이 `NEW` 로 저장소를 만들든 `OWN` 으로
-- 연결하든, 행이 생기는 순간 `nextRunAt` 기본값 `CURRENT_TIMESTAMP` 로 큐에 들어간다.
--
-- 기존 행에도 같은 기본값이 적용되므로 마이그레이션 직후 전 저장소가 한 번씩
-- due 상태가 된다 — 첫 스윕이 평소보다 무겁지만 데이터 손실이나 중복 적재는 없다
-- (수집은 전량 재계산이라 멱등이다).

-- AlterTable
ALTER TABLE "GithubRepository"
  ADD COLUMN "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastSuccessAt" TIMESTAMP(3),
  ADD COLUMN "failureCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
-- 큐에서 "가장 오래 굶은 것부터" 꺼내는 `ORDER BY nextRunAt ASC` 를 받친다.
CREATE INDEX "GithubRepository_nextRunAt_idx" ON "GithubRepository"("nextRunAt");
