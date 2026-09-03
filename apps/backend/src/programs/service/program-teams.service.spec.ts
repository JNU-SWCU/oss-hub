import { ProgramCategory } from '@prisma/client';
import type { AuditLogService } from '../../audit-log/audit-log.service';
import {
  TEAM_CREATED_AUDIT_ACTIONS,
  TEAM_JOINED_AUDIT_ACTIONS,
} from '../../audit-log/audit-log-metadata';
import { DomainException } from '../../common/error-code';
import { computeJoinCodeDigest } from '../../common/join-code-digest';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import {
  type ProgramTeamsCreateStore,
  type ProgramTeamsJoinStore,
  type ProgramTeamsRepository,
  type TeamDetailRecord,
  type TeamProgramRecord,
  type TeamStudentActor,
} from '../repository/program-teams.repository';
import { ProgramTeamsService } from './program-teams.service';
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
  readonly joinStore?: Partial<ProgramTeamsJoinStore>;
}) {
  const createTeamWithLeader = jest.fn().mockResolvedValue({
    id: 'synthetic-team',
    name: '오픈소스팀',
  });
  const addMember = jest.fn().mockResolvedValue(undefined);
  const findMembership = jest.fn().mockResolvedValue(null);
  const findTeamByJoinCodeDigest = jest.fn().mockResolvedValue({
    id: 'synthetic-team',
    programId: PROGRAM_ID,
    name: '오픈소스팀',
    leaderId: 'leader-id',
    memberCount: 1,
    hasApplication: false,
  });
  // lockTeamForJoin 은 기본적으로 pre-lock 스냅샷(findTeamByJoinCodeDigest)과
  // 같은 값을 재확인해 준다고 가정한다 — 경합을 시뮬레이션하는 테스트만 다른
  // 값으로 override 한다.
  const lockTeamForJoin = jest
    .fn()
    .mockResolvedValue({ memberCount: 1, hasApplication: false });

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

  const joinStore: ProgramTeamsJoinStore = {
    auditLogWriter,
    findMembershipByProgramUser: findMembership,
    findTeamByJoinCodeDigest,
    lockTeamForJoin,
    addMember,
    ...overrides.joinStore,
  };

  const repository = {
    findActiveStudentByGithubId: jest
      .fn()
      .mockResolvedValue(
        overrides.student === undefined ? STUDENT : overrides.student,
      ),
    findProgramById: jest
      .fn()
      .mockResolvedValue(
        overrides.program === undefined ? TEAM_PROGRAM : overrides.program,
      ),
    findTeamDetailForUser: jest
      .fn()
      .mockResolvedValue(
        overrides.detail === undefined ? DETAIL : overrides.detail,
      ),
    withCreateTransaction: jest.fn(
      async (operation: (s: ProgramTeamsCreateStore) => Promise<unknown>) =>
        operation(createStore),
    ),
    withJoinTransaction: jest.fn(
      async (operation: (s: ProgramTeamsJoinStore) => Promise<unknown>) =>
        operation(joinStore),
    ),
  } as unknown as ProgramTeamsRepository;

  return {
    service: new ProgramTeamsService(
      repository,
      loadRuntimeConfig({
        TEAM_JOIN_CODE_SECRET: JOIN_CODE_SECRET,
      }),
      { record } as unknown as AuditLogService,
    ),
    repository,
    createTeamWithLeader,
    addMember,
    findMembership,
    findTeamByJoinCodeDigest,
    lockTeamForJoin,
    record,
    auditLogWriter,
  };
}

function expectCode(error: unknown, code: TeamsErrorCode) {
  expect(error).toBeInstanceOf(DomainException);
  expect((error as DomainException).errorCode.code).toBe(code);
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

  it('참여코드로 합류한다', async () => {
    const { service, addMember, findTeamByJoinCodeDigest, lockTeamForJoin } =
      buildService({});
    const joinCode = 'ABCD1234XY';
    findTeamByJoinCodeDigest.mockResolvedValue({
      id: 'synthetic-team',
      programId: PROGRAM_ID,
      name: '오픈소스팀',
      leaderId: 'leader-id',
      memberCount: 1,
      hasApplication: false,
    });

    const result = await service.join(GITHUB_ID, PROGRAM_ID, joinCode, NOW);

    expect(findTeamByJoinCodeDigest).toHaveBeenCalledWith(
      PROGRAM_ID,
      computeJoinCodeDigest(joinCode, JOIN_CODE_SECRET),
    );
    expect(lockTeamForJoin).toHaveBeenCalledWith('synthetic-team');
    expect(addMember).toHaveBeenCalledWith(
      'synthetic-team',
      PROGRAM_ID,
      STUDENT.id,
    );
    expect(result.id).toBe('synthetic-team');
    expect(result).not.toHaveProperty('joinCode');
  });

  it('records TEAM_JOINED once inside the join transaction without joinCode', async () => {
    const { service, record, auditLogWriter, findTeamByJoinCodeDigest } =
      buildService({});
    findTeamByJoinCodeDigest.mockResolvedValue({
      id: 'synthetic-team',
      programId: PROGRAM_ID,
      name: '오픈소스팀',
      leaderId: 'leader-id',
      memberCount: 1,
      hasApplication: false,
    });

    await service.join(GITHUB_ID, PROGRAM_ID, 'ABCD1234XY', NOW);

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorGithubId: GITHUB_ID,
        action: TEAM_JOINED_AUDIT_ACTIONS.TEAM_JOINED,
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
    const joinedCall = record.mock.calls[0];
    if (joinedCall === undefined) {
      throw new Error('expected TEAM_JOINED record');
    }
    expect(JSON.stringify(joinedCall[0].metadata)).not.toMatch(
      /joinCode|joinCodeDigest/,
    );
  });

  it('잠금 전 스냅샷엔 여유가 있어도, 잠근 뒤 재조회에서 정원이 찼으면 409(#164 패턴)', async () => {
    const { service, addMember, findTeamByJoinCodeDigest, lockTeamForJoin } =
      buildService({});
    findTeamByJoinCodeDigest.mockResolvedValue({
      id: 'synthetic-team',
      programId: PROGRAM_ID,
      name: '오픈소스팀',
      leaderId: 'leader-id',
      memberCount: 1,
      hasApplication: false,
    });
    // 동시 합류 경합으로 잠금 뒤 재조회한 값이 이미 정원을 채운 상태를 시뮬레이션한다.
    lockTeamForJoin.mockResolvedValue({
      memberCount: 4,
      hasApplication: false,
    });

    try {
      await service.join(GITHUB_ID, PROGRAM_ID, 'CODE', NOW);
      throw new Error('expected throw');
    } catch (error) {
      expectCode(error, TeamsErrorCode.TEAM_FULL);
    }
    expect(addMember).not.toHaveBeenCalled();
  });

  it('잠금 전 스냅샷엔 신청이 없어도, 잠근 뒤 재조회에서 신청이 있으면 409 locked', async () => {
    const { service, addMember, findTeamByJoinCodeDigest, lockTeamForJoin } =
      buildService({});
    findTeamByJoinCodeDigest.mockResolvedValue({
      id: 'synthetic-team',
      programId: PROGRAM_ID,
      name: '오픈소스팀',
      leaderId: 'leader-id',
      memberCount: 1,
      hasApplication: false,
    });
    lockTeamForJoin.mockResolvedValue({
      memberCount: 1,
      hasApplication: true,
    });

    try {
      await service.join(GITHUB_ID, PROGRAM_ID, 'CODE', NOW);
      throw new Error('expected throw');
    } catch (error) {
      expectCode(error, TeamsErrorCode.TEAM_LOCKED_AFTER_APPLICATION);
    }
    expect(addMember).not.toHaveBeenCalled();
  });

  it('정원 미만이면 제3자 합류를 허용한다', async () => {
    const availableDetail: TeamDetailRecord = {
      ...DETAIL,
      teamMinSize: 1,
      teamMaxSize: 13,
      leaderId: 'leader-id',
      members: [
        {
          userId: 'leader-id',
          nickname: 'leader',
          name: '리더',
        },
        {
          userId: STUDENT.id,
          nickname: STUDENT.nickname,
          name: STUDENT.name,
        },
      ],
    };
    const { service, addMember, findTeamByJoinCodeDigest } = buildService({
      program: {
        ...TEAM_PROGRAM,
        category: ProgramCategory.OSS_CONTEST,
        teamMinSize: 1,
        teamMaxSize: 13,
      },
      detail: availableDetail,
    });
    findTeamByJoinCodeDigest.mockResolvedValue({
      id: 'synthetic-team',
      programId: PROGRAM_ID,
      name: '오픈소스팀',
      leaderId: 'leader-id',
      memberCount: 12,
      hasApplication: false,
    });

    const result = await service.join(GITHUB_ID, PROGRAM_ID, 'OPENJOIN01', NOW);

    expect(addMember).toHaveBeenCalledWith(
      'synthetic-team',
      PROGRAM_ID,
      STUDENT.id,
    );
    expect(result.maxMembers).toBe(13);
    expect(result.memberCount).toBe(2);
  });

  it('최대 인원 초과 합류는 409', async () => {
    const { service, findTeamByJoinCodeDigest } = buildService({});
    findTeamByJoinCodeDigest.mockResolvedValue({
      id: 'synthetic-team',
      programId: PROGRAM_ID,
      name: '오픈소스팀',
      leaderId: 'leader-id',
      memberCount: 4,
      hasApplication: false,
    });

    try {
      await service.join(GITHUB_ID, PROGRAM_ID, 'CODE', NOW);
      throw new Error('expected throw');
    } catch (error) {
      expectCode(error, TeamsErrorCode.TEAM_FULL);
    }
  });

  it('신청 제출 후 합류는 409 locked', async () => {
    const { service, findTeamByJoinCodeDigest } = buildService({});
    findTeamByJoinCodeDigest.mockResolvedValue({
      id: 'synthetic-team',
      programId: PROGRAM_ID,
      name: '오픈소스팀',
      leaderId: 'leader-id',
      memberCount: 1,
      hasApplication: true,
    });

    try {
      await service.join(GITHUB_ID, PROGRAM_ID, 'CODE', NOW);
      throw new Error('expected throw');
    } catch (error) {
      expectCode(error, TeamsErrorCode.TEAM_LOCKED_AFTER_APPLICATION);
    }
  });

  it('잘못된 참여코드는 404', async () => {
    const { service, findTeamByJoinCodeDigest } = buildService({});
    findTeamByJoinCodeDigest.mockResolvedValue(null);

    try {
      await service.join(GITHUB_ID, PROGRAM_ID, 'UNKNOWN', NOW);
      throw new Error('expected throw');
    } catch (error) {
      expectCode(error, TeamsErrorCode.JOIN_CODE_NOT_FOUND);
    }
  });

  it('내 팀이 없으면 404', async () => {
    const { service } = buildService({ detail: null });

    try {
      await service.getMe(GITHUB_ID, PROGRAM_ID);
      throw new Error('expected throw');
    } catch (error) {
      expectCode(error, TeamsErrorCode.TEAM_NOT_FOUND);
    }
  });

  it('내 팀을 구성원 목록과 잠금 상태로 반환한다', async () => {
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

    const result = await service.getMe(GITHUB_ID, PROGRAM_ID);

    expect(result).toEqual({
      id: 'synthetic-team',
      name: '오픈소스팀',
      memberCount: 2,
      minMembers: 2,
      maxMembers: 4,
      locked: true,
      isLeader: true,
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

    const result = await service.getMe(GITHUB_ID, PROGRAM_ID);

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
});
