-- 보존 기간이 끝난 canonical 세대 테이블 8개를 제거한다.
--
-- 근거: ADR-006 "누적 저장소로의 1회 전환과 이전 세대 보존" 4항은 old generation 테이블을
-- 전환 이후 **한 release 동안만** read-only rollback 용도로 보존한다고 정했고, 5항은 보존
-- 기간이 끝나면 그 제거를 전환 자체가 아니라 **별도로 추적하는 후속 migration**에서 수행한다고
-- 정했다. 이 파일이 그 후속 migration이다.
--
-- 보존 조건 충족 확인:
--   1. 전환(cutover)은 한참 전 릴리스에서 완료됐고 그 뒤로 릴리스가 여럿 지나 "한 release"
--      보존 창은 이미 오래 지났다.
--   2. 8개 테이블 전부 프로덕션 실측 0행이다(반복 측정) — rollback으로 복원할 원본 자체가 없다.
--   3. 이 테이블들을 읽던 마지막 코드 경로는 선행 커밋에서 제거됐고, 쓰던 writer·전환
--      orchestration도 이 커밋에서 함께 제거된다. 남은 참조는 0건이다.
--   4. 되돌리기는 이전 릴리스 재배포 + 백업 restore라는 운영 절차다(init-operations 복구 절차) —
--      배포 시점 전체 백업이 존재한다.
--
-- 8개는 `CanonicalCollectionRun`을 뿌리로 하는 단일 FK 클러스터라 **부분 삭제가 불가능하다**.
-- 하나만 남기면 FK가 깨지므로 한 migration에서 전부 드롭한다. 순서는 의존하는 쪽(자식)부터
-- 뿌리(부모) 순이다 — `CanonicalOrganizationState`는 `activeGenerationId`로 run을 참조하고,
-- `CanonicalCollectionLease`는 `runId`로 참조하며, 나머지 넷은 run과 `CanonicalRepository`
-- 양쪽을 참조한다. 테이블을 드롭하면 그 테이블이 소유한 인덱스·제약·시퀀스도 함께 사라지므로
-- 별도 정리문이 필요 없다.

DROP TABLE IF EXISTS "CanonicalContributorProjection";

DROP TABLE IF EXISTS "CanonicalRelease";

DROP TABLE IF EXISTS "CanonicalPullRequest";

DROP TABLE IF EXISTS "CanonicalDefaultBranchCommit";

DROP TABLE IF EXISTS "CanonicalRepository";

DROP TABLE IF EXISTS "CanonicalCollectionLease";

DROP TABLE IF EXISTS "CanonicalOrganizationState";

DROP TABLE IF EXISTS "CanonicalCollectionRun";

-- 위 8개 테이블만 쓰던 enum이다 — 마지막 참조 컬럼(`CanonicalCollectionRun.status`)이
-- 사라졌으므로 타입도 함께 제거한다.
DROP TYPE IF EXISTS "CanonicalCollectionRunStatus";
