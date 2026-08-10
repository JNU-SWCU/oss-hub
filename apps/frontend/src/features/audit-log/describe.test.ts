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

  it('target이 GitHub 로그인 스냅샷이면 target 조각을 variant=handle로 표시한다', () => {
    const { sentence } = describeAuditLog(BASE_RECORD);
    const targetSegment = sentence.find((segment) => segment.kind === 'target');
    expect(targetSegment).toMatchObject({
      kind: 'target',
      value: 'synthetic-target-login',
      variant: 'handle',
    });
  });

  it('target이 legacy 폴백(`targetType / targetId`)이면 variant=fallback, value는 targetId만 담는다', () => {
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
      value: 'request-legacy',
      variant: 'fallback',
    });
    // '님' 존칭이 코드체 폴백 값 뒤에 붙지 않고, targetType 한국어 라벨로 서술한다.
    expect(sentenceText(legacyRecord)).toBe(
      'synthetic-admin님이 권한 요청 request-legacy을(를) 승인했습니다',
    );
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
      'synthetic-staff님이 저장소 repository-synthetic-1을(를) 공개로 전환했습니다',
    );
  });

  it('PROGRAM_ARCHIVED 폴백 target(이름을 모름)은 targetId를 코드체로 서술한다', () => {
    const record: AuditLogRecord = {
      id: 'audit-program-archived-fallback',
      actor: 'synthetic-staff',
      action: 'PROGRAM_ARCHIVED',
      targetType: 'PROGRAM',
      targetId: 'program-synthetic-1',
      target: 'PROGRAM / program-synthetic-1',
      occurredAt: '2026-07-24T04:30:00.000Z',
    };

    const { sentence } = describeAuditLog(record);
    const targetSegment = sentence.find((segment) => segment.kind === 'target');
    expect(targetSegment).toMatchObject({
      kind: 'target',
      value: 'program-synthetic-1',
      variant: 'fallback',
    });
    expect(sentenceText(record)).toBe(
      'synthetic-staff님이 프로그램 program-synthetic-1을(를) 보관했습니다',
    );
  });

  it('PROGRAM_ARCHIVED가 이름 스냅샷/join으로 찾은 이름을 받으면 이름을 "@" 없이 서술한다', () => {
    const record: AuditLogRecord = {
      id: 'audit-program-archived-name',
      actor: 'synthetic-staff',
      action: 'PROGRAM_ARCHIVED',
      targetType: 'PROGRAM',
      targetId: 'program-synthetic-2',
      target: '합성 프로그램 이름',
      occurredAt: '2026-07-24T04:31:00.000Z',
    };

    const { sentence } = describeAuditLog(record);
    const targetSegment = sentence.find((segment) => segment.kind === 'target');
    expect(targetSegment).toMatchObject({
      kind: 'target',
      value: '합성 프로그램 이름',
      variant: 'name',
    });
    expect(sentenceText(record)).toBe(
      'synthetic-staff님이 프로그램 합성 프로그램 이름을(를) 보관했습니다',
    );
  });

  it('PROGRAM_RESTORED가 이름을 받으면 이름으로 서술한다', () => {
    const record: AuditLogRecord = {
      id: 'audit-program-restored-name',
      actor: 'synthetic-staff',
      action: 'PROGRAM_RESTORED',
      targetType: 'PROGRAM',
      targetId: 'program-synthetic-3',
      target: '합성 프로그램 이름',
      occurredAt: '2026-07-24T04:32:00.000Z',
    };

    expect(sentenceText(record)).toBe(
      'synthetic-staff님이 프로그램 합성 프로그램 이름을(를) 복구했습니다',
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

  it('APPLICATION_APPROVED 폴백 target은 존칭 없이 "신청 {id}을(를) 승인했습니다"로 서술한다', () => {
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
      'synthetic-staff님이 신청 application-synthetic-1을(를) 승인했습니다',
    );
  });

  it('APPLICATION_APPROVED가 (이론상) 핸들 target을 받으면 기존 "{target}님의 프로그램 신청을 승인했습니다" 문형을 유지한다', () => {
    const record: AuditLogRecord = {
      id: 'audit-application-approved-handle',
      actor: 'synthetic-staff',
      action: 'APPLICATION_APPROVED',
      targetType: 'APPLICATION',
      targetId: 'application-synthetic-2',
      target: 'synthetic-applicant-login',
      occurredAt: '2026-07-24T06:05:00.000Z',
    };

    expect(sentenceText(record)).toBe(
      'synthetic-staff님이 synthetic-applicant-login님의 프로그램 신청을 승인했습니다',
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
