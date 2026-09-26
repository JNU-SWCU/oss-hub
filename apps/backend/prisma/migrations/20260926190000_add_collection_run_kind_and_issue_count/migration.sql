-- 수집 활동 이력(`CollectionSweepHistory`)에 수집 종류와 Issue 수를 더한다(#1133 후속).
--
-- 저장소를 연결하자마자 도는 즉시 수집도 이제 한 행을 남기므로, 정시·수동 순회(`SWEEP`)와
-- 구분할 `kind`가 필요하다. Issue 수집(#1439) 뒤에도 이력에는 Issue 칸이 없어 순회가 넣은 Issue
-- 수가 어디에도 보이지 않았다.
--
-- 전부 additive다 — 기존 행은 `kind = 'SWEEP'`, `insertedIssueCount = 0`으로 채워지고(과거 순회가
-- 넣은 Issue 수는 알 수 없어 0), 기존 컬럼을 바꾸지 않으므로 이 마이그레이션이 배포된 뒤에도 직전
-- 이미지가 그대로 동작한다.
--
-- 이 파일은 `prisma migrate diff`(직전 커밋 schema → 현재 schema)로 생성했다
-- (`20260926120000_add_github_repository_outsider_contribution`과 같은 처리).

-- CreateEnum
CREATE TYPE "CollectionRunKind" AS ENUM ('SWEEP', 'REPOSITORY_LINK');

-- AlterTable
ALTER TABLE "CollectionSweepHistory" ADD COLUMN     "insertedIssueCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kind" "CollectionRunKind" NOT NULL DEFAULT 'SWEEP';
