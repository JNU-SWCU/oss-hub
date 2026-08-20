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
