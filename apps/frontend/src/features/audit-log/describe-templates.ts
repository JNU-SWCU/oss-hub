import type {
  AuditLogAction,
  AuditLogRecord,
  TeamMembershipChangeSummary,
  TeamMembershipOperation,
} from './types';
import {
  actorSegment,
  fallbackDescription,
  fallbackTargetSegment,
  isFallbackTarget,
  nameSegment,
  targetSegment,
  targetTypeLabel,
  text,
  type AuditLogSentenceSegment,
} from './describe-segments';

type SentenceTemplate = (
  record: AuditLogRecord,
) => readonly AuditLogSentenceSegment[];

function handleTargetSentence(
  record: AuditLogRecord,
  fallbackSuffix: string,
  targetSuffix: string,
): readonly AuditLogSentenceSegment[] {
  return isFallbackTarget(record)
    ? [
        actorSegment(record),
        text(`님이 ${targetTypeLabel(record)} `),
        fallbackTargetSegment(record),
        text(fallbackSuffix),
      ]
    : [
        actorSegment(record),
        text('님이 '),
        targetSegment(record),
        text(targetSuffix),
      ];
}

function nameTargetSentence(
  record: AuditLogRecord,
  fallbackSuffix: string,
  targetSuffix: string,
): readonly AuditLogSentenceSegment[] {
  return isFallbackTarget(record)
    ? [
        actorSegment(record),
        text(`님이 ${targetTypeLabel(record)} `),
        fallbackTargetSegment(record),
        text(fallbackSuffix),
      ]
    : [
        actorSegment(record),
        text('님이 '),
        nameSegment(record),
        text(targetSuffix),
      ];
}

function prefixedNameSentence(
  record: AuditLogRecord,
  prefix: string,
  suffix: string,
): readonly AuditLogSentenceSegment[] {
  return [
    actorSegment(record),
    text(prefix),
    isFallbackTarget(record)
      ? fallbackTargetSegment(record)
      : nameSegment(record),
    text(suffix),
  ];
}

function userPhoneUpdatedSentence(
  record: AuditLogRecord,
): readonly AuditLogSentenceSegment[] {
  switch (record.phoneTransition) {
    case 'SET':
      return handleTargetSentence(
        record,
        '의 전화번호를 등록했습니다',
        '님의 전화번호를 등록했습니다',
      );
    case 'REPLACED':
      return handleTargetSentence(
        record,
        '의 전화번호를 변경했습니다',
        '님의 전화번호를 변경했습니다',
      );
    case undefined:
      return fallbackDescription(record).sentence;
  }
}

// 팀 구성 변경 서술절은 "무슨 일이 일어났는가(어간)" + "그 결과 팀장 권한이 어떻게
// 됐는가(어미)"로 나눠 조립한다. 내보내기는 "팀 구성원 자격"만 해제된 사실을 말하고
// 계정·신청·과거 기록이 지워졌다고 읽힐 표현은 쓰지 않는다.
const TEAM_MEMBERSHIP_OPERATION_STEMS: Readonly<
  Record<TeamMembershipOperation, string>
> = {
  LEAVE: '에서 탈퇴',
  REMOVE: '에서 팀원 한 명의 팀 구성원 자격을 해제',
};

// nextLeaderId가 null인 행은 "마지막 인원이 미제출 팀을 떠나 팀이 삭제된 경우"뿐이라
// (web-state-audit-metadata.ts) 승계가 아니라 팀 소멸로 서술한다.
function teamMembershipOutcome(summary: TeamMembershipChangeSummary): string {
  if (summary.teamDeleted) return '해 남은 팀원이 없어 팀이 삭제되었습니다';
  if (summary.leaderChanged) {
    return '해 팀장 권한이 다른 팀원에게 승계되었습니다';
  }
  return '했습니다';
}

// metadata 검증에 실패했거나 필드가 빠졌으면(parser.ts가 teamMembership을 실지 않으면)
// "무엇이 일어났는지 모른다"는 사실을 그대로 밝힌다 — 탈퇴·내보내기 중 하나를
// 골라 추측하지도, TEAM_CREATED/TEAM_JOINED처럼 다른 사건으로 보이게 하지도 않는다.
function teamMembershipClause(
  summary: TeamMembershipChangeSummary | undefined,
): string {
  if (summary === undefined) {
    return '의 팀 구성을 변경했습니다 (상세 내용 없음)';
  }
  return `${TEAM_MEMBERSHIP_OPERATION_STEMS[summary.operation]}${teamMembershipOutcome(summary)}`;
}

export const SENTENCE_TEMPLATES: Readonly<
  Record<AuditLogAction, SentenceTemplate>
> = {
  // target이 사람 스냅샷(핸들)일 때는 "{target}님의 ...했습니다" 문형을 그대로
  // 쓴다. target이 폴백(`${targetType} / ${targetId}`)이면 '님' 존칭을 뺴고
  // "{targetType 라벨} {targetId}을(를) ...했습니다"로 서술한다 — 코드체
  // targetId 뒤에 '님'이 붙는 어색함을 없애면서도(리뷰 지적) 어떤 대상인지는
  // 여전히 밝힌다.
  STAFF_ROLE_REQUEST_APPROVED: (record) =>
    handleTargetSentence(
      record,
      '을(를) 승인했습니다',
      '님의 교직원 권한 요청을 승인했습니다',
    ),
  STAFF_ROLE_REQUEST_REJECTED: (record) =>
    handleTargetSentence(
      record,
      '을(를) 반려했습니다',
      '님의 교직원 권한 요청을 반려했습니다',
    ),
  STAFF_ROLE_REQUEST_REVOKED: (record) =>
    handleTargetSentence(
      record,
      '을(를) 회수했습니다',
      '님의 권한을 회수했습니다',
    ),
  STAFF_ROLE_REQUEST_RESTORED: (record) =>
    handleTargetSentence(
      record,
      '을(를) 복구했습니다',
      '님의 권한을 복구했습니다',
    ),
  USER_ROLE_CHANGED: (record) =>
    handleTargetSentence(
      record,
      '의 역할을 변경했습니다',
      '님의 역할을 변경했습니다',
    ),
  USER_ACCOUNT_STATUS_CHANGED: (record) =>
    handleTargetSentence(
      record,
      '의 계정 상태를 변경했습니다',
      '님의 계정 상태를 변경했습니다',
    ),
  // REPOSITORY_PUBLISHED는 이름 스냅샷(schemaVersion 2, owner/name 전체 이름) 또는
  // join으로 찾은 현재 이름이 있으면 그 이름을, 없으면(과거 v1 행이면서 저장소도 이미
  // 없으면) targetId 폴백을 보여준다. PROGRAM_ARCHIVED/RESTORED와 같은 규약이다.
  REPOSITORY_PUBLISHED: (record) =>
    prefixedNameSentence(record, '님이 저장소 ', '을(를) 공개로 전환했습니다'),
  // PROGRAM_ARCHIVED/RESTORED는 이름 스냅샷(schemaVersion 2) 또는 join으로 찾은
  // 현재 이름이 있으면 그 이름을, 없으면(과거 행이면서 프로그램도 이미 없으면)
  // targetId 폴백을 보여준다. 이름은 GitHub 로그인이 아니므로 nameSegment로
  // '@' 접두 없이 렌더한다.
  // PROGRAM_CREATED / PROGRAM_DELETED / TEAM_* / APPLICATION_SUBMITTED use one
  // nameSegment target only. Do not prefix "프로그램" in the happy path — TEAM
  // and APPLICATION_SUBMITTED targets are already "프로그램 · 팀이름".
  PROGRAM_CREATED: (record) =>
    nameTargetSentence(record, '을(를) 만들었습니다', '을(를) 만들었습니다'),
  PROGRAM_ARCHIVED: (record) =>
    prefixedNameSentence(record, '님이 프로그램 ', '을(를) 보관했습니다'),
  PROGRAM_RESTORED: (record) =>
    prefixedNameSentence(record, '님이 프로그램 ', '을(를) 복구했습니다'),
  PROGRAM_DELETED: (record) =>
    nameTargetSentence(record, '을(를) 삭제했습니다', '을(를) 삭제했습니다'),
  TEAM_CREATED: (record) =>
    nameTargetSentence(record, '을(를) 만들었습니다', '을(를) 만들었습니다'),
  TEAM_JOINED: (record) =>
    nameTargetSentence(record, '에 합류했습니다', '에 합류했습니다'),
  // TEAM_MEMBERSHIP_CHANGED는 TEAM_CREATED/TEAM_JOINED와 같은 "프로그램 · 팀이름"
  // target을 가지므로 같은 nameSegment/폴백 규약을 그대로 쓰고, 달라지는 건 서술절뿐이다
  // (별도 렌더러를 두지 않는다).
  TEAM_MEMBERSHIP_CHANGED: (record) => {
    const clause = teamMembershipClause(record.teamMembership);
    return nameTargetSentence(record, clause, clause);
  },
  COLLECTION_SYNC_TRIGGERED: (record) => [
    actorSegment(record),
    text('님이 데이터 수집을 수동 실행했습니다'),
  ],
  SUBMISSION_FILE_CLEANUP_RETRY_RESET: (record) => [
    actorSegment(record),
    text('님이 제출 파일 정리 재시도를 초기화했습니다'),
  ],
  // APPLICATION_SUBMITTED target is "프로그램 · 팀이름", not an applicant handle.
  // Reusing APPLICATION_APPROVED's "{target}님의 신청을 승인했습니다" would render
  // "프로그램 · 팀이름님의".
  APPLICATION_SUBMITTED: (record) =>
    nameTargetSentence(record, '에 신청했습니다', '에 신청했습니다'),
  // APPLICATION_*는 이름 스냅샷(schemaVersion 2)/join이 있으면 target이
  // "{프로그램 이름} · @{신청자 로그인}" 합성 라벨이다(audit-log.repository.ts의
  // composeApplicationTargetLabel) — 이미 "@"를 스스로 포함하므로 GitHub 로그인
  // 전용인 targetSegment('handle', 자동 '@' 접두)가 아니라 nameSegment('name', 접두
  // 없음)로 렌더한다. target 자체가 프로그램 이름을 담고 있어 뒤따르는 문구에서
  // "프로그램"을 다시 말하지 않는다(중복 표현 방지).
  APPLICATION_APPROVED: (record) =>
    nameTargetSentence(
      record,
      '을(를) 승인했습니다',
      '님의 신청을 승인했습니다',
    ),
  APPLICATION_REJECTED: (record) =>
    nameTargetSentence(
      record,
      '을(를) 반려했습니다',
      '님의 신청을 반려했습니다',
    ),
  APPLICATION_REVERTED: (record) =>
    nameTargetSentence(
      record,
      '을(를) 검토 대기로 되돌렸습니다',
      '님의 신청을 검토 대기로 되돌렸습니다',
    ),
  USER_PROFILE_UPDATED: (record) =>
    handleTargetSentence(
      record,
      '의 프로필을 수정했습니다',
      '님의 프로필을 수정했습니다',
    ),
  USER_PHONE_UPDATED: userPhoneUpdatedSentence,
};
