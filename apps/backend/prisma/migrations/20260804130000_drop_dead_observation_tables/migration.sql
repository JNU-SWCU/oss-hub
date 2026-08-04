-- 사용처가 없는 GithubWebhookObservation을 제거한다.
-- 검증 근거: 델리게이트(prisma.githubWebhookObservation)·raw SQL 테이블명("GithubWebhookObservation")
-- 어느 형태로도 apps/ 어디에서도 참조되지 않는다 — 애플리케이션 코드·스펙·시드 전부 조회했다.
-- webhook/OAuth/PAT 수집 경로는 이미 제거되었고(ADR-006) 이 테이블은 그 경로가 남긴 관측 기록이다.
--
-- CollectionRun·GithubRawObservation은 이번 정리에서 함께 검토했으나 제외한다 — 아래 통합 스펙이
-- 두 테이블의 물리적 존재를 명시적으로 단언한다(살아있는 참조):
--   apps/backend/src/collection/collection-canonical.repository.integration.spec.ts:145-157
--   apps/backend/prisma/collection-incremental-migration.integration.spec.ts:67-75
-- 두 테이블은 이번 마이그레이션에서 드롭하지 않는다.

DROP TABLE IF EXISTS "GithubWebhookObservation";

DROP TYPE IF EXISTS "GithubWebhookObservationOutcome";
