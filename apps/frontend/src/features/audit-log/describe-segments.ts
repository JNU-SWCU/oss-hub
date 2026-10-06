import type { AuditLogRecord } from './types';

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

export type AuditLogTargetVariant = 'handle' | 'name' | 'fallback';

export type AuditLogSentenceSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'actor'; readonly value: string }
  | {
      readonly kind: 'target';
      readonly value: string;
      readonly variant: AuditLogTargetVariant;
    }
  | { readonly kind: 'code'; readonly value: string };

export interface AuditLogDescription {
  readonly sentence: readonly AuditLogSentenceSegment[];
}

export function isFallbackTarget(record: AuditLogRecord): boolean {
  return record.target === `${record.targetType} / ${record.targetId}`;
}

export const TARGETLESS_FALLBACK_TARGET_TYPES: ReadonlySet<string> = new Set([
  'COLLECTION_SYNC',
]);

export function actorSegment(record: AuditLogRecord): AuditLogSentenceSegment {
  return { kind: 'actor', value: record.actor };
}

export function targetSegment(record: AuditLogRecord): AuditLogSentenceSegment {
  return { kind: 'target', value: record.target, variant: 'handle' };
}

export function nameSegment(record: AuditLogRecord): AuditLogSentenceSegment {
  return { kind: 'target', value: record.target, variant: 'name' };
}

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
