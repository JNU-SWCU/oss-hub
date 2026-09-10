import { describe, expect, it } from 'vitest';
import {
  AUDIT_LOG_ACCESS_RECORD_FIXTURE,
  AUDIT_LOG_APPLICATION_APPROVED_RECORD_FIXTURE,
  AUDIT_LOG_LEGACY_RECORD_FIXTURE,
  AUDIT_LOG_PAGE_RESPONSE_FIXTURE,
  AUDIT_LOG_REPOSITORY_PUBLISHED_RECORD_FIXTURE,
  AUDIT_LOG_REPOSITORY_PUBLISHED_RESOLVED_RECORD_FIXTURE,
} from './fixtures';
import { AuditLogResponseError, parseAuditLogPage } from './parser';

describe('parseAuditLogPage', () => {
  it('실제 백엔드 응답 모양({ items, total, page, limit })을 파싱한다', () => {
    const page = parseAuditLogPage(AUDIT_LOG_PAGE_RESPONSE_FIXTURE);

    expect(page).toEqual({
      items: [
        {
          id: 'audit-access-approved',
          actor: 'synthetic-admin',
          actorHandle: 'synthetic-admin',
          action: 'STAFF_ROLE_REQUEST_APPROVED',
          targetType: 'ROLE_REQUEST',
          targetId: 'request-synthetic-1',
          target: 'synthetic-target-login',
          targetHandle: 'synthetic-target-login',
          occurredAt: '2026-07-24T03:00:00.000Z',
        },
        {
          id: 'audit-repository-published',
          actor: 'synthetic-staff',
          actorHandle: 'synthetic-staff',
          action: 'REPOSITORY_PUBLISHED',
          targetType: 'REPOSITORY',
          targetId: 'repository-synthetic-1',
          target: 'REPOSITORY / repository-synthetic-1',
          targetHandle: null,
          occurredAt: '2026-07-24T04:00:00.000Z',
        },
        {
          id: 'audit-legacy',
          actor: 'synthetic-admin',
          actorHandle: 'synthetic-admin',
          action: 'STAFF_ROLE_REQUEST_APPROVED',
          targetType: 'ROLE_REQUEST',
          targetId: 'request-legacy',
          target: 'ROLE_REQUEST / request-legacy',
          targetHandle: null,
          occurredAt: '2026-07-24T02:00:00.000Z',
        },
      ],
      total: 21,
      page: 1,
      limit: 20,
    });
  });

  it('raw metadata를 파싱 결과에서 완전히 제거한다', () => {
    const page = parseAuditLogPage(AUDIT_LOG_PAGE_RESPONSE_FIXTURE);

    for (const item of page.items) {
      expect(item).not.toHaveProperty('metadata');
      expect(item).not.toHaveProperty('legacy');
    }
  });

  it('과거의 배열 응답 계약(비페이지 모양)은 거부한다', () => {
    expect(() =>
      parseAuditLogPage([
        AUDIT_LOG_ACCESS_RECORD_FIXTURE,
        AUDIT_LOG_LEGACY_RECORD_FIXTURE,
      ]),
    ).toThrow(AuditLogResponseError);
  });

  it('page 최상위 객체에 예상 밖 키가 있으면 거부한다', () => {
    expect(() =>
      parseAuditLogPage({
        ...AUDIT_LOG_PAGE_RESPONSE_FIXTURE,
        items: [],
        unexpected: 'field',
      }),
    ).toThrow(AuditLogResponseError);
  });

  it('page 최상위 객체에 필수 키가 없으면 거부한다', () => {
    const { limit: _limit, ...withoutLimit } = AUDIT_LOG_PAGE_RESPONSE_FIXTURE;
    expect(() => parseAuditLogPage(withoutLimit)).toThrow(
      AuditLogResponseError,
    );
  });

  it('total·page·limit이 정수가 아니면 거부한다', () => {
    expect(() =>
      parseAuditLogPage({ ...AUDIT_LOG_PAGE_RESPONSE_FIXTURE, total: -1 }),
    ).toThrow(AuditLogResponseError);
    expect(() =>
      parseAuditLogPage({ ...AUDIT_LOG_PAGE_RESPONSE_FIXTURE, page: 0 }),
    ).toThrow(AuditLogResponseError);
    expect(() =>
      parseAuditLogPage({ ...AUDIT_LOG_PAGE_RESPONSE_FIXTURE, limit: 1.5 }),
    ).toThrow(AuditLogResponseError);
  });

  it('행 하나에 예상 밖 키가 있으면 거부한다', () => {
    expect(() =>
      parseAuditLogPage({
        ...AUDIT_LOG_PAGE_RESPONSE_FIXTURE,
        items: [{ ...AUDIT_LOG_ACCESS_RECORD_FIXTURE, extra: 'field' }],
      }),
    ).toThrow(AuditLogResponseError);
  });

  it('행 하나에 필수 키가 없으면 거부한다', () => {
    const { target: _target, ...withoutTarget } =
      AUDIT_LOG_ACCESS_RECORD_FIXTURE;
    expect(() =>
      parseAuditLogPage({
        ...AUDIT_LOG_PAGE_RESPONSE_FIXTURE,
        items: [withoutTarget],
      }),
    ).toThrow(AuditLogResponseError);
  });

  it('legacy가 true인데 metadata가 null이 아니면 거부한다', () => {
    expect(() =>
      parseAuditLogPage({
        ...AUDIT_LOG_PAGE_RESPONSE_FIXTURE,
        items: [
          {
            ...AUDIT_LOG_LEGACY_RECORD_FIXTURE,
            metadata: { schemaVersion: 1 },
          },
        ],
      }),
    ).toThrow(AuditLogResponseError);
  });

  it('legacy가 false인데 metadata가 null이면 거부한다', () => {
    expect(() =>
      parseAuditLogPage({
        ...AUDIT_LOG_PAGE_RESPONSE_FIXTURE,
        items: [{ ...AUDIT_LOG_ACCESS_RECORD_FIXTURE, metadata: null }],
      }),
    ).toThrow(AuditLogResponseError);
  });

  it('REPOSITORY_PUBLISHED 행(schemaVersion 1 sibling 타입)의 폴백 라벨을 그대로 통과시킨다', () => {
    const page = parseAuditLogPage({
      items: [AUDIT_LOG_REPOSITORY_PUBLISHED_RECORD_FIXTURE],
      total: 1,
      page: 1,
      limit: 20,
    });

    expect(page.items[0]).toMatchObject({
      action: 'REPOSITORY_PUBLISHED',
      target: 'REPOSITORY / repository-synthetic-1',
    });
  });

  it('REPOSITORY_PUBLISHED 행이 전체 이름(owner/name) 스냅샷을 받으면 그 라벨을 그대로 통과시킨다', () => {
    const page = parseAuditLogPage({
      items: [AUDIT_LOG_REPOSITORY_PUBLISHED_RESOLVED_RECORD_FIXTURE],
      total: 1,
      page: 1,
      limit: 20,
    });

    expect(page.items[0]).toMatchObject({
      action: 'REPOSITORY_PUBLISHED',
      target: 'synthetic-org/synthetic-repo',
    });
  });

  // TEAM_MEMBERSHIP_CHANGED 행은 백엔드 metadata에 팀장 승계 사실까지 봉인되어 온다
  // (apps/backend/src/audit-log/web-state-audit-metadata.ts). 파서는 그 중 문장에 쓸
  // 사실만 검증해 투영하고 user id와 원본 metadata는 그대로 버린다.
  function membershipWireRecord(metadata: unknown) {
    return {
      id: 'audit-team-membership',
      actor: 'synthetic-student',
      actorHandle: 'synthetic-student',
      action: 'TEAM_MEMBERSHIP_CHANGED',
      targetType: 'TEAM',
      targetId: 'team-synthetic-1',
      target: '합성 프로그램 · 합성 팀',
      targetHandle: null,
      occurredAt: '2026-07-24T07:00:00.000Z',
      legacy: false,
      metadata,
    };
  }

  function membershipMetadata(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      schemaVersion: 1,
      programName: '합성 프로그램',
      teamName: '합성 팀',
      operation: 'LEAVE',
      removedUserId: 'synthetic-leader',
      previousLeaderId: 'synthetic-leader',
      nextLeaderId: 'synthetic-successor',
      ...overrides,
    };
  }

  function parseOne(record: unknown) {
    return parseAuditLogPage({ items: [record], total: 1, page: 1, limit: 20 })
      .items[0];
  }

  it('TEAM_MEMBERSHIP_CHANGED 행의 탈퇴·승계 사실을 투영하고 user id는 내려보내지 않는다', () => {
    const item = parseOne(membershipWireRecord(membershipMetadata()));

    expect(item.teamMembership).toEqual({
      operation: 'LEAVE',
      leaderChanged: true,
      teamDeleted: false,
    });
    expect(item).not.toHaveProperty('metadata');
    expect(JSON.stringify(item)).not.toContain('synthetic-successor');
    expect(JSON.stringify(item)).not.toContain('synthetic-leader');
  });

  it('내보내기는 팀장이 그대로임을(leaderChanged=false) 남긴다', () => {
    const item = parseOne(
      membershipWireRecord(
        membershipMetadata({
          operation: 'REMOVE',
          removedUserId: 'synthetic-member',
          nextLeaderId: 'synthetic-leader',
        }),
      ),
    );

    expect(item.teamMembership).toEqual({
      operation: 'REMOVE',
      leaderChanged: false,
      teamDeleted: false,
    });
  });

  it('nextLeaderId가 null이면 팀이 삭제된 사실로 읽는다', () => {
    const item = parseOne(
      membershipWireRecord(
        membershipMetadata({
          removedUserId: 'synthetic-sole',
          previousLeaderId: 'synthetic-sole',
          nextLeaderId: null,
        }),
      ),
    );

    expect(item.teamMembership).toEqual({
      operation: 'LEAVE',
      leaderChanged: false,
      teamDeleted: true,
    });
  });

  it('계약을 벗어난 metadata는 행을 버리지 않고 상세만 비운다', () => {
    for (const broken of [
      membershipMetadata({ schemaVersion: 2 }),
      membershipMetadata({ operation: 'TRANSFER' }),
      membershipMetadata({ previousLeaderId: undefined }),
      membershipMetadata({ teamName: '' }),
      membershipMetadata({ nextLeaderId: 42 }),
    ]) {
      const item = parseOne(membershipWireRecord(broken));
      expect(item.action).toBe('TEAM_MEMBERSHIP_CHANGED');
      expect(item.target).toBe('합성 프로그램 · 합성 팀');
      expect(item).not.toHaveProperty('teamMembership');
    }
  });

  it('다른 action의 행에는 팀 구성 요약을 붙이지 않는다', () => {
    const item = parseOne({
      ...membershipWireRecord(membershipMetadata()),
      action: 'TEAM_JOINED',
    });

    expect(item).not.toHaveProperty('teamMembership');
  });

  it('APPLICATION_APPROVED 행이 합성 라벨(프로그램 이름 · @신청자) 스냅샷을 받으면 그 라벨을 그대로 통과시킨다', () => {
    const page = parseAuditLogPage({
      items: [AUDIT_LOG_APPLICATION_APPROVED_RECORD_FIXTURE],
      total: 1,
      page: 1,
      limit: 20,
    });

    expect(page.items[0]).toMatchObject({
      action: 'APPLICATION_APPROVED',
      target: '합성 프로그램 · @synthetic-applicant',
    });
  });
});
