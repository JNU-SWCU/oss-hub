import {
  ApplicationStatus,
  ProgramCategory,
  ProgramLifecycle,
  RepositoryConnectionMode,
} from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  ApplicationDuplicateError,
  ApplicationJoinCodeDigestConflictError,
  ApplicationTeamMembershipConflictError,
  type ApplicationCreateStore,
  type ApplicationsRepository,
  type ApplyProgramRecord,
  type ApplicationStudentActor,
  type CreatedApplication,
} from './applications.repository';
import { ApplicationsErrorCode } from './applications-error-code.enum';
import { ApplicationsService } from './applications.service';
import type { AuditLogService } from '../audit-log/audit-log.service';

/** 이 스펙들은 판정 경로를 타지 않으므로 감사 기록기는 호출되지 않는다. */
const noopAuditLog = { record: jest.fn() } as unknown as AuditLogService;

const NOW = new Date('2026-07-15T00:00:00.000Z');
const GITHUB_ID = 4_242n;
const PROGRAM_ID = 'synthetic-program';
const STUDENT: ApplicationStudentActor = {
  id: 'synthetic-student',
  name: '합성 학생',
  nickname: 'synthetic-login',
};

const OPEN_PROGRAM: ApplyProgramRecord = {
  id: PROGRAM_ID,
  category: ProgramCategory.BASIC,
  lifecycle: ProgramLifecycle.PUBLISHED,
  applicationTemplateVersion: 1,
  applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
  applicationEndAt: new Date('2026-07-31T23:59:59.000Z'),
};

const CREATED: CreatedApplication = {
  id: 'synthetic-application',
  programId: PROGRAM_ID,
  status: ApplicationStatus.SUBMITTED,
  teamId: 'synthetic-team',
  submittedAt: NOW,
  isRepositoryPublicationPlanned: true,
  repositoryConnectionMode: RepositoryConnectionMode.NEW,
  repositoryUrl: null,
};

const DEFAULT_INPUT = {
  answers: { title: '제목', summary: '요약' },
  teamName: null as string | null,
  applicationTemplateVersion: 1,
  isRepositoryPublicationPlanned: true,
  repositoryConnectionMode: RepositoryConnectionMode.NEW,
  repositoryUrl: null as string | null,
};

function buildService(overrides: {
  readonly student?: ApplicationStudentActor | null;
  readonly program?: ApplyProgramRecord | null;
  readonly store?: Partial<ApplicationCreateStore>;
  readonly createThrows?: Error;
  readonly createTeamThrows?: Error | readonly Error[];
  readonly joinCodes?: readonly string[];
}) {
  const createApplication = jest.fn().mockImplementation((input: unknown) => {
    if (overrides.createThrows) {
      return Promise.reject(overrides.createThrows);
    }
    const rawTeamId =
      typeof input === 'object' && input !== null && 'teamId' in input
        ? Reflect.get(input, 'teamId')
        : null;
    const teamId = typeof rawTeamId === 'string' ? rawTeamId : CREATED.teamId;
    const created: CreatedApplication = {
      ...CREATED,
      teamId,
    };
    return Promise.resolve(created);
  });

  let createTeamCall = 0;
  const createTeamWithLeader = jest
    .fn()
    .mockImplementation((input: { readonly name: string }) => {
      const throws = overrides.createTeamThrows;
      if (throws instanceof Error) {
        return Promise.reject(throws);
      }
      if (throws) {
        const error: Error | undefined = throws[createTeamCall];
        createTeamCall += 1;
        if (error) return Promise.reject(error);
      }
      return Promise.resolve({
        id: 'synthetic-team',
        name: input.name,
      });
    });

  const store: ApplicationCreateStore = {
    lockProgramForApply: jest
      .fn()
      .mockResolvedValue(ProgramLifecycle.PUBLISHED),
    findTeamMinSize: jest.fn().mockResolvedValue(null),
    createTeamWithLeader,
    createApplication,
    ...overrides.store,
  };

  let joinCodeCall = 0;
  const joinCodes = overrides.joinCodes ?? ['JOINCODE01'];
  const repository = {
    findActiveStudentByGithubId: jest
      .fn()
      .mockResolvedValue(
        overrides.student === undefined ? STUDENT : overrides.student,
      ),
    findProgramById: jest
      .fn()
      .mockResolvedValue(
        overrides.program === undefined ? OPEN_PROGRAM : overrides.program,
      ),
    generateJoinCode: jest.fn().mockImplementation(() => {
      const code = joinCodes[joinCodeCall] ?? `JOINCODE0${joinCodeCall + 1}`;
      joinCodeCall += 1;
      return code;
    }),
    computeJoinCodeDigest: jest
      .fn()
      .mockImplementation((joinCode: string) => `digest:${joinCode}`),
    withCreateTransaction: jest.fn(
      async (operation: (s: ApplicationCreateStore) => Promise<unknown>) =>
        operation(store),
    ),
    withTransaction: jest.fn(),
    findRepositoryProvisionEvent: jest.fn(),
  } as unknown as ApplicationsRepository;

  return {
    service: new ApplicationsService(repository, noopAuditLog),
    repository,
    store,
    createApplication,
    createTeamWithLeader,
  };
}

describe('ApplicationsService.create', () => {
  it('내린 프로그램 신청을 전용 오류로 차단한다', async () => {
    const { service, createApplication } = buildService({
      program: { ...OPEN_PROGRAM, lifecycle: ProgramLifecycle.ARCHIVED },
    });

    await expect(
      service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.PROGRAM_ARCHIVED, status: 422 },
    });
    expect(createApplication).not.toHaveBeenCalled();
  });

  it('신청 시 1인 팀을 만들고 leader 가 신청자이며 SUBMITTED 로 생성한다', async () => {
    const { service, createApplication, createTeamWithLeader } = buildService(
      {},
    );

    const result = await service.create(
      GITHUB_ID,
      PROGRAM_ID,
      DEFAULT_INPUT,
      NOW,
    );

    expect(result).toMatchObject({
      id: 'synthetic-application',
      status: ApplicationStatus.SUBMITTED,
      teamId: 'synthetic-team',
    });
    expect(createTeamWithLeader).toHaveBeenCalledWith({
      programId: PROGRAM_ID,
      name: '합성 학생',
      joinCodeDigest: 'digest:JOINCODE01',
      leaderId: STUDENT.id,
    });
    expect(createApplication).toHaveBeenCalledWith({
      programId: PROGRAM_ID,
      applicantId: STUDENT.id,
      teamId: 'synthetic-team',
      answers: {
        applicantName: '합성 학생',
        title: '제목',
        summary: '요약',
      },
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: true,
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      repositoryUrl: null,
    });
  });

  it('팀 이름 미입력 시 신청자 표시명 기반 기본값을 쓴다', async () => {
    const { service, createTeamWithLeader } = buildService({});

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(createTeamWithLeader).toHaveBeenCalledWith(
      expect.objectContaining({ name: '합성 학생' }),
    );
  });

  it('팀 이름 입력 시 그 이름을 쓴다', async () => {
    const { service, createTeamWithLeader } = buildService({});

    await service.create(
      GITHUB_ID,
      PROGRAM_ID,
      { ...DEFAULT_INPUT, teamName: '  오픈소스팀  ' },
      NOW,
    );

    expect(createTeamWithLeader).toHaveBeenCalledWith(
      expect.objectContaining({ name: '오픈소스팀' }),
    );
  });

  it('name 이 없으면 nickname 을 applicantName·기본 팀 이름으로 쓴다', async () => {
    const { service, createApplication, createTeamWithLeader } = buildService({
      student: { ...STUDENT, name: null },
    });

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(createTeamWithLeader).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'synthetic-login' }),
    );
    const calls = createApplication.mock.calls as unknown as ReadonlyArray<
      readonly [{ readonly answers: { readonly applicantName: string } }]
    >;
    expect(calls[0]?.[0].answers.applicantName).toBe('synthetic-login');
  });

  it('이전 INDIVIDUAL 템플릿 프로그램에도 동일하게 1인 팀을 만든다', async () => {
    const { service, createTeamWithLeader, createApplication } = buildService({
      program: { ...OPEN_PROGRAM, category: ProgramCategory.BASIC },
    });

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(createTeamWithLeader).toHaveBeenCalledTimes(1);
    expect(createApplication).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 'synthetic-team' }),
    );
  });

  it('초대를 전혀 하지 않은 1인 팀으로도 신청이 정상 완성된다', async () => {
    const { service, createTeamWithLeader, createApplication } = buildService({
      store: {
        findTeamMinSize: jest.fn().mockResolvedValue(null),
      },
    });

    const result = await service.create(
      GITHUB_ID,
      PROGRAM_ID,
      DEFAULT_INPUT,
      NOW,
    );

    expect(result.teamId).toBe('synthetic-team');
    expect(createTeamWithLeader).toHaveBeenCalledWith(
      expect.objectContaining({ leaderId: STUDENT.id }),
    );
    expect(createApplication).toHaveBeenCalledTimes(1);
  });

  it('ACTIVE STUDENT 가 아니면 APP_008', async () => {
    const { service } = buildService({ student: null });

    await expect(
      service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.STUDENT_ONLY },
    });
  });

  it('프로그램이 없으면 APP_009', async () => {
    const { service } = buildService({ program: null });

    await expect(
      service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.PROGRAM_NOT_FOUND },
    });
  });

  it('신청 기간 밖이면 APP_010', async () => {
    const { service } = buildService({});

    await expect(
      service.create(
        GITHUB_ID,
        PROGRAM_ID,
        DEFAULT_INPUT,
        new Date('2026-08-01T00:00:00.000Z'),
      ),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED },
    });
  });

  it('템플릿 버전 불일치면 APP_016', async () => {
    const { service } = buildService({});

    await expect(
      service.create(
        GITHUB_ID,
        PROGRAM_ID,
        { ...DEFAULT_INPUT, applicationTemplateVersion: 2 },
        NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.TEMPLATE_VERSION_MISMATCH },
    });
  });

  it('answers 누락·알 수 없는 키면 APP_015', async () => {
    const { service } = buildService({});

    await expect(
      service.create(
        GITHUB_ID,
        PROGRAM_ID,
        {
          ...DEFAULT_INPUT,
          answers: { title: '제목' },
        },
        NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.INVALID_ANSWERS },
    });

    await expect(
      service.create(
        GITHUB_ID,
        PROGRAM_ID,
        {
          ...DEFAULT_INPUT,
          answers: { title: '제목', summary: '요약', extra: 'no' },
        },
        NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.INVALID_ANSWERS },
    });
  });

  it('팀 최소 인원이 1보다 크면 1인 팀 신청을 막고 APP_019를 반환한다', async () => {
    const { service, createApplication, createTeamWithLeader } = buildService({
      store: {
        findTeamMinSize: jest.fn().mockResolvedValue(2),
      },
    });

    await expect(
      service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: 'APP_019', status: 422 },
      extensions: { memberCount: 1, teamMinSize: 2 },
    });
    expect(createTeamWithLeader).not.toHaveBeenCalled();
    expect(createApplication).not.toHaveBeenCalled();
  });

  it('팀 멤버십 충돌(이미 프로그램 팀 소속)은 APP_011 로 매핑한다', async () => {
    const { service } = buildService({
      createTeamThrows: new ApplicationTeamMembershipConflictError(),
    });

    await expect(
      service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.DUPLICATE_APPLICATION },
    });
  });

  it('joinCodeDigest 충돌 시 재시도 후 성공한다', async () => {
    const { service, createTeamWithLeader } = buildService({
      createTeamThrows: [
        new ApplicationJoinCodeDigestConflictError(),
        undefined as unknown as Error,
      ],
      joinCodes: ['CODEAAAAAA', 'CODEBBBBBB'],
    });

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(createTeamWithLeader).toHaveBeenCalledTimes(2);
    expect(createTeamWithLeader).toHaveBeenLastCalledWith(
      expect.objectContaining({ joinCodeDigest: 'digest:CODEBBBBBB' }),
    );
  });

  it('P2002 레이스는 APP_011 로 매핑한다', async () => {
    const { service } = buildService({
      createThrows: new ApplicationDuplicateError(),
    });

    await expect(
      service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW),
    ).rejects.toBeInstanceOf(DomainException);

    await expect(
      service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.DUPLICATE_APPLICATION },
    });
  });

  it('명시적 isRepositoryPublicationPlanned=false 를 store.createApplication 까지 그대로 전달한다', async () => {
    const { service, createApplication } = buildService({});

    await service.create(
      GITHUB_ID,
      PROGRAM_ID,
      { ...DEFAULT_INPUT, isRepositoryPublicationPlanned: false },
      NOW,
    );

    expect(createApplication).toHaveBeenCalledWith(
      expect.objectContaining({ isRepositoryPublicationPlanned: false }),
    );
  });

  it('최소 인원 설정이 없으면 1인 팀 신청을 허용한다', async () => {
    const { service, createApplication } = buildService({
      store: {
        findTeamMinSize: jest.fn().mockResolvedValue(null),
      },
    });

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(createApplication).toHaveBeenCalled();
  });

  it('최소 인원이 1이면 1인 팀 신청을 허용한다', async () => {
    const { service, createApplication } = buildService({
      store: {
        findTeamMinSize: jest.fn().mockResolvedValue(1),
      },
    });

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(createApplication).toHaveBeenCalled();
  });

  it('OWN + repositoryUrl 을 store.createApplication 까지 그대로 전달한다', async () => {
    const { service, createApplication } = buildService({});

    await service.create(
      GITHUB_ID,
      PROGRAM_ID,
      {
        ...DEFAULT_INPUT,
        repositoryConnectionMode: RepositoryConnectionMode.OWN,
        repositoryUrl: 'https://github.com/synthetic-org/synthetic-repo',
      },
      NOW,
    );

    expect(createApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryConnectionMode: RepositoryConnectionMode.OWN,
        repositoryUrl: 'https://github.com/synthetic-org/synthetic-repo',
      }),
    );
  });

  it('구 클라이언트 정규화값(NEW + null)을 store.createApplication 까지 전달한다', async () => {
    const { service, createApplication } = buildService({});

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(createApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryConnectionMode: RepositoryConnectionMode.NEW,
        repositoryUrl: null,
      }),
    );
  });
});
