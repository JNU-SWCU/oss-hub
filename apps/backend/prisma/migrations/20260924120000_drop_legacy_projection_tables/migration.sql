-- #1133 PR6b: 빈 레거시 테이블 4종을 물리적으로 제거한다.
--
-- PR6a(chore/1133-remove-legacy-table-references)가 이 네 테이블의 backend 코드 참조를
-- 전부 걷어냈다 — writer 0곳, reader 0곳. 이 마이그레이션은 그 뒤를 잇는 물리 삭제다.
--
-- 대상: PublicShowcaseRepository·PublicShowcaseContributor(#126/#134 공개 쇼케이스
-- projection — 후속 `public-projects` 모듈이 대체했다), CollectionRun·
-- GithubRawObservation(구 수집 관측 원장 — `collection-incremental.*` 계열이 대체했다).
-- 넷 다 production 실측 0행(2026-09-23 확인)이며 각 테이블의 유일한 writer였던 서비스는
-- 이미 삭제됐다(레거시 writer 표기는 `ShowcaseProjectionService`, 구 수집 파이프라인).
--
-- preflight 게이트를 다시 세운다 — 0행 확인과 이 마이그레이션 배포 사이에 다른 경로가
-- 다시 행을 심었을 가능성을 배포 시점에 닫는다. LOCK은 그 확인과 DROP 사이에 새 쓰기가
-- 끼어들 틈을 없앤다.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE
  "PublicShowcaseRepository",
  "PublicShowcaseContributor",
  "CollectionRun",
  "GithubRawObservation"
IN ACCESS EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM "PublicShowcaseRepository")
    OR EXISTS (SELECT 1 FROM "PublicShowcaseContributor")
    OR EXISTS (SELECT 1 FROM "CollectionRun")
    OR EXISTS (SELECT 1 FROM "GithubRawObservation")
  THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'legacy tables require reconciliation';
  END IF;
END
$preflight$;

-- 자식(FK를 가진 쪽) 먼저, 부모 나중 — 두 클러스터 모두 이 순서다.
DROP TABLE "PublicShowcaseContributor";
DROP TABLE "PublicShowcaseRepository";
DROP TABLE "GithubRawObservation";
DROP TABLE "CollectionRun";

-- 위 네 테이블만 쓰던 enum이다 — 마지막 참조 컬럼이 사라졌으므로 타입도 함께 제거한다.
DROP TYPE "ObservationSourceType";
DROP TYPE "CollectionRunStatus";
DROP TYPE "CollectionTrigger";

COMMIT;
