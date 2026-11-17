import {
  AUDIT_LOG_ACTION_LABELS,
  type AuditLogCategory,
  type AuditLogPerson,
  type AuditLogRecord,
  type TeamMembershipOperation,
} from './types';

export const AUDIT_LOG_CATEGORY_LABELS: Readonly<
  Record<AuditLogCategory, string>
> = {
  ACCOUNT: '권한·계정',
  OPERATION: '운영',
  SUBMISSION: '서류',
  LOGIN: '로그인',
  SYSTEM: '시스템',
};

const ROLE_LABELS: Readonly<Record<string, string>> = {
  ADMIN: '관리자',
  STAFF: '교직원',
  STUDENT: '학생',
  UNSELECTED: '미선택',
};

const TARGET_TYPE_LABELS: Readonly<Record<string, string>> = {
  USER: '사용자',
  ROLE_REQUEST: '권한 요청',
  REPOSITORY: '저장소',
  PROGRAM: '프로그램',
  TEAM: '팀',
  APPLICATION: '신청',
  SUBMISSION: '서류',
};

const CHANGE_VALUE_LABELS: Readonly<Record<string, string>> = {
  ...ROLE_LABELS,
  ACTIVE: '활성',
  DEACTIVATED: '비활성',
  PENDING: '대기',
  SUBMITTED: '검토 중',
  APPROVED: '승인',
  REJECTED: '반려',
  REVOKED: '회수',
  PUBLISHED: '게시',
  DELETED: '삭제',
  PRIVATE: '비공개',
  PUBLIC: '공개',
};

const MEMBERSHIP_ACTION_LABELS: Readonly<
  Record<TeamMembershipOperation, string>
> = {
  LEAVE: '팀 탈퇴',
  REMOVE: '팀원 제외',
  TRANSFER_LEADER: '팀장 변경',
};

const SEOUL = 'Asia/Seoul';

export interface PersonLabel {
  readonly primary: string;
  readonly handle: string | null;
  readonly known: boolean;
}

function lookup(labels: Readonly<Record<string, string>>, key: string) {
  return Object.hasOwn(labels, key) ? labels[key] : undefined;
}

function personLabel(person: AuditLogPerson | null): PersonLabel {
  if (person === null) return { primary: '시스템', handle: null, known: false };
  if (person.name) return { primary: person.name, handle: null, known: true };
  return { primary: '알 수 없음', handle: person.login, known: false };
}

export function actorLabel(record: AuditLogRecord): PersonLabel {
  return personLabel(record.actor);
}

export function roleLabel(role: string | null): string | null {
  if (role === null) return null;
  return lookup(ROLE_LABELS, role) ?? role;
}

export interface TargetLabel {
  readonly primary: string;
  readonly handle: string | null;
  readonly context: string | null;
  readonly fallback: boolean;
}

export function targetLabel(record: AuditLogRecord): TargetLabel | null {
  if (record.category === 'LOGIN') return null;
  const { target } = record;
  const fallback: TargetLabel = {
    primary: `${lookup(TARGET_TYPE_LABELS, target.type) ?? target.type} ${target.id}`,
    handle: null,
    context: null,
    fallback: true,
  };
  switch (target.type) {
    case 'USER':
    case 'ROLE_REQUEST': {
      if (target.name === null && target.login === null) return fallback;
      const person = personLabel(target);
      return { ...person, context: null, fallback: false };
    }
    case 'APPLICATION':
    case 'SUBMISSION': {
      const parts = [target.teamName, target.name].filter(
        (part): part is string => part !== null,
      );
      if (parts.length === 0 && target.login === null) return fallback;
      return {
        primary: parts.length > 0 ? parts.join(' ') : `@${target.login}`,
        handle: null,
        context: target.programName,
        fallback: false,
      };
    }
    default:
      return target.name === null
        ? fallback
        : {
            primary: target.name,
            handle: null,
            context: target.programName,
            fallback: false,
          };
  }
}

export function actionLabel(record: AuditLogRecord): string {
  if (record.teamMembership) {
    return MEMBERSHIP_ACTION_LABELS[record.teamMembership.operation];
  }
  if (record.action === 'USER_PHONE_UPDATED' && record.phoneTransition) {
    return record.phoneTransition === 'SET' ? '전화번호 등록' : '전화번호 변경';
  }
  if (
    record.action === 'USER_ROLE_CHANGED' &&
    record.change?.before === 'UNSELECTED'
  ) {
    return '회원 유형 선택';
  }
  return lookup(AUDIT_LOG_ACTION_LABELS, record.action) ?? record.action;
}

export interface ChangeLabel {
  readonly before: string | null;
  readonly after: string | null;
  readonly note: string | null;
}

function changeValue(record: AuditLogRecord, value: string | null) {
  if (value === null) return null;
  if (record.category === 'SUBMISSION') return `v${value}`;
  if (record.action === 'TEAM_RENAMED') return value;
  return lookup(CHANGE_VALUE_LABELS, value) ?? value;
}

export function changeLabel(record: AuditLogRecord): ChangeLabel | null {
  const membership = record.teamMembership;
  const note = membership?.teamDeleted
    ? '남은 팀원이 없어 팀 삭제'
    : membership?.leaderChanged && membership.operation !== 'TRANSFER_LEADER'
      ? '팀장 승계'
      : null;
  if (record.change === null) {
    return note === null ? null : { before: null, after: null, note };
  }
  return {
    before: changeValue(record, record.change.before),
    after: changeValue(record, record.change.after),
    note,
  };
}

const timeFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: SEOUL,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: SEOUL,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const dayFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: SEOUL,
  month: 'long',
  day: 'numeric',
  weekday: 'short',
});

const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SEOUL,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

export function dayKey(iso: string | Date): string {
  return dayKeyFormatter.format(new Date(iso));
}

export function dayLabel(iso: string, now: Date): string {
  const key = dayKey(iso);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const date = dayFormatter.format(new Date(iso));
  if (key === dayKey(now)) return `오늘 · ${date}`;
  if (key === dayKey(yesterday)) return `어제 · ${date}`;
  return key.slice(0, 4) === dayKey(now).slice(0, 4)
    ? date
    : `${key.slice(0, 4)}년 ${date}`;
}
