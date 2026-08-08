/**
 * 교직원 서류 수합 조회의 행 필터. 저장 enum이 아니라 「행이 무엇을 아직 안 냈는가」의 파생값이다.
 *
 * - `ALL` — 승인된 신청 전부.
 * - `HAS_MISSING` — 필수(required) 서류 중 하나라도 미제출인 팀. 독촉 대상을 고르는 기준이라
 *   선택 서류는 세지 않는다(선택 항목만 빠뜨린 팀이 걸리면 안 된다).
 * - `ZERO_SUBMISSION` — 한 장도 내지 않은 팀. 필수·선택을 가리지 않는 문자 그대로의 0건이며,
 *   서류 항목이 0개인 마일스톤에서는 아무 팀도 걸리지 않는다(「낼 것이 없다」는 0건이 아니다).
 */
export const MILESTONE_DOCUMENT_COLLECTION_FILTERS = [
  'ALL',
  'HAS_MISSING',
  'ZERO_SUBMISSION',
] as const;

export type MilestoneDocumentCollectionFilter =
  (typeof MILESTONE_DOCUMENT_COLLECTION_FILTERS)[number];

export interface MilestoneDocumentCollectionQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly filter: MilestoneDocumentCollectionFilter;
}
