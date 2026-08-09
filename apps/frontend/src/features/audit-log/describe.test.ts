import { describe, expect, it } from 'vitest';
import {
  AUDIT_LOG_TARGET_TYPE_LABELS,
  describeAuditLog,
  describeTargetType,
} from './describe';
import type { AuditLogRecord } from './types';

const BASE_RECORD: AuditLogRecord = {
  id: 'audit-1',
  actor: 'synthetic-admin',
  action: 'STAFF_ROLE_REQUEST_APPROVED',
  targetType: 'ROLE_REQUEST',
  targetId: 'request-synthetic-1',
  target: 'synthetic-target-login',
  occurredAt: '2026-07-24T03:00:00.000Z',
};

function sentenceText(record: AuditLogRecord): string {
  return describeAuditLog(record)
    .sentence.map((segment) => segment.value)
    .join('');
}

describe('describeAuditLog', () => {
  it('STAFF_ROLE_REQUEST_APPROVED를 사람이 읽는 문장으로 만든다', () => {
    expect(sentenceText(BASE_RECORD)).toBe(
      'synthetic-admin님이 synthetic-target-login님의 교직원 권한 요청을 승인했습니다',
    );
  });

  it('target이 GitHub 로그인 스냅샷이면 target 조각을 isHandle=true로 표시한다', () => {
    const { sentence } = describeAuditLog(BASE_RECORD);
    const targetSegment = sentence.find((segment) => segment.kind === 'target');
    expect(targetSegment).toMatchObject({
      kind: 'target',
      value: 'synthetic-target-login',
      isHandle: true,
    });
  });

  it('target이 legacy 폴백(`targetType / targetId`)이면 isHandle=false로 표시한다', () => {
    const legacyRecord: AuditLogRecord = {
      ...BASE_RECORD,
      id: 'audit-legacy',
      targetId: 'request-legacy',
      target: 'ROLE_REQUEST / request-legacy',
    };

    const { sentence } = describeAuditLog(legacyRecord);
    const targetSegment = sentence.find((segment) => segment.kind === 'target');
    expect(targetSegment).toMatchObject({
      kind: 'target',
      value: 'ROLE_REQUEST / request-legacy',
      isHandle: false,
    });
  });

  it('REPOSITORY_PUBLISHED는 target을 사람이 아닌 저장소로 서술한다(폴백만 가능)', () => {
    const record: AuditLogRecord = {
      id: 'audit-repository-published',
      actor: 'synthetic-staff',
      action: 'REPOSITORY_PUBLISHED',
      targetType: 'REPOSITORY',
      targetId: 'repository-synthetic-1',
      target: 'REPOSITORY / repository-synthetic-1',
      occurredAt: '2026-07-24T04:00:00.000Z',
    };

    expect(sentenceText(record)).toBe(
      'synthetic-staff님이 저장소 REPOSITORY / repository-synthetic-1을(를) 공개로 전환했습니다',
    );
  });

  it('target이 없는 action(COLLECTION_SYNC_TRIGGERED)은 target 조각을 만들지 않는다', () => {
    const record: AuditLogRecord = {
      id: 'audit-collection-sync',
      actor: 'synthetic-admin',
      action: 'COLLECTION_SYNC_TRIGGERED',
      targetType: 'COLLECTION_SYNC',
      targetId: 'run-synthetic-1',
      target: 'COLLECTION_SYNC / run-synthetic-1',
      occurredAt: '2026-07-24T05:00:00.000Z',
    };

    const { sentence } = describeAuditLog(record);
    expect(sentence.some((segment) => segment.kind === 'target')).toBe(false);
    expect(sentenceText(record)).toBe(
      'synthetic-admin님이 데이터 수집을 수동 실행했습니다',
    );
  });

  it('APPLICATION_APPROVED를 신청 승인 문장으로 만든다', () => {
    const record: AuditLogRecord = {
      id: 'audit-application-approved',
      actor: 'synthetic-staff',
      action: 'APPLICATION_APPROVED',
      targetType: 'APPLICATION',
      targetId: 'application-synthetic-1',
      target: 'APPLICATION / application-synthetic-1',
      occurredAt: '2026-07-24T06:00:00.000Z',
    };

    expect(sentenceText(record)).toBe(
      'synthetic-staff님이 APPLICATION / application-synthetic-1님의 프로그램 신청을 승인했습니다',
    );
  });

  it('등록되지 않은 action은 원본 action 문자열을 담은 폴백 문장을 만든다', () => {
    const record: AuditLogRecord = {
      ...BASE_RECORD,
      id: 'audit-unknown',
      action: 'LEGACY_SYNTHETIC_ACTION',
    };

    const { sentence } = describeAuditLog(record);
    expect(sentenceText(record)).toBe(
      'synthetic-admin님이 LEGACY_SYNTHETIC_ACTION 작업을 수행했습니다 (대상: synthetic-target-login)',
    );
    expect(sentence.some((segment) => segment.kind === 'code')).toBe(true);
  });
});

describe('describeTargetType', () => {
  it('알려진 targetType을 한국어 라벨로 바꾼다', () => {
    for (const [targetType, label] of Object.entries(
      AUDIT_LOG_TARGET_TYPE_LABELS,
    )) {
      expect(describeTargetType(targetType)).toBe(label);
    }
  });

  it('알 수 없는 targetType은 원본 문자열을 그대로 돌려준다(숨기지 않는다)', () => {
    expect(describeTargetType('UNKNOWN_SYNTHETIC_TYPE')).toBe(
      'UNKNOWN_SYNTHETIC_TYPE',
    );
  });
});
