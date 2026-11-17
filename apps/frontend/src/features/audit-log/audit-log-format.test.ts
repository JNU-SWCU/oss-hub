import { describe, expect, it } from 'vitest';
import {
  actionLabel,
  changeLabel,
  dayLabel,
  targetLabel,
} from './audit-log-format';
import { parseAuditLogPage } from './parser';
import {
  AUDIT_LOG_PAGE_RESPONSE_FIXTURE,
  AUDIT_LOG_ROLE_CHANGE_RECORD_FIXTURE,
} from './fixtures';

const [roleChange] = parseAuditLogPage({
  ...AUDIT_LOG_PAGE_RESPONSE_FIXTURE,
  items: [AUDIT_LOG_ROLE_CHANGE_RECORD_FIXTURE],
}).items;

describe('audit log formatting', () => {
  it('uses the membership operation decided by the backend for the action label', () => {
    const record = {
      ...roleChange,
      action: 'TEAM_MEMBERSHIP_CHANGED',
      change: null,
      teamMembership: {
        operation: 'LEAVE',
        leaderChanged: false,
        teamDeleted: true,
      },
    } as const;

    expect(actionLabel(record)).toBe('팀 탈퇴');
    expect(changeLabel(record)).toEqual({
      before: null,
      after: null,
      note: '남은 팀원이 없어 팀 삭제',
      field: null,
    });
  });

  it('labels a first type choice separately from a later type change', () => {
    expect(
      actionLabel({
        ...roleChange,
        change: { field: 'userType', before: 'UNSELECTED', after: 'STUDENT' },
      }),
    ).toBe('회원 유형 선택');
    expect(actionLabel(roleChange)).toBe('회원 유형 변경');
  });

  it('keeps an unknown action code and target id visible', () => {
    const record = {
      ...roleChange,
      action: 'FUTURE_ACTION',
      target: {
        ...roleChange.target,
        type: 'ROLE_REQUEST',
        name: null,
        login: null,
      },
    };

    expect(actionLabel(record)).toBe('FUTURE_ACTION');
    expect(targetLabel(record)).toEqual({
      primary: '권한 요청 user-target',
      handle: null,
      context: null,
      fallback: true,
    });
  });

  it('shows team renames verbatim instead of mapping them as codes', () => {
    expect(
      changeLabel({
        ...roleChange,
        action: 'TEAM_RENAMED',
        change: { field: 'teamName', before: 'PUBLIC', after: '새 팀' },
      }),
    ).toEqual({ field: null, before: 'PUBLIC', after: '새 팀', note: null });
  });

  it('labels a changed grant even when the effective role does not change', () => {
    expect(
      changeLabel({
        ...roleChange,
        action: 'REVOKE_STAFF_ACCESS',
        change: { field: 'hasStaffAccess', before: true, after: false },
      }),
    ).toEqual({
      field: '교직원 접근',
      before: '있음',
      after: '없음',
      note: null,
    });
  });

  it('adds the year to day labels outside the current year', () => {
    expect(
      dayLabel(
        '2025-03-02T01:00:00.000Z',
        new Date('2026-11-17T06:00:00.000Z'),
      ),
    ).toBe('2025년 3월 2일 (일)');
  });
});
