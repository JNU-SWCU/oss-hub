import {
  createTeamCreatedAuditMetadata,
  createTeamJoinedAuditMetadata,
  createTeamMembershipAuditMetadata,
  parseApplicationSubmittedAuditMetadata,
  parseTeamCreatedAuditMetadata,
  parseTeamJoinedAuditMetadata,
  parseTeamMembershipAuditMetadata,
  TEAM_MEMBERSHIP_AUDIT_ACTIONS,
  TEAM_MEMBERSHIP_AUDIT_OPERATIONS,
  TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION,
} from './web-state-audit-metadata';

const PROGRAM_NAME = '합성 프로그램';
const TEAM_NAME = '합성 팀';

function membership(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...createTeamMembershipAuditMetadata({
      programName: PROGRAM_NAME,
      teamName: TEAM_NAME,
      operation: TEAM_MEMBERSHIP_AUDIT_OPERATIONS.LEAVE,
      removedUserId: 'synthetic-user-1',
      previousLeaderId: 'synthetic-user-1',
      nextLeaderId: 'synthetic-user-2',
    }),
    ...overrides,
  };
}

describe('createTeamMembershipAuditMetadata', () => {
  it('한 번의 팀 구성 변경을 schemaVersion 1 스냅샷 한 행으로 봉인한다', () => {
    const metadata = createTeamMembershipAuditMetadata({
      programName: PROGRAM_NAME,
      teamName: TEAM_NAME,
      operation: TEAM_MEMBERSHIP_AUDIT_OPERATIONS.REMOVE,
      removedUserId: 'synthetic-removed',
      previousLeaderId: 'synthetic-leader',
      nextLeaderId: 'synthetic-leader',
    });

    expect(metadata.schemaVersion).toBe(TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION);
    expect(Object.keys(metadata).sort()).toEqual([
      'nextLeaderId',
      'operation',
      'previousLeaderId',
      'programName',
      'removedUserId',
      'schemaVersion',
      'teamName',
    ]);
  });

  it('action 상수는 TEAM_MEMBERSHIP_CHANGED 하나다', () => {
    expect(TEAM_MEMBERSHIP_AUDIT_ACTIONS).toEqual({
      TEAM_MEMBERSHIP_CHANGED: 'TEAM_MEMBERSHIP_CHANGED',
    });
  });
});

describe('parseTeamMembershipAuditMetadata', () => {
  it('탈퇴 후 다른 팀원에게 팀장이 승계된 사실을 그대로 되읽는다', () => {
    const metadata = createTeamMembershipAuditMetadata({
      programName: PROGRAM_NAME,
      teamName: TEAM_NAME,
      operation: TEAM_MEMBERSHIP_AUDIT_OPERATIONS.LEAVE,
      removedUserId: 'synthetic-leader',
      previousLeaderId: 'synthetic-leader',
      nextLeaderId: 'synthetic-successor',
    });

    expect(parseTeamMembershipAuditMetadata(metadata)).toEqual(metadata);
  });

  it('팀원 내보내기는 팀장이 그대로 유지된 사실을 남긴다', () => {
    const metadata = createTeamMembershipAuditMetadata({
      programName: PROGRAM_NAME,
      teamName: TEAM_NAME,
      operation: TEAM_MEMBERSHIP_AUDIT_OPERATIONS.REMOVE,
      removedUserId: 'synthetic-member',
      previousLeaderId: 'synthetic-leader',
      nextLeaderId: 'synthetic-leader',
    });

    expect(parseTeamMembershipAuditMetadata(metadata)).toMatchObject({
      operation: 'REMOVE',
      removedUserId: 'synthetic-member',
      previousLeaderId: 'synthetic-leader',
      nextLeaderId: 'synthetic-leader',
    });
  });

  it('마지막 인원이 미제출 팀을 떠나 팀이 사라진 행은 nextLeaderId를 null로 보존한다', () => {
    const metadata = createTeamMembershipAuditMetadata({
      programName: PROGRAM_NAME,
      teamName: TEAM_NAME,
      operation: TEAM_MEMBERSHIP_AUDIT_OPERATIONS.LEAVE,
      removedUserId: 'synthetic-sole',
      previousLeaderId: 'synthetic-sole',
      nextLeaderId: null,
    });

    const view = parseTeamMembershipAuditMetadata(metadata);

    expect(view).toEqual(metadata);
    expect(view?.nextLeaderId).toBeNull();
  });

  it('등록하지 않은 키는 읽기 형태에서 떨어져 나간다', () => {
    expect(
      parseTeamMembershipAuditMetadata(
        membership({ leftAtCursor: 'synthetic-cursor' }),
      ),
    ).toEqual(membership());
  });

  it('알 수 없는 operation은 거부한다', () => {
    expect(
      parseTeamMembershipAuditMetadata(membership({ operation: 'PROMOTE' })),
    ).toBeNull();
    expect(
      parseTeamMembershipAuditMetadata(membership({ operation: 'leave' })),
    ).toBeNull();
    expect(
      parseTeamMembershipAuditMetadata(membership({ operation: null })),
    ).toBeNull();
  });

  it('식별자 필드의 타입이 어긋나면 거부한다', () => {
    expect(
      parseTeamMembershipAuditMetadata(membership({ removedUserId: null })),
    ).toBeNull();
    expect(
      parseTeamMembershipAuditMetadata(membership({ removedUserId: 42 })),
    ).toBeNull();
    expect(
      parseTeamMembershipAuditMetadata(membership({ previousLeaderId: null })),
    ).toBeNull();
    expect(
      parseTeamMembershipAuditMetadata(membership({ nextLeaderId: 7 })),
    ).toBeNull();
    expect(
      parseTeamMembershipAuditMetadata(membership({ nextLeaderId: undefined })),
    ).toBeNull();
  });

  it('필드가 통째로 빠진 팀 상태 metadata는 팀 구성 변경으로 읽지 않는다', () => {
    expect(
      parseTeamMembershipAuditMetadata({
        schemaVersion: TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION,
        programName: PROGRAM_NAME,
        teamName: TEAM_NAME,
      }),
    ).toBeNull();
    expect(
      parseTeamMembershipAuditMetadata(membership({ teamName: undefined })),
    ).toBeNull();
  });

  it('금지 키가 섞이면 열지 않는다', () => {
    for (const key of ['name', 'email', 'studentId', 'joinCode', 'target']) {
      expect(
        parseTeamMembershipAuditMetadata(membership({ [key]: 'forbidden' })),
      ).toBeNull();
    }
  });
});

describe('팀 상태 parser 경계 — 팀 구성 변경 필드가 통째로 잘려나가지 않는다', () => {
  it('검증에 실패한 팀 구성 payload를 TEAM_CREATED/TEAM_JOINED/APPLICATION_SUBMITTED로 격하하지 않는다', () => {
    const malformed = membership({ operation: 'PROMOTE' });

    expect(parseTeamMembershipAuditMetadata(malformed)).toBeNull();
    expect(parseTeamCreatedAuditMetadata(malformed)).toBeNull();
    expect(parseTeamJoinedAuditMetadata(malformed)).toBeNull();
    expect(parseApplicationSubmittedAuditMetadata(malformed)).toBeNull();
  });

  it('예약 키 하나만 섞여 있어도 일반 팀 상태 parser는 닫힌다', () => {
    for (const key of [
      'operation',
      'removedUserId',
      'previousLeaderId',
      'nextLeaderId',
    ]) {
      const stored = {
        ...createTeamCreatedAuditMetadata({
          programName: PROGRAM_NAME,
          teamName: TEAM_NAME,
        }),
        [key]: 'synthetic',
      };

      expect(parseTeamCreatedAuditMetadata(stored)).toBeNull();
      expect(parseTeamJoinedAuditMetadata(stored)).toBeNull();
      expect(parseApplicationSubmittedAuditMetadata(stored)).toBeNull();
    }
  });

  it('진짜 TEAM_CREATED·TEAM_JOINED 행은 예약 키 도입 뒤에도 그대로 읽힌다', () => {
    const created = createTeamCreatedAuditMetadata({
      programName: PROGRAM_NAME,
      teamName: TEAM_NAME,
    });
    const joined = createTeamJoinedAuditMetadata({
      programName: PROGRAM_NAME,
      teamName: TEAM_NAME,
    });

    expect(parseTeamCreatedAuditMetadata(created)).toEqual(created);
    expect(parseTeamJoinedAuditMetadata(joined)).toEqual(joined);
  });
});
