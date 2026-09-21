import { ProgramCategory } from '@prisma/client';
import type { AuditLogService } from '../../audit-log/audit-log.service';
import {
  TEAM_CREATED_AUDIT_ACTIONS,
  TEAM_DELETED_AUDIT_ACTIONS,
  TEAM_MEMBERSHIP_AUDIT_ACTIONS,
  TEAM_RENAMED_AUDIT_ACTIONS,
} from '../../audit-log/audit-log-metadata';
import { DomainException } from '../../common/error-code';
import { computeJoinCodeDigest } from '../../common/join-code-digest';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import {
  type ProgramTeamsCreateStore,
  type ProgramTeamsRepository,
  type RecordTeamMembershipAudit,
  type TeamDetailRecord,
  type TeamActorAuthority,
  type TeamMembershipAuditEvent,
  type TeamMembershipAuditStore,
  type TeamProgramRecord,
  type TeamRenameAuditEvent,
  type TeamRenameResult,
  type TeamStudentActor,
} from '../repository/program-teams.repository';
import type { TeamDeletionResult } from '../repository/program-team-deletion.repository';
import { ProgramTeamsService } from './program-teams.service';
import {
  EMPTY_TEAM_DELETION_SCOPE,
  stubTeamDeletionRepository,
} from './program-teams.service.test-support';
import { TeamsErrorCode } from '../teams-error-code.enum';

const NOW = new Date('2026-07-15T00:00:00.000Z');
const GITHUB_ID = 4_242n;
const PROGRAM_ID = 'synthetic-program';
const JOIN_CODE_SECRET = 'synthetic-program-teams-secret';
const STUDENT: TeamStudentActor = {
  id: 'synthetic-student',
  name: '합성 학생',
  nickname: 'synthetic-login',
};

const TEAM_PROGRAM: TeamProgramRecord = {
  id: PROGRAM_ID,
  name: '합성 프로그램',
  category: ProgramCategory.OSS_CONTEST,
  applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
  applicationEndAt: new Date('2026-07-31T23:59:59.000Z'),
  teamMinSize: 2,
  teamMaxSize: 4,
};

const DELETED_COUNTS = {
  applications: 1,
  members: 3,
  invitations: 2,
  submissions: 4,
  submissionEvents: 7,
  detachedRepositories: 1,
};

const DETAIL: TeamDetailRecord = {
  id: 'synthetic-team',
  name: '오픈소스팀',
  leaderId: STUDENT.id,
  programId: PROGRAM_ID,
  teamMinSize: 2,
  teamMaxSize: 4,
  hasApplication: false,
  members: [
    {
      userId: STUDENT.id,
      nickname: STUDENT.nickname,
      name: STUDENT.name,
    },
  ],
};

function buildService(overrides: {
  readonly student?: TeamStudentActor | null;
  readonly program?: TeamProgramRecord | null;
  readonly detail?: TeamDetailRecord | null;
  readonly createStore?: Partial<ProgramTeamsCreateStore>;
  readonly actorAuthority?: TeamActorAuthority | null;
  readonly renameResult?: TeamRenameResult;
  readonly deletionResult?: TeamDeletionResult;
}) {
  const createTeamWithLeader = jest.fn().mockResolvedValue({
    id: 'synthetic-team',
    name: '오픈소스팀',
  });
  const findMembership = jest.fn().mockResolvedValue(null);
  const findProgramById = jest
    .fn()
    .mockResolvedValue(
      overrides.program === undefined ? TEAM_PROGRAM : overrides.program,
    );

  const auditLogWriter = {} as ProgramTeamsCreateStore['auditLogWriter'];
  const record = jest
    .fn<Promise<unknown>, Parameters<AuditLogService['record']>>()
    .mockResolvedValue(undefined);
  const createStore: ProgramTeamsCreateStore = {
    auditLogWriter,
    findMembershipByProgramUser: findMembership,
    createTeamWithLeader,
    ...overrides.createStore,
  };

  const repository = {
    findActiveStudentByGithubId: jest
      .fn()
      .mockResolvedValue(
        overrides.student === undefined ? STUDENT : overrides.student,
      ),
    findProgramById,
    findTeamDetailForUser: jest
      .fn()
      .mockResolvedValue(
        overrides.detail === undefined ? DETAIL : overrides.detail,
      ),
    withCreateTransaction: jest.fn(
      async (operation: (s: ProgramTeamsCreateStore) => Promise<unknown>) =>
        operation(createStore),
    ),
    leave: jest.fn().mockResolvedValue('removed'),
    removeMember: jest.fn().mockResolvedValue('removed'),
    findActorAuthorityByGithubId: jest
      .fn()
      .mockResolvedValue(
        overrides.actorAuthority === undefined
          ? LEADER_AUTHORITY
          : overrides.actorAuthority,
      ),
    renameTeam: jest
      .fn()
      .mockResolvedValue(overrides.renameResult ?? 'renamed'),
  } as unknown as ProgramTeamsRepository;

  const deleteTeam = jest.fn<Promise<TeamDeletionResult>, unknown[]>(() =>
    Promise.resolve(
      overrides.deletionResult ?? {
        outcome: 'deleted',
        deletedCounts: DELETED_COUNTS,
      },
    ),
  );
  const deletionRepository = stubTeamDeletionRepository({ deleteTeam });

  return {
    service: new ProgramTeamsService(
      repository,
      loadRuntimeConfig({
        TEAM_JOIN_CODE_SECRET: JOIN_CODE_SECRET,
      }),
      { record } as unknown as AuditLogService,
      deletionRepository,
    ),
    repository,
    deletionRepository,
    deleteTeam,
    createTeamWithLeader,
    findMembership,
    findProgramById,
    record,
    auditLogWriter,
    leave: jest.spyOn(repository, 'leave'),
    removeMember: jest.spyOn(repository, 'removeMember'),
    renameTeam: jest.spyOn(repository, 'renameTeam'),
    findActorAuthorityByGithubId: jest.spyOn(
      repository,
      'findActorAuthorityByGithubId',
    ),
  };
}

const LEADER_AUTHORITY: TeamActorAuthority = {
  id: STUDENT.id,
  isStaff: false,
};

const MEMBERSHIP_AUDIT_WRITER =
  {} as TeamMembershipAuditStore['auditLogWriter'];

const LEAVE_EVENT: TeamMembershipAuditEvent = {
  teamId: 'synthetic-team',
  programName: TEAM_PROGRAM.name,
  teamName: '오픈소스팀',
  operation: 'LEAVE',
  removedUserId: STUDENT.id,
  previousLeaderId: STUDENT.id,
  nextLeaderId: 'member-2',
};

/** repository 에 넘어간 감사 콜백을 트랜잭션 대신 직접 호출한다. */
async function invokeAuditCallback(
  spy: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } },
  event: TeamMembershipAuditEvent,
): Promise<void> {
  const call = spy.mock.calls.at(0);
  if (call === undefined) {
    throw new TypeError('Expected the repository mutation to be called');
  }
  const lastArgument = call.at(-1);
  if (typeof lastArgument !== 'function') {
    throw new TypeError('Expected the audit callback as the last argument');
  }
  const recordAudit = lastArgument as RecordTeamMembershipAudit;
  await recordAudit({ auditLogWriter: MEMBERSHIP_AUDIT_WRITER }, event);
}

function expectCode(error: unknown, code: TeamsErrorCode) {
  expect(error).toBeInstanceOf(DomainException);
  expect((error as DomainException).errorCode.code).toBe(code);
}

/**
 * 조회가 「없음」을 null로 돌려주게 된 뒤(QA174 / #1303), **있어야 하는** 시나리오를
 * 좁힌다. 없으면 그 자체가 실패이므로 조용히 넘기지 않고 바로 터뜨린다.
 */
function present<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`${what}이(가) 있어야 하는 시나리오다`);
  return value;
}

describe('ProgramTeamsService', () => {
  it('팀을 생성하고 평문 joinCode 를 한 번 반환하며 digest 만 저장한다', async () => {
    const { service, createTeamWithLeader } = buildService({});

    const result = await service.create(
      GITHUB_ID,
      PROGRAM_ID,
      '오픈소스팀',
      NOW,
    );

    expect(result.id).toBe('synthetic-team');
    expect(result.name).toBe('오픈소스팀');
    expect(result.memberCount).toBe(1);
    expect(result.joinCode.length).toBeGreaterThanOrEqual(8);
    expect(createTeamWithLeader).toHaveBeenCalledWith(
      expect.objectContaining({
        programId: PROGRAM_ID,
        name: '오픈소스팀',
        leaderId: STUDENT.id,
        joinCodeDigest: computeJoinCodeDigest(
          result.joinCode,
          JOIN_CODE_SECRET,
        ),
      }),
    );
  });

  it('records TEAM_CREATED once inside the create transaction without joinCode', async () => {
    const { service, record, auditLogWriter } = buildService({});

    await service.create(GITHUB_ID, PROGRAM_ID, '오픈소스팀', NOW);

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorGithubId: GITHUB_ID,
        action: TEAM_CREATED_AUDIT_ACTIONS.TEAM_CREATED,
        targetType: 'TEAM',
        targetId: 'synthetic-team',
        metadata: {
          schemaVersion: 1,
          programName: TEAM_PROGRAM.name,
          teamName: '오픈소스팀',
        },
      }),
      auditLogWriter,
    );
    const createdCall = record.mock.calls[0];
    if (createdCall === undefined) {
      throw new Error('expected TEAM_CREATED record');
    }
    expect(JSON.stringify(createdCall[0].metadata)).not.toMatch(
      /joinCode|joinCodeDigest/,
    );
  });

  it('BASIC 1..1 프로그램에서도 1인 팀을 생성한다', async () => {
    const { service, createTeamWithLeader } = buildService({
      program: {
        ...TEAM_PROGRAM,
        category: ProgramCategory.OSS_CONTEST,
        teamMinSize: 1,
        teamMaxSize: 1,
      },
    });

    const result = await service.create(GITHUB_ID, PROGRAM_ID, '1인팀', NOW);

    expect(result.id).toBe('synthetic-team');
    expect(createTeamWithLeader).toHaveBeenCalledWith(
      expect.objectContaining({
        programId: PROGRAM_ID,
        name: '1인팀',
        leaderId: STUDENT.id,
      }),
    );
  });

  it('이미 팀에 있으면 생성 409', async () => {
    const { service } = buildService({
      createStore: {
        findMembershipByProgramUser: jest.fn().mockResolvedValue({
          teamId: 'other-team',
          userId: STUDENT.id,
        }),
      },
    });

    try {
      await service.create(GITHUB_ID, PROGRAM_ID, '팀', NOW);
      throw new Error('expected throw');
    } catch (error) {
      expectCode(error, TeamsErrorCode.ALREADY_IN_PROGRAM_TEAM);
    }
  });

  /**
   * 팀 합류는 초대 수락 단독 경로다 — 참여코드로 남의 팀에 들어가는 `join` 은
   * 초대 전용 규칙을 우회하므로 service 표면에서 지웠다. 대체 호출 지점을 두지
   * 않았음을 여기서 고정한다.
   */
  it('참여코드 합류 표면을 노출하지 않는다', () => {
    const { service } = buildService({});
    const surface = service as unknown as Record<string, unknown>;

    expect(surface.join).toBeUndefined();
    const methods = Object.getOwnPropertyNames(ProgramTeamsService.prototype);
    expect(methods).not.toContain('join');
  });

  // 조회는 「없음」을 오류로 보지 않는다(QA174 / #1303). 팀을 아직 만들지 않은 학생에게
  // 팀이 없는 것은 정상이다. 탈퇴·팀원 제외 같은 변경은 여전히 TEAM_010으로 닫는다.
  it('내 팀이 없으면 null', async () => {
    const { service } = buildService({ detail: null });

    expect(await service.getMe(GITHUB_ID, PROGRAM_ID)).toBeNull();
  });

  it('내 팀을 구성원 목록과 권한 미리보기로 반환한다', async () => {
    const { service } = buildService({
      detail: {
        ...DETAIL,
        hasApplication: true,
        members: [
          ...DETAIL.members,
          {
            userId: 'member-2',
            nickname: 'member2',
            name: null,
          },
        ],
      },
    });

    const result = present(await service.getMe(GITHUB_ID, PROGRAM_ID), '내 팀');

    expect(result).toEqual({
      id: 'synthetic-team',
      name: '오픈소스팀',
      memberCount: 2,
      minMembers: 2,
      maxMembers: 4,
      hasApplication: true,
      isLeader: true,
      canInvite: true,
      canRemoveMembers: true,
      canLeave: true,
      members: [
        {
          userId: STUDENT.id,
          nickname: STUDENT.nickname,
          name: STUDENT.name,
          isLeader: true,
        },
        {
          userId: 'member-2',
          nickname: 'member2',
          name: null,
          isLeader: false,
        },
      ],
    });
    expect(result).not.toHaveProperty('joinCode');
    expect(result).not.toHaveProperty('locked');
  });

  it('신청한 1인 팀장은 나갈 수도 제외할 수도 없다고 미리 알린다', async () => {
    const { service } = buildService({
      detail: { ...DETAIL, hasApplication: true },
    });

    const result = present(await service.getMe(GITHUB_ID, PROGRAM_ID), '내 팀');

    expect(result).toMatchObject({
      memberCount: 1,
      hasApplication: true,
      isLeader: true,
      canInvite: true,
      canRemoveMembers: false,
      canLeave: false,
    });
  });

  it('미제출 1인 팀장은 나갈 수 있다', async () => {
    const { service } = buildService({ detail: DETAIL });

    const result = present(await service.getMe(GITHUB_ID, PROGRAM_ID), '내 팀');

    expect(result).toMatchObject({ canLeave: true, canRemoveMembers: false });
  });

  it('일반 팀원에게는 초대·제외 권한을 주지 않는다', async () => {
    const { service } = buildService({
      detail: {
        ...DETAIL,
        leaderId: 'member-2',
        hasApplication: true,
        members: [
          ...DETAIL.members,
          { userId: 'member-2', nickname: 'member2', name: null },
        ],
      },
    });

    const result = present(await service.getMe(GITHUB_ID, PROGRAM_ID), '내 팀');

    expect(result).toMatchObject({
      isLeader: false,
      canInvite: false,
      canRemoveMembers: false,
      canLeave: true,
    });
  });

  it('BASIC 팀 조회도 universal 1..1 범위를 반환한다', async () => {
    const { service } = buildService({
      program: {
        ...TEAM_PROGRAM,
        category: ProgramCategory.OSS_CONTEST,
        teamMinSize: 1,
        teamMaxSize: 1,
      },
      detail: {
        ...DETAIL,
        teamMinSize: 1,
        teamMaxSize: 1,
      },
    });

    const result = present(await service.getMe(GITHUB_ID, PROGRAM_ID), '내 팀');

    expect(result.maxMembers).toBe(1);
    expect(result.minMembers).toBe(1);
    expect(result.id).toBe('synthetic-team');
  });

  it('비학생은 403', async () => {
    const { service } = buildService({ student: null });

    try {
      await service.create(GITHUB_ID, PROGRAM_ID, '팀', NOW);
      throw new Error('expected throw');
    } catch (error) {
      expectCode(error, TeamsErrorCode.STUDENT_ONLY);
    }
  });

  it('신청 기간 밖 create 는 422', async () => {
    const { service } = buildService({});

    try {
      await service.create(
        GITHUB_ID,
        PROGRAM_ID,
        '팀',
        new Date('2026-08-01T00:00:00.000Z'),
      );
      throw new Error('expected throw');
    } catch (error) {
      expectCode(error, TeamsErrorCode.APPLICATION_PERIOD_CLOSED);
    }
  });

  it('신청 기록이 있는 팀의 마지막 구성원 탈퇴는 TEAM_012다', async () => {
    const { service, leave } = buildService({});
    leave.mockResolvedValue('last-member-with-application');

    try {
      await service.leave(GITHUB_ID, PROGRAM_ID);
      throw new Error('expected throw');
    } catch (error) {
      expectCode(error, TeamsErrorCode.LAST_MEMBER_WITH_APPLICATION);
    }
  });

  it('소속이 없으면 탈퇴를 TEAM_010으로 막는다', async () => {
    const { service, leave } = buildService({});
    leave.mockResolvedValue('not-found');

    try {
      await service.leave(GITHUB_ID, PROGRAM_ID);
      throw new Error('expected throw');
    } catch (error) {
      expectCode(error, TeamsErrorCode.TEAM_NOT_FOUND);
    }
  });

  /**
   * 신청 기간은 탈퇴의 조건이 아니다 — 기간이 닫힌 뒤에도 프로그램 일정을 읽지 않고
   * repository 판정으로 바로 간다.
   */
  it('신청 기간이 닫혀도 탈퇴하며 일정을 조회하지 않는다', async () => {
    const { service, leave, findProgramById } = buildService({
      program: {
        ...TEAM_PROGRAM,
        applicationEndAt: new Date('2026-07-02T00:00:00.000Z'),
      },
    });
    leave.mockResolvedValue('removed');

    await service.leave(GITHUB_ID, PROGRAM_ID);

    expect(findProgramById).not.toHaveBeenCalled();
    expect(leave).toHaveBeenCalledWith(
      PROGRAM_ID,
      STUDENT.id,
      expect.any(Function),
    );
  });

  it('비학생 탈퇴는 403이고 repository 를 부르지 않는다', async () => {
    const { service, leave } = buildService({ student: null });

    try {
      await service.leave(GITHUB_ID, PROGRAM_ID);
      throw new Error('expected throw');
    } catch (error) {
      expectCode(error, TeamsErrorCode.STUDENT_ONLY);
    }
    expect(leave).not.toHaveBeenCalled();
  });

  it('탈퇴 감사 콜백은 같은 writer 로 TEAM_MEMBERSHIP_CHANGED 를 남긴다', async () => {
    const { service, leave, record } = buildService({});
    leave.mockResolvedValue('removed');

    await service.leave(GITHUB_ID, PROGRAM_ID);
    await invokeAuditCallback(leave, LEAVE_EVENT);

    expect(record).toHaveBeenCalledWith(
      {
        actorGithubId: GITHUB_ID,
        action: TEAM_MEMBERSHIP_AUDIT_ACTIONS.TEAM_MEMBERSHIP_CHANGED,
        targetType: 'TEAM',
        targetId: LEAVE_EVENT.teamId,
        metadata: {
          schemaVersion: 1,
          programName: LEAVE_EVENT.programName,
          teamName: LEAVE_EVENT.teamName,
          operation: 'LEAVE',
          removedUserId: STUDENT.id,
          previousLeaderId: STUDENT.id,
          nextLeaderId: 'member-2',
        },
      },
      MEMBERSHIP_AUDIT_WRITER,
    );
  });

  it('팀 삭제 탈퇴는 nextLeaderId 없이 기록한다', async () => {
    const { service, leave, record } = buildService({});
    leave.mockResolvedValue('removed');

    await service.leave(GITHUB_ID, PROGRAM_ID);
    await invokeAuditCallback(leave, { ...LEAVE_EVENT, nextLeaderId: null });

    const metadataMatcher: unknown = expect.objectContaining({
      nextLeaderId: null,
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: metadataMatcher }),
      MEMBERSHIP_AUDIT_WRITER,
    );
  });

  it('감사 기록이 실패하면 콜백이 던져 repository 트랜잭션을 되돌린다', async () => {
    const failure = new Error('audit write failed');
    const { service, leave, record } = buildService({});
    record.mockRejectedValue(failure);
    leave.mockResolvedValue('removed');

    await service.leave(GITHUB_ID, PROGRAM_ID);

    await expect(invokeAuditCallback(leave, LEAVE_EVENT)).rejects.toBe(failure);
  });
});

describe('ProgramTeamsService.removeMember', () => {
  it('팀장은 다른 팀원을 제외한다', async () => {
    const { service, removeMember } = buildService({});
    removeMember.mockResolvedValue('removed');

    await service.removeMember(GITHUB_ID, PROGRAM_ID, 'member-2');

    expect(removeMember).toHaveBeenCalledWith(
      PROGRAM_ID,
      STUDENT.id,
      'member-2',
      expect.any(Function),
    );
  });

  it.each([
    ['actor-not-in-team', TeamsErrorCode.TEAM_NOT_FOUND],
    ['not-leader', TeamsErrorCode.TEAM_LEADER_REQUIRED],
    ['self-target', TeamsErrorCode.SELF_REMOVAL_REQUIRES_LEAVE],
    ['target-not-found', TeamsErrorCode.TARGET_MEMBER_NOT_FOUND],
  ] as const)('%s 결과는 %s 로 매핑된다', async (outcome, expected) => {
    const { service, removeMember } = buildService({});
    removeMember.mockResolvedValue(outcome);

    try {
      await service.removeMember(GITHUB_ID, PROGRAM_ID, 'member-2');
      throw new Error('expected throw');
    } catch (error) {
      expectCode(error, expected);
    }
  });

  it('비학생은 403이고 repository 를 부르지 않는다', async () => {
    const { service, removeMember } = buildService({ student: null });

    try {
      await service.removeMember(GITHUB_ID, PROGRAM_ID, 'member-2');
      throw new Error('expected throw');
    } catch (error) {
      expectCode(error, TeamsErrorCode.STUDENT_ONLY);
    }
    expect(removeMember).not.toHaveBeenCalled();
  });

  it('제외 감사 콜백은 REMOVE 메타데이터를 같은 writer 로 남긴다', async () => {
    const { service, removeMember, record } = buildService({});
    removeMember.mockResolvedValue('removed');

    await service.removeMember(GITHUB_ID, PROGRAM_ID, 'member-2');
    await invokeAuditCallback(removeMember, {
      ...LEAVE_EVENT,
      operation: 'REMOVE',
      removedUserId: 'member-2',
      previousLeaderId: STUDENT.id,
      nextLeaderId: STUDENT.id,
    });

    expect(record).toHaveBeenCalledWith(
      {
        actorGithubId: GITHUB_ID,
        action: TEAM_MEMBERSHIP_AUDIT_ACTIONS.TEAM_MEMBERSHIP_CHANGED,
        targetType: 'TEAM',
        targetId: LEAVE_EVENT.teamId,
        metadata: {
          schemaVersion: 1,
          programName: LEAVE_EVENT.programName,
          teamName: LEAVE_EVENT.teamName,
          operation: 'REMOVE',
          removedUserId: 'member-2',
          previousLeaderId: STUDENT.id,
          nextLeaderId: STUDENT.id,
        },
      },
      MEMBERSHIP_AUDIT_WRITER,
    );
  });
});

/**
 * 권한 동기화 outbox 예약은 구성원 변경과 같은 repository 트랜잭션 안의
 * 책임이다. service 가 그것을 대신 부르거나 별도 인자로 넘기기 시작하면
 * 트랜잭션 밖으로 새어나가서 「구성원은 빠졌는데 권한은 그대로」가 된다.
 * 그래서 service 가 닿는 repository 표면과 인자 개수를 여기서 고정한다.
 */
describe('ProgramTeamsService membership transaction boundary', () => {
  // `findActiveStudentByGithubId` 는 순수 조회라 제외하고, 예약·발급·협업자
  // 조작을 암시하는 이름만 잡는다.
  const EXTERNAL_SURFACE =
    /outbox|enqueue|provision|collaborator|revoke|accesssync|githubapp|repositorysync/i;

  function buildBoundaryService() {
    const leave = jest.fn().mockResolvedValue('removed');
    const removeMember = jest.fn().mockResolvedValue('removed');
    const findActiveStudentByGithubId = jest.fn().mockResolvedValue(STUDENT);
    const surface = { findActiveStudentByGithubId, leave, removeMember };
    const accessed: string[] = [];
    const repository = new Proxy(surface, {
      get(target, key, receiver): unknown {
        if (typeof key === 'string') {
          accessed.push(key);
          if (!(key in target)) {
            throw new TypeError(`unexpected repository surface: ${key}`);
          }
        }
        return Reflect.get(target, key, receiver);
      },
    }) as unknown as ProgramTeamsRepository;
    const record = jest
      .fn<Promise<unknown>, Parameters<AuditLogService['record']>>()
      .mockResolvedValue(undefined);

    return {
      service: new ProgramTeamsService(
        repository,
        loadRuntimeConfig({ TEAM_JOIN_CODE_SECRET: JOIN_CODE_SECRET }),
        { record } as unknown as AuditLogService,
        stubTeamDeletionRepository(),
      ),
      accessed,
      leave,
      removeMember,
    };
  }

  it('탈퇴는 repository.leave 세 인자만 부르고 다른 표면을 건드리지 않는다', async () => {
    const { service, accessed, leave } = buildBoundaryService();

    await service.leave(GITHUB_ID, PROGRAM_ID);

    expect(leave).toHaveBeenCalledWith(
      PROGRAM_ID,
      STUDENT.id,
      expect.any(Function),
    );
    expect(leave.mock.calls[0]).toHaveLength(3);
    expect([...new Set(accessed)].sort()).toEqual([
      'findActiveStudentByGithubId',
      'leave',
    ]);
  });

  it('제외는 repository.removeMember 네 인자만 부르고 다른 표면을 건드리지 않는다', async () => {
    const { service, accessed, removeMember } = buildBoundaryService();

    await service.removeMember(GITHUB_ID, PROGRAM_ID, 'member-2');

    expect(removeMember).toHaveBeenCalledWith(
      PROGRAM_ID,
      STUDENT.id,
      'member-2',
      expect.any(Function),
    );
    expect(removeMember.mock.calls[0]).toHaveLength(4);
    expect([...new Set(accessed)].sort()).toEqual([
      'findActiveStudentByGithubId',
      'removeMember',
    ]);
  });

  it.each([
    [
      'leave',
      async (service: ProgramTeamsService) =>
        service.leave(GITHUB_ID, PROGRAM_ID),
    ],
    [
      'removeMember',
      async (service: ProgramTeamsService) =>
        service.removeMember(GITHUB_ID, PROGRAM_ID, 'member-2'),
    ],
  ] as const)(
    '%s 는 outbox·GitHub·provision job 표면을 전혀 참조하지 않는다',
    async (_label, act) => {
      const { service, accessed } = buildBoundaryService();

      await act(service);

      expect(accessed.filter((key) => EXTERNAL_SURFACE.test(key))).toEqual([]);
    },
  );
});

/**
 * 팀 이름 변경 — 팀장과 교직원이 같은 endpoint를 쓴다.
 * 권한 미리보기는 service가, 최종 판정은 팀 행을 잠근 repository가 한다.
 */
describe('ProgramTeamsService.rename', () => {
  const TEAM_ID = 'synthetic-team';
  const RENAME_EVENT: TeamRenameAuditEvent = {
    teamId: TEAM_ID,
    programName: TEAM_PROGRAM.name,
    previousName: '오픈소스팀',
    nextName: '알잘딱팀',
  };

  /** repository 에 넘어간 감사 콜백을 트랜잭션 대신 직접 호출한다. */
  async function invokeRenameAudit(spy: {
    readonly mock: { readonly calls: readonly (readonly unknown[])[] };
  }): Promise<void> {
    const call = spy.mock.calls.at(0);
    if (call === undefined) {
      throw new TypeError('Expected repository.renameTeam to be called');
    }
    const record = call.at(4);
    if (typeof record !== 'function') {
      throw new TypeError('Expected an audit callback argument');
    }
    await (
      record as (
        store: TeamMembershipAuditStore,
        event: TeamRenameAuditEvent,
      ) => Promise<void>
    )({ auditLogWriter: MEMBERSHIP_AUDIT_WRITER }, RENAME_EVENT);
  }

  it('팀장이 바꾸면 바뀐 이름을 돌려주고 잠금 판정을 repository 에 넘긴다', async () => {
    const { service, renameTeam } = buildService({});

    const view = await service.rename(
      GITHUB_ID,
      PROGRAM_ID,
      TEAM_ID,
      '  알잘딱팀  ',
    );

    expect(view).toEqual({ teamId: TEAM_ID, name: '알잘딱팀' });
    expect(renameTeam).toHaveBeenCalledWith(
      PROGRAM_ID,
      TEAM_ID,
      { id: STUDENT.id, isStaff: false },
      '알잘딱팀',
      expect.any(Function),
    );
  });

  it.each([
    ['교직원', { id: 'staff-1', isStaff: true }],
    ['관리자', { id: 'admin-1', isStaff: true }],
  ] as const)(
    '%s 는 남의 팀 이름도 바꿀 수 있다',
    async (_label, authority) => {
      const { service, renameTeam } = buildService({
        actorAuthority: authority,
      });

      await service.rename(GITHUB_ID, PROGRAM_ID, TEAM_ID, '알잘딱팀');

      expect(renameTeam).toHaveBeenCalledWith(
        PROGRAM_ID,
        TEAM_ID,
        authority,
        '알잘딱팀',
        expect.any(Function),
      );
    },
  );

  it('비활성·없는 계정은 repository 를 부르기 전에 403 으로 막는다', async () => {
    const { service, renameTeam } = buildService({ actorAuthority: null });

    try {
      await service.rename(GITHUB_ID, PROGRAM_ID, TEAM_ID, '알잘딱팀');
      throw new TypeError('Expected rename to reject');
    } catch (error) {
      expectCode(error, TeamsErrorCode.TEAM_RENAME_FORBIDDEN);
    }
    expect(renameTeam).not.toHaveBeenCalled();
  });

  it.each([
    ['forbidden', TeamsErrorCode.TEAM_RENAME_FORBIDDEN],
    ['not-found', TeamsErrorCode.TARGET_TEAM_NOT_FOUND],
  ] as const)('%s 결과는 %s 로 매핑된다', async (outcome, expected) => {
    const { service } = buildService({ renameResult: outcome });

    try {
      await service.rename(GITHUB_ID, PROGRAM_ID, TEAM_ID, '알잘딱팀');
      throw new TypeError('Expected rename to reject');
    } catch (error) {
      expectCode(error, expected);
    }
  });

  it('감사에는 바뀐 이름과 바뀌기 전 이름을 함께 남긴다', async () => {
    const { service, renameTeam, record } = buildService({});

    await service.rename(GITHUB_ID, PROGRAM_ID, TEAM_ID, '알잘딱팀');
    await invokeRenameAudit(renameTeam);

    expect(record).toHaveBeenCalledWith(
      {
        actorGithubId: GITHUB_ID,
        action: TEAM_RENAMED_AUDIT_ACTIONS.TEAM_RENAMED,
        targetType: 'TEAM',
        targetId: TEAM_ID,
        metadata: {
          schemaVersion: 1,
          programName: TEAM_PROGRAM.name,
          teamName: '알잘딱팀',
          previousName: '오픈소스팀',
        },
      },
      MEMBERSHIP_AUDIT_WRITER,
    );
  });
});

/**
 * 교직원 팀 삭제 — 새 Guard 없이 service 가 교직원을 판정하고, 무엇이 함께 지워지는지는
 * 확인 화면이 본 `expectedScope` 를 서버가 트랜잭션 안에서 다시 세서 맞춘다.
 */
describe('ProgramTeamsService.deleteForStaff', () => {
  const TEAM_ID = 'synthetic-team';
  const STAFF_AUTHORITY = { id: 'staff-1', isStaff: true } as const;
  const EXPECTED_SCOPE = {
    ...EMPTY_TEAM_DELETION_SCOPE,
    applications: 1,
    members: 3,
  };

  it('교직원은 확인한 범위를 그대로 repository 에 넘기고 지운 수치를 돌려받는다', async () => {
    const { service, deleteTeam } = buildService({
      actorAuthority: STAFF_AUTHORITY,
    });

    await expect(
      service.deleteForStaff(GITHUB_ID, PROGRAM_ID, TEAM_ID, EXPECTED_SCOPE),
    ).resolves.toEqual({
      teamId: TEAM_ID,
      deleted: true,
      deletedCounts: DELETED_COUNTS,
    });
    expect(deleteTeam).toHaveBeenCalledWith(
      PROGRAM_ID,
      TEAM_ID,
      EXPECTED_SCOPE,
      expect.any(Function),
      expect.any(Function),
    );
  });

  it.each([
    ['팀장', { id: STUDENT.id, isStaff: false }],
    ['비활성·없는 계정', null],
  ] as const)(
    '%s 은 repository 를 부르기 전에 403 으로 막힌다',
    async (_label, authority) => {
      const { service, deleteTeam } = buildService({
        actorAuthority: authority,
      });

      try {
        await service.deleteForStaff(
          GITHUB_ID,
          PROGRAM_ID,
          TEAM_ID,
          EXPECTED_SCOPE,
        );
        throw new TypeError('Expected deleteForStaff to reject');
      } catch (error) {
        expectCode(error, TeamsErrorCode.TEAM_DELETE_FORBIDDEN);
      }
      expect(deleteTeam).not.toHaveBeenCalled();
    },
  );

  it('없는 팀·다른 프로그램의 팀은 구분 없는 404 다', async () => {
    const { service } = buildService({
      actorAuthority: STAFF_AUTHORITY,
      deletionResult: { outcome: 'not-found' },
    });

    try {
      await service.deleteForStaff(
        GITHUB_ID,
        PROGRAM_ID,
        TEAM_ID,
        EXPECTED_SCOPE,
      );
      throw new TypeError('Expected deleteForStaff to reject');
    } catch (error) {
      expectCode(error, TeamsErrorCode.TARGET_TEAM_NOT_FOUND);
    }
  });

  // 확인 이후 생긴 행이 누르는 사람 모르게 지워지는 것을 막는다(409 TEAM_019).
  it('범위가 어긋나면 409 와 함께 현재 범위를 돌려줌다', async () => {
    const currentScopeCounts = { ...EXPECTED_SCOPE, submissions: 2 };
    const { service } = buildService({
      actorAuthority: STAFF_AUTHORITY,
      deletionResult: { outcome: 'scope-changed', currentScopeCounts },
    });

    try {
      await service.deleteForStaff(
        GITHUB_ID,
        PROGRAM_ID,
        TEAM_ID,
        EXPECTED_SCOPE,
      );
      throw new TypeError('Expected deleteForStaff to reject');
    } catch (error) {
      expectCode(error, TeamsErrorCode.TEAM_DELETE_SCOPE_CHANGED);
      expect(error).toBeInstanceOf(DomainException);
      expect((error as DomainException).extensions).toEqual({
        currentTeamScopeCounts: currentScopeCounts,
      });
    }
  });

  // 승인된 팀을 막는 차단 규칙을 두지 않기로 한 결정의 회귀 방지 — 막으면 운영을 맡은
  // 교직원이 승인된 팀을 영영 정리할 수 없어진다. 안전장치는 범위 재확인이지 차단이 아니다.
  it('신청·제출이 있는 팀도 범위만 맞으면 지워진다', async () => {
    const heavyScope = {
      ...EMPTY_TEAM_DELETION_SCOPE,
      applications: 1,
      members: 4,
      submissions: 6,
      submissionEvents: 12,
      detachedRepositories: 1,
    };
    const { service, deleteTeam } = buildService({
      actorAuthority: STAFF_AUTHORITY,
    });

    await expect(
      service.deleteForStaff(GITHUB_ID, PROGRAM_ID, TEAM_ID, heavyScope),
    ).resolves.toMatchObject({ deleted: true });
    expect(deleteTeam).toHaveBeenCalledWith(
      PROGRAM_ID,
      TEAM_ID,
      heavyScope,
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('감사에는 팀 이름과 함께 사라진 수치를 남긴다', async () => {
    const { service, deleteTeam, record } = buildService({
      actorAuthority: STAFF_AUTHORITY,
    });

    await service.deleteForStaff(
      GITHUB_ID,
      PROGRAM_ID,
      TEAM_ID,
      EXPECTED_SCOPE,
    );
    const recordAudit = deleteTeam.mock.calls.at(0)?.at(3);
    if (typeof recordAudit !== 'function') {
      throw new TypeError('Expected an audit callback argument');
    }
    await (
      recordAudit as (
        store: TeamMembershipAuditStore,
        event: {
          readonly teamId: string;
          readonly programName: string;
          readonly teamName: string;
          readonly deletedCounts: typeof DELETED_COUNTS;
        },
      ) => Promise<void>
    )(
      { auditLogWriter: MEMBERSHIP_AUDIT_WRITER },
      {
        teamId: TEAM_ID,
        programName: TEAM_PROGRAM.name,
        teamName: '오픈소스팀',
        deletedCounts: DELETED_COUNTS,
      },
    );

    expect(record).toHaveBeenCalledWith(
      {
        actorGithubId: GITHUB_ID,
        action: TEAM_DELETED_AUDIT_ACTIONS.TEAM_DELETED,
        targetType: 'TEAM',
        targetId: TEAM_ID,
        metadata: {
          schemaVersion: 1,
          programName: TEAM_PROGRAM.name,
          teamName: '오픈소스팀',
          deletedCounts: DELETED_COUNTS,
        },
      },
      MEMBERSHIP_AUDIT_WRITER,
    );
  });
});
