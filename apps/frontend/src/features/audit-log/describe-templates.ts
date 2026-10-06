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

const TEAM_MEMBERSHIP_OPERATION_STEMS: Readonly<
  Record<TeamMembershipOperation, string>
> = {
  LEAVE: '에서 탈퇴',
  REMOVE: '에서 팀원 한 명의 팀 구성원 자격을 해제',
};

function teamMembershipOutcome(summary: TeamMembershipChangeSummary): string {
  if (summary.teamDeleted) return '해 남은 팀원이 없어 팀이 삭제되었습니다';
  if (summary.leaderChanged) {
    return '해 팀장 권한이 다른 팀원에게 승계되었습니다';
  }
  return '했습니다';
}

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

  REPOSITORY_PUBLISHED: (record) =>
    prefixedNameSentence(record, '님이 저장소 ', '을(를) 공개로 전환했습니다'),
  REPOSITORY_CONNECTION_CHANGED: (record) =>
    nameTargetSentence(
      record,
      '의 저장소 연결을 변경했습니다',
      '의 저장소 연결을 변경했습니다',
    ),

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
  TEAM_DELETED: (record) =>
    nameTargetSentence(record, '을(를) 삭제했습니다', '을(를) 삭제했습니다'),

  TEAM_MEMBERSHIP_CHANGED: (record) => {
    const clause = teamMembershipClause(record.teamMembership);
    return nameTargetSentence(record, clause, clause);
  },

  TEAM_RENAMED: (record) => {
    const clause =
      record.teamPreviousName === undefined
        ? '의 이름을 바꿨습니다'
        : `의 이름을 「${record.teamPreviousName}」에서 바꿨습니다`;
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

  APPLICATION_SUBMITTED: (record) =>
    nameTargetSentence(record, '에 신청했습니다', '에 신청했습니다'),

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
