import type { AuditLogRecord } from './types';

// audit-log.repository.ts의 targetType 리터럴을 미러링한다. actions와 달리 이 값들은
// 한 곳에 등록돼 있지 않고 각 도메인의 감사 기록 호출부에 흩어져 있다
// (program-lifecycle.service.ts, collection-admin.controller.ts,
// repositories.service.ts, admin-access-audit.ts, account-deactivation.service.ts,
// applications.service.ts, retry-submission-file-cleanup.ts). 이 목록이 backend와
// 어긋나지 않는지는 target-type-labels.test.ts가 apps/backend/src 전체를 텍스트로
// 스캔해 검증한다.
export const AUDIT_LOG_TARGET_TYPE_LABELS = {
  USER: '사용자',
  ROLE_REQUEST: '권한 요청',
  REPOSITORY: '저장소',
  PROGRAM: '프로그램',
  TEAM: '팀',
  COLLECTION_SYNC: '데이터 수집',
  SUBMISSION_FILE: '제출 파일',
  APPLICATION: '신청',
} as const satisfies Readonly<Record<string, string>>;

export function describeTargetType(targetType: string): string {
  return (
    Object.entries(AUDIT_LOG_TARGET_TYPE_LABELS).find(
      ([value]) => value === targetType,
    )?.[1] ?? targetType
  );
}

// 서술문을 구성하는 조각. actor/target은 문장 안에서 강조 스타일이 달라 별도
// kind로 둔다 — 렌더링(font-medium, '@' 접두, 코드체)은 화면 쪽(audit-log-sentence.tsx)
// 책임이고, 여기서는 어떤 조각인지 데이터로만 표현한다.
// target 조각의 렌더 방식. describe.ts는 어떤 종류인지 데이터로만 표현하고, 실제
// 강조 스타일(font-medium, '@' 접두, 코드체)은 화면 쪽(audit-log-sentence.tsx) 책임이다.
//   - 'handle': 이벤트 시점 GitHub 로그인 스냅샷 — 사람 이름처럼 '@' 접두로 읽는다.
//   - 'name': 이벤트 시점 이름 스냅샷이거나 join으로 찾은 현재 이름(예: 프로그램
//     이름) — 사람이 읽을 수 있는 값이지만 GitHub 로그인이 아니므로 '@'을 붙이면
//     "@프로그램이름"처럼 어색해진다. 굵게만 표시하고 접두는 붙이지 않는다.
//   - 'fallback': `targetType / targetId` 폴백(레거시 행 또는 스냅샷·join 모두 없는
//     action) — 코드체로 표시해 "사람이 읽을 수 없는 값"이라는 신호를 유지한다.
export type AuditLogTargetVariant = 'handle' | 'name' | 'fallback';

export type AuditLogSentenceSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'actor'; readonly value: string }
  | {
      readonly kind: 'target';
      readonly value: string;
      readonly variant: AuditLogTargetVariant;
    }
  // 미등록 action 폴백 문장에 쓰는 원본 action 문자열. 코드체로 표시한다.
  | { readonly kind: 'code'; readonly value: string };

export interface AuditLogDescription {
  readonly sentence: readonly AuditLogSentenceSegment[];
}

// audit-log.repository.ts의 resolveAuditTargetLabel과 짝을 이룬다: 대상 스냅샷도
// join도 없으면 target은 정확히 `${targetType} / ${targetId}` 폴백 문자열이 된다.
// 그 형태와 일치하면 "사람이 읽을 수 없는 폴백"으로 판단한다 — 백엔드가 별도 플래그를
// 내려주지 않으므로 프런트가 가진 세 필드(target/targetType/targetId)만으로 재현
// 가능한 유일한 판별식이다. 화면(audit-log-view.tsx)의 메타 라인도 같은 판별식을 쓴다.
export function isFallbackTarget(record: AuditLogRecord): boolean {
  return record.target === `${record.targetType} / ${record.targetId}`;
}

// 폴백이어도 메타 라인의 targetId를 아예 보여주지 않는 targetType이다. 여기 들어가려면
// 둘 다 만족해야 한다 — (a) targetId가 사람이 읽을 대상이 아니라 기계가 생성한 실행
// 식별자(runId 등)라 원본을 봐도 "무엇을 가리키는지" 의미가 없고, (b) 그 식별자로 실행
// 결과·상세를 조회로 되찾을 스키마 경로가 없다(COLLECTION_SYNC_TRIGGERED의 runId는
// CollectionSweepHistory에 남는 실행 결과와 이어줄 runId 컬럼이 그 테이블에 없어 join이
// 불가능하다 — audit-log.repository.ts의 resolveAuditTargetLabel도 이 targetType엔 join
// 분기가 없다).
//
// PROGRAM/APPLICATION/REPOSITORY/USER/ROLE_REQUEST는 넣지 않는다 — 그 대상들은 실제
// 엔티티/사람을 가리키고, 스냅샷·join이 실패해도 targetId 자체가 원본 참조값으로서
// 조회 가치를 유지한다(추후 join 조건이 넓어지면 되찾을 수도 있다). 새 targetType을
// 여기 추가하려는 경우 위 (a)(b) 두 조건을 그대로 적용해 판단한다.
export const TARGETLESS_FALLBACK_TARGET_TYPES: ReadonlySet<string> = new Set([
  'COLLECTION_SYNC',
]);

export function actorSegment(record: AuditLogRecord): AuditLogSentenceSegment {
  return { kind: 'actor', value: record.actor };
}

// GitHub 로그인 스냅샷 target에 쓴다('@' 접두로 렌더된다) — STAFF_ROLE_REQUEST_*,
// USER_* 처럼 target이 순수 로그인 문자열 하나뿐인 action 전용이다. APPLICATION_*는
// target이 "프로그램 이름 · @로그인" 합성 라벨이라 이 세그먼트를 쓰지 않는다
// (nameSegment 참고).
export function targetSegment(record: AuditLogRecord): AuditLogSentenceSegment {
  return { kind: 'target', value: record.target, variant: 'handle' };
}

// 이름 스냅샷·join으로 찾은 이름, 또는 이미 '@'을 포함한 합성 라벨(APPLICATION_*의
// "프로그램 이름 · @로그인") target에 쓴다. GitHub 로그인 하나만 있는 경우가 아니므로
// '@' 접두를 자동으로 붙이지 않는다 — 프로그램 이름에 그대로 붙이면
// "@프로그램이름"처럼 어색해지고, APPLICATION_*의 합성 라벨은 이미 '@'을 포함한다.
export function nameSegment(record: AuditLogRecord): AuditLogSentenceSegment {
  return { kind: 'target', value: record.target, variant: 'name' };
}

// 폴백일 때 문장에 넣을 조각. `record.target`(= `${targetType} / ${targetId}` 전체
// 문자열)을 그대로 쓰면 "APPLICATION / cm...님의"처럼 코드체 뒤에 '님'이 붙어
// 어색해진다(리뷰 지적). 대신 targetId만 코드체로 보여주고, 사람이 읽는 타입
// 이름은 이미 있는 targetType 라벨 맵(AUDIT_LOG_TARGET_TYPE_LABELS)에서 문장
// 본문의 일반 텍스트로 넣는다.
export function fallbackTargetSegment(
  record: AuditLogRecord,
): AuditLogSentenceSegment {
  return { kind: 'target', value: record.targetId, variant: 'fallback' };
}

export function targetTypeLabel(record: AuditLogRecord): string {
  return describeTargetType(record.targetType);
}

export function text(value: string): AuditLogSentenceSegment {
  return { kind: 'text', value };
}

function autoTargetSegment(record: AuditLogRecord): AuditLogSentenceSegment {
  return isFallbackTarget(record)
    ? { kind: 'target', value: record.target, variant: 'fallback' }
    : { kind: 'target', value: record.target, variant: 'handle' };
}

// 등록된 action 밖의 값(과거 스키마 변경 이전 행 등)도 화면이 문장 없이 raw
// 데이터만 던지지 않도록 최소한의 문장을 만든다. affordance를 상태 추측으로 숨기지
// 않는다는 원칙(docs/rules/frontend.md)과 같은 맥락 — 모르는 값도 감춘 채 지나가지
// 않고, 원본 action 문자열을 그대로 보여준다.
export function fallbackDescription(
  record: AuditLogRecord,
): AuditLogDescription {
  return {
    sentence: [
      actorSegment(record),
      text('님이 '),
      { kind: 'code', value: record.action },
      text(' 작업을 수행했습니다 (대상: '),
      autoTargetSegment(record),
      text(')'),
    ],
  };
}
