-- ADR-010 §4 — 옛 연도 집계 드롭.
--
-- 전환 순서의 마지막 단계다: 확장 → 재수집 → 읽기 전환 → **드롭**.
-- 읽기 5곳(`getContributorMetrics`·`getContributorCumulativeMetrics`·
-- `getRepositoryMetrics`·`getRepositoryCumulativeMetrics`·`listPublicRankingYears`)이
-- 모두 `Contribution` 을 읽도록 옮겨진 뒤이며, writer 도 함께 제거했다.
--
-- 이 테이블들이 왜 사라지는가.
--   1. grain 이 이름에 박혀 있었다(`*YearAggregate`). 입자가 날짜로 바뀌자 이름이 거짓말이 됐다.
--   2. 연도가 저장 구조에 있어서 새해마다 롤오버·0-채움 특수 처리가 필요했다.
--   3. `githubLogin` 을 비정규화해 들고 있어 같은 사람의 표기가 행마다 갈릴 수 있었고,
--      그래서 읽는 쪽마다 tie-break 규칙이 필요했다. 이제 `User` 가 단일 원본이다.
--   4. 가입 여부와 무관하게 fact 에 나타난 모든 계정의 행을 만들었다(#682).
--
-- 되돌리려면 이 마이그레이션을 되돌리는 것으로 부족하다 — 재수집이 필요하다.
-- 다만 수집은 전량 재계산이라 멱등이므로 다음 스윕이 스스로 채운다.

-- DropTable
DROP TABLE IF EXISTS "CollectionContributorYearAggregate";
DROP TABLE IF EXISTS "CollectionRepositoryYearAggregate";
