import { ProgramCategory } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { computeJoinCodeDigest } from '../common/join-code-digest';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import {
  type ProgramTeamsCreateStore,
  type ProgramTeamsJoinStore,
  type ProgramTeamsRepository,
  type TeamDetailRecord,
  type TeamProgramRecord,
  type TeamStudentActor,
} from './program-teams.repository';
import { ProgramTeamsService } from './program-teams.service';
import { TeamsErrorCode } from './teams-error-code.enum';

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

  const createStore: ProgramTeamsCreateStore = {
    findMembershipByProgramUser: findMembership,
    createTeamWithLeader,
    ...overrides.createStore,
  };

  const joinStore: ProgramTeamsJoinStore = {
    findMembershipByProgramUser: findMembership,
    findTeamByJoinCodeDigest,
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
    ),
    repository,
    createTeamWithLeader,
    addMember,
    findMembership,
    findTeamByJoinCodeDigest,
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

  it('개인형 프로그램은 422 로 팀 API 를 막는다', async () => {
    const { service } = buildService({
      program: {
        ...TEAM_PROGRAM,
        category: ProgramCategory.BASIC,
        teamMinSize: null,
        teamMaxSize: null,
      },
    });

    try {
      await service.create(GITHUB_ID, PROGRAM_ID, '팀', NOW);
      throw new Error('expected throw');
    } catch (error) {
      expectCode(error, TeamsErrorCode.TEAM_NOT_ALLOWED);
      expect((error as DomainException).errorCode.status).toBe(422);
    }
  });

  it('teamMaxSize 가 null 이면 422 misconfigured', async () => {
    const { service } = buildService({
      program: { ...TEAM_PROGRAM, teamMaxSize: null },
    });

    try {
      await service.create(GITHUB_ID, PROGRAM_ID, '팀', NOW);
      throw new Error('expected throw');
    } catch (error) {
      expectCode(error, TeamsErrorCode.TEAM_SIZE_MISCONFIGURED);
    }
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
    const { service, addMember, findTeamByJoinCodeDigest } = buildService({});
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
    expect(addMember).toHaveBeenCalledWith(
      'synthetic-team',
      PROGRAM_ID,
      STUDENT.id,
    );
    expect(result.id).toBe('synthetic-team');
    expect(result).not.toHaveProperty('joinCode');
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
