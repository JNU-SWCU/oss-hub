import {
  AUDIT_LOG_ACTION_LABELS,
  type AuditLogAction,
  type AuditLogRecord,
} from './types';

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
  COLLECTION_SYNC: '데이터 수집',
  SUBMISSION_FILE: '제출 파일',
  APPLICATION: '신청',
} as const satisfies Readonly<Record<string, string>>;

export function describeTargetType(targetType: string): string {
  return Object.hasOwn(AUDIT_LOG_TARGET_TYPE_LABELS, targetType)
    ? AUDIT_LOG_TARGET_TYPE_LABELS[
        targetType as keyof typeof AUDIT_LOG_TARGET_TYPE_LABELS
      ]
    : targetType;
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

function actorSegment(record: AuditLogRecord): AuditLogSentenceSegment {
  return { kind: 'actor', value: record.actor };
}

// GitHub 로그인 스냅샷 target에 쓴다('@' 접두로 렌더된다) — STAFF_ROLE_REQUEST_*,
// USER_*, APPLICATION_* 처럼 대상이 사람인 action 전용이다.
function targetSegment(record: AuditLogRecord): AuditLogSentenceSegment {
  return { kind: 'target', value: record.target, variant: 'handle' };
}

// 이름 스냅샷·join으로 찾은 이름 target에 쓴다. GitHub 로그인이 아니므로 '@' 접두를
// 붙이지 않는다 — 프로그램 이름에 그대로 붙이면 "@프로그램이름"처럼 어색해진다.
function nameSegment(record: AuditLogRecord): AuditLogSentenceSegment {
  return { kind: 'target', value: record.target, variant: 'name' };
}

// 폴백일 때 문장에 넣을 조각. `record.target`(= `${targetType} / ${targetId}` 전체
// 문자열)을 그대로 쓰면 "APPLICATION / cm...님의"처럼 코드체 뒤에 '님'이 붙어
// 어색해진다(리뷰 지적). 대신 targetId만 코드체로 보여주고, 사람이 읽는 타입
// 이름은 이미 있는 targetType 라벨 맵(AUDIT_LOG_TARGET_TYPE_LABELS)에서 문장
// 본문의 일반 텍스트로 넣는다.
function fallbackTargetSegment(
  record: AuditLogRecord,
): AuditLogSentenceSegment {
  return { kind: 'target', value: record.targetId, variant: 'fallback' };
}

function targetTypeLabel(record: AuditLogRecord): string {
  return describeTargetType(record.targetType);
}

function text(value: string): AuditLogSentenceSegment {
  return { kind: 'text', value };
}

type SentenceTemplate = (
  record: AuditLogRecord,
) => readonly AuditLogSentenceSegment[];

const SENTENCE_TEMPLATES: Readonly<Record<AuditLogAction, SentenceTemplate>> = {
  // target이 사람 스냅샷(핸들)일 때는 "{target}님의 ...했습니다" 문형을 그대로
  // 쓴다. target이 폴백(`${targetType} / ${targetId}`)이면 '님' 존칭을 뺴고
  // "{targetType 라벨} {targetId}을(를) ...했습니다"로 서술한다 — 코드체
  // targetId 뒤에 '님'이 붙는 어색함을 없애면서도(리뷰 지적) 어떤 대상인지는
  // 여전히 밝힌다.
  STAFF_ROLE_REQUEST_APPROVED: (record) =>
    isFallbackTarget(record)
      ? [
          actorSegment(record),
          text(`님이 ${targetTypeLabel(record)} `),
          fallbackTargetSegment(record),
          text('을(를) 승인했습니다'),
        ]
      : [
          actorSegment(record),
          text('님이 '),
          targetSegment(record),
          text('님의 교직원 권한 요청을 승인했습니다'),
        ],
  STAFF_ROLE_REQUEST_REJECTED: (record) =>
    isFallbackTarget(record)
      ? [
          actorSegment(record),
          text(`님이 ${targetTypeLabel(record)} `),
          fallbackTargetSegment(record),
          text('을(를) 반려했습니다'),
        ]
      : [
          actorSegment(record),
          text('님이 '),
          targetSegment(record),
          text('님의 교직원 권한 요청을 반려했습니다'),
        ],
  STAFF_ROLE_REQUEST_REVOKED: (record) =>
    isFallbackTarget(record)
      ? [
          actorSegment(record),
          text(`님이 ${targetTypeLabel(record)} `),
          fallbackTargetSegment(record),
          text('을(를) 회수했습니다'),
        ]
      : [
          actorSegment(record),
          text('님이 '),
          targetSegment(record),
          text('님의 권한을 회수했습니다'),
        ],
  STAFF_ROLE_REQUEST_RESTORED: (record) =>
    isFallbackTarget(record)
      ? [
          actorSegment(record),
          text(`님이 ${targetTypeLabel(record)} `),
          fallbackTargetSegment(record),
          text('을(를) 복구했습니다'),
        ]
      : [
          actorSegment(record),
          text('님이 '),
          targetSegment(record),
          text('님의 권한을 복구했습니다'),
        ],
  USER_ROLE_CHANGED: (record) =>
    isFallbackTarget(record)
      ? [
          actorSegment(record),
          text(`님이 ${targetTypeLabel(record)} `),
          fallbackTargetSegment(record),
          text('의 역할을 변경했습니다'),
        ]
      : [
          actorSegment(record),
          text('님이 '),
          targetSegment(record),
          text('님의 역할을 변경했습니다'),
        ],
  USER_ACCOUNT_STATUS_CHANGED: (record) =>
    isFallbackTarget(record)
      ? [
          actorSegment(record),
          text(`님이 ${targetTypeLabel(record)} `),
          fallbackTargetSegment(record),
          text('의 계정 상태를 변경했습니다'),
        ]
      : [
          actorSegment(record),
          text('님이 '),
          targetSegment(record),
          text('님의 계정 상태를 변경했습니다'),
        ],
  // REPOSITORY_PUBLISHED는 메타데이터 스키마에 이름 스냅샷이 없어 target이 항상
  // 폴백이다(이름 분기가 존재할 수 없다) — targetId만 코드체로 보여준다.
  REPOSITORY_PUBLISHED: (record) => [
    actorSegment(record),
    text('님이 저장소 '),
    fallbackTargetSegment(record),
    text('을(를) 공개로 전환했습니다'),
  ],
  // PROGRAM_ARCHIVED/RESTORED는 이름 스냅샷(schemaVersion 2) 또는 join으로 찾은
  // 현재 이름이 있으면 그 이름을, 없으면(과거 행이면서 프로그램도 이미 없으면)
  // targetId 폴백을 보여준다. 이름은 GitHub 로그인이 아니므로 nameSegment로
  // '@' 접두 없이 렌더한다.
  PROGRAM_ARCHIVED: (record) =>
    isFallbackTarget(record)
      ? [
          actorSegment(record),
          text('님이 프로그램 '),
          fallbackTargetSegment(record),
          text('을(를) 보관했습니다'),
        ]
      : [
          actorSegment(record),
          text('님이 프로그램 '),
          nameSegment(record),
          text('을(를) 보관했습니다'),
        ],
  PROGRAM_RESTORED: (record) =>
    isFallbackTarget(record)
      ? [
          actorSegment(record),
          text('님이 프로그램 '),
          fallbackTargetSegment(record),
          text('을(를) 복구했습니다'),
        ]
      : [
          actorSegment(record),
          text('님이 프로그램 '),
          nameSegment(record),
          text('을(를) 복구했습니다'),
        ],
  COLLECTION_SYNC_TRIGGERED: (record) => [
    actorSegment(record),
    text('님이 데이터 수집을 수동 실행했습니다'),
  ],
  SUBMISSION_FILE_CLEANUP_RETRY_RESET: (record) => [
    actorSegment(record),
    text('님이 제출 파일 정리 재시도를 초기화했습니다'),
  ],
  APPLICATION_APPROVED: (record) =>
    isFallbackTarget(record)
      ? [
          actorSegment(record),
          text(`님이 ${targetTypeLabel(record)} `),
          fallbackTargetSegment(record),
          text('을(를) 승인했습니다'),
        ]
      : [
          actorSegment(record),
          text('님이 '),
          targetSegment(record),
          text('님의 프로그램 신청을 승인했습니다'),
        ],
  APPLICATION_REJECTED: (record) =>
    isFallbackTarget(record)
      ? [
          actorSegment(record),
          text(`님이 ${targetTypeLabel(record)} `),
          fallbackTargetSegment(record),
          text('을(를) 반려했습니다'),
        ]
      : [
          actorSegment(record),
          text('님이 '),
          targetSegment(record),
          text('님의 프로그램 신청을 반려했습니다'),
        ],
  APPLICATION_REVERTED: (record) =>
    isFallbackTarget(record)
      ? [
          actorSegment(record),
          text(`님이 ${targetTypeLabel(record)} `),
          fallbackTargetSegment(record),
          text('의 판정을 취소했습니다'),
        ]
      : [
          actorSegment(record),
          text('님이 '),
          targetSegment(record),
          text('님의 신청 판정을 취소했습니다'),
        ],
};

function isKnownAction(action: string): action is AuditLogAction {
  return Object.hasOwn(AUDIT_LOG_ACTION_LABELS, action);
}

// 어떤 action인지 몰라 target이 사람 핸들인지 이름인지 구분할 수 없을 때(등록되지
// 않은 action 폴백)만 쓰는 자동 판별. 폴백이면 record.target(= 전체
// `${targetType} / ${targetId}` 문자열)을 코드체로, 아니면 GitHub 로그인 핸들로 본다.
function autoTargetSegment(record: AuditLogRecord): AuditLogSentenceSegment {
  return isFallbackTarget(record)
    ? { kind: 'target', value: record.target, variant: 'fallback' }
    : { kind: 'target', value: record.target, variant: 'handle' };
}

// 등록된 14종 action 밖의 값(과거 스키마 변경 이전 행 등)도 화면이 문장 없이 raw
// 데이터만 던지지 않도록 최소한의 문장을 만든다. affordance를 상태 추측으로 숨기지
// 않는다는 원칙(docs/rules/frontend.md)과 같은 맥락 — 모르는 값도 감춘 채 지나가지
// 않고, 원본 action 문자열을 그대로 보여준다.
function fallbackDescription(record: AuditLogRecord): AuditLogDescription {
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

export function describeAuditLog(record: AuditLogRecord): AuditLogDescription {
  if (isKnownAction(record.action)) {
    return { sentence: SENTENCE_TEMPLATES[record.action](record) };
  }
  return fallbackDescription(record);
}
