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
import {
  APPLICATION_SUBMITTED_AUDIT_ACTIONS,
  TEAM_CREATED_AUDIT_ACTIONS,
} from '../audit-log/audit-log-metadata';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { OwnRepositoryUrlValidationService } from '../github/service/own-repository-url-validation.service';
import type { OwnRepositoryUrlValidationResult } from '../github/service/own-repository-url-validation.service';

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
  name: '합성 프로그램',
  category: ProgramCategory.BASIC,
  lifecycle: ProgramLifecycle.PUBLISHED,
  applicationTemplateVersion: 1,
  applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
  applicationEndAt: new Date('2026-07-31T23:59:59.000Z'),
  repositoryProvisioningEnabled: true,
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
  readonly ownRepositoryUrlValidation?: OwnRepositoryUrlValidationResult;
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

  const record = jest
    .fn<Promise<unknown>, Parameters<AuditLogService['record']>>()
    .mockResolvedValue(undefined);
  const auditLogWriter = {} as ApplicationCreateStore['auditLogWriter'];
  const store: ApplicationCreateStore = {
    auditLogWriter,
    lockProgramForApply: jest
      .fn()
      .mockResolvedValue(ProgramLifecycle.PUBLISHED),
    findTeamMinSize: jest.fn().mockResolvedValue(null),
    findExistingTeamMembership: jest.fn().mockResolvedValue(null),
    lockTeamForApply: jest.fn().mockResolvedValue(undefined),
    countTeamMembers: jest.fn().mockResolvedValue(1),
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

  const ownRepositoryUrlValidator: Pick<
    OwnRepositoryUrlValidationService,
    'validate'
  > = {
    validate: jest
      .fn()
      .mockResolvedValue(
        overrides.ownRepositoryUrlValidation ?? { kind: 'VALID' },
      ),
  };

  return {
    service: new ApplicationsService(
      repository,
      { record } as unknown as AuditLogService,
      ownRepositoryUrlValidator,
    ),
    repository,
    store,
    createApplication,
    createTeamWithLeader,
    ownRepositoryUrlValidator,
    record,
    auditLogWriter,
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
      name: 'synthetic-login의 팀',
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

  it('팀 이름 미입력 시 실명이 아닌 GitHub 닉네임 기반 기본값을 쓴다', async () => {
    const { service, createTeamWithLeader } = buildService({});

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(createTeamWithLeader).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'synthetic-login의 팀' }),
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

  it('실명이 있어도 팀 이름에는 쓰지 않는다 — 공개 아카이브 표시명으로 흘러간다', async () => {
    const { service, createApplication, createTeamWithLeader } = buildService({
      student: { ...STUDENT, name: null },
    });

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(createTeamWithLeader).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'synthetic-login의 팀' }),
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

  it('OWN + 경계 밖 GitHub URL은 store에 기록하지 않는다', async () => {
    const { service, createApplication } = buildService({});

    await expect(
      service.create(
        GITHUB_ID,
        PROGRAM_ID,
        {
          ...DEFAULT_INPUT,
          repositoryConnectionMode: RepositoryConnectionMode.OWN,
          repositoryUrl:
            'https://github.com/synthetic-org/synthetic-repo?tab=readme',
        },
        NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.OWN_REPOSITORY_URL_REQUIRED,
      },
    });
    expect(createApplication).not.toHaveBeenCalled();
  });

  it('OWN + GitHub에서 확인된 URL은 사전 검증을 거쳐 신청을 만든다', async () => {
    const { service, createApplication, ownRepositoryUrlValidator } =
      buildService({ ownRepositoryUrlValidation: { kind: 'VALID' } });

    await service.create(
      GITHUB_ID,
      PROGRAM_ID,
      {
        ...DEFAULT_INPUT,
        repositoryConnectionMode: RepositoryConnectionMode.OWN,
        repositoryUrl: 'https://github.com/eco-external-org/econovation-repo',
      },
      NOW,
    );

    expect(ownRepositoryUrlValidator.validate).toHaveBeenCalledWith(
      'https://github.com/eco-external-org/econovation-repo',
    );
    expect(createApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryUrl: 'https://github.com/eco-external-org/econovation-repo',
      }),
    );
  });

  it('OWN + 존재하지 않거나 비공개인 URL은 repositoryUrl 필드 오류(APP_027)로 거부하고 신청을 만들지 않는다', async () => {
    const { service, createApplication } = buildService({
      ownRepositoryUrlValidation: { kind: 'NOT_FOUND_OR_PRIVATE' },
    });

    await expect(
      service.create(
        GITHUB_ID,
        PROGRAM_ID,
        {
          ...DEFAULT_INPUT,
          repositoryConnectionMode: RepositoryConnectionMode.OWN,
          repositoryUrl: 'https://github.com/synthetic-org/missing-or-private',
        },
        NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.OWN_REPOSITORY_URL_UNREACHABLE,
        status: 400,
      },
      extensions: {
        fieldErrors: [
          expect.objectContaining({
            field: 'repositoryUrl',
            code: ApplicationsErrorCode.OWN_REPOSITORY_URL_UNREACHABLE,
          }),
        ],
      },
    });
    expect(createApplication).not.toHaveBeenCalled();
  });

  it('NEW 모드는 URL 사전 검증을 호출하지 않는다', async () => {
    const { service, ownRepositoryUrlValidator } = buildService({});

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(ownRepositoryUrlValidator.validate).not.toHaveBeenCalled();
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

  it('저장소 발급이 켜졌는데 mode가 없으면 신청을 만들지 않는다', async () => {
    const { service, createApplication } = buildService({});

    await expect(
      service.create(
        GITHUB_ID,
        PROGRAM_ID,
        { ...DEFAULT_INPUT, repositoryConnectionMode: null },
        NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.REPOSITORY_CONNECTION_MODE_REQUIRED,
      },
    });
    expect(createApplication).not.toHaveBeenCalled();
  });

  it('저장소 발급이 꺼지면 mode 없는 신청만 받고 DB 기본 NEW로 정규화한다', async () => {
    const { service, createApplication } = buildService({
      program: { ...OPEN_PROGRAM, repositoryProvisioningEnabled: false },
    });

    await service.create(
      GITHUB_ID,
      PROGRAM_ID,
      { ...DEFAULT_INPUT, repositoryConnectionMode: null },
      NOW,
    );

    expect(createApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryConnectionMode: RepositoryConnectionMode.NEW,
        repositoryUrl: null,
      }),
    );
  });

  it('저장소 발급이 꺼졌는데 mode를 보내면 신청을 만들지 않는다', async () => {
    const { service, createApplication } = buildService({
      program: { ...OPEN_PROGRAM, repositoryProvisioningEnabled: false },
    });

    await expect(
      service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW),
    ).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.REPOSITORY_CONNECTION_MODE_FORBIDDEN,
      },
    });
    expect(createApplication).not.toHaveBeenCalled();
  });
  it('이미 팀에 속해 있으면 새 팀을 만들지 않고 그 팀으로 신청한다', async () => {
    // Given — /teams 에서 팀을 먼저 만든 학생.
    const lockTeamForApply = jest.fn().mockResolvedValue(undefined);
    const { service, createApplication, createTeamWithLeader } = buildService({
      store: {
        findExistingTeamMembership: jest
          .fn()
          .mockResolvedValue({ id: 'existing-team', name: '먼저 만든 팀' }),
        lockTeamForApply,
        countTeamMembers: jest.fn().mockResolvedValue(1),
      },
    });

    // When
    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    // Then — 새 팀을 만들지 않는다. 만들면 TeamMember unique 에 걸려
    // 학생이 영영 신청하지 못한다.
    expect(createTeamWithLeader).not.toHaveBeenCalled();
    expect(lockTeamForApply).toHaveBeenCalledWith('existing-team');
    expect(createApplication).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 'existing-team' }),
    );
  });

  it('재사용할 팀이 최소 인원에 못 미치면 실제 인원으로 거절한다', async () => {
    // Given — 최소 2인 프로그램에 1인 팀만 가진 학생.
    const { service } = buildService({
      store: {
        findTeamMinSize: jest.fn().mockResolvedValue(2),
        findExistingTeamMembership: jest
          .fn()
          .mockResolvedValue({ id: 'existing-team', name: '먼저 만든 팀' }),
        countTeamMembers: jest.fn().mockResolvedValue(1),
      },
    });

    // When / Then
    await expect(
      service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.TEAM_MIN_SIZE_NOT_MET },
      extensions: { memberCount: 1, teamMinSize: 2 },
    });
  });

  it('재사용할 팀이 최소 인원을 채웠으면 신청을 허용한다', async () => {
    // Given — 초대로 2인이 된 팀.
    const { service, createApplication } = buildService({
      store: {
        findTeamMinSize: jest.fn().mockResolvedValue(2),
        findExistingTeamMembership: jest
          .fn()
          .mockResolvedValue({ id: 'existing-team', name: '2인 팀' }),
        countTeamMembers: jest.fn().mockResolvedValue(2),
      },
    });

    // When
    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    // Then
    expect(createApplication).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 'existing-team' }),
    );
  });

  it('records TEAM_CREATED and APPLICATION_SUBMITTED when creating a new team', async () => {
    const { service, record, auditLogWriter } = buildService({});

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(record).toHaveBeenCalledTimes(2);
    const createdCall = record.mock.calls[0];
    const submittedCall = record.mock.calls[1];
    if (createdCall === undefined || submittedCall === undefined) {
      throw new Error(
        'expected TEAM_CREATED and APPLICATION_SUBMITTED records',
      );
    }
    expect(createdCall[0]).toMatchObject({
      actorGithubId: GITHUB_ID,
      action: TEAM_CREATED_AUDIT_ACTIONS.TEAM_CREATED,
      targetType: 'TEAM',
      targetId: 'synthetic-team',
      metadata: {
        schemaVersion: 1,
        programName: OPEN_PROGRAM.name,
        teamName: 'synthetic-login의 팀',
      },
    });
    expect(submittedCall[0]).toMatchObject({
      actorGithubId: GITHUB_ID,
      action: APPLICATION_SUBMITTED_AUDIT_ACTIONS.APPLICATION_SUBMITTED,
      targetType: 'APPLICATION',
      targetId: 'synthetic-application',
      metadata: {
        schemaVersion: 1,
        programName: OPEN_PROGRAM.name,
        teamName: 'synthetic-login의 팀',
      },
    });
    expect(createdCall[1]).toBe(auditLogWriter);
    expect(submittedCall[1]).toBe(auditLogWriter);
    expect(JSON.stringify(createdCall[0].metadata)).not.toContain(
      'applicantGithubLogin',
    );
    expect(JSON.stringify(submittedCall[0].metadata)).not.toContain(
      'applicantGithubLogin',
    );
  });

  it('records APPLICATION_SUBMITTED only with the existing team name', async () => {
    const { service, record, createTeamWithLeader } = buildService({
      store: {
        findExistingTeamMembership: jest
          .fn()
          .mockResolvedValue({ id: 'existing-team', name: '먼저 만든 팀' }),
      },
    });

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(createTeamWithLeader).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledTimes(1);
    const submittedCall = record.mock.calls[0];
    if (submittedCall === undefined) {
      throw new Error('expected APPLICATION_SUBMITTED record');
    }
    expect(submittedCall[0]).toMatchObject({
      action: APPLICATION_SUBMITTED_AUDIT_ACTIONS.APPLICATION_SUBMITTED,
      targetType: 'APPLICATION',
      metadata: {
        schemaVersion: 1,
        teamName: '먼저 만든 팀',
        programName: OPEN_PROGRAM.name,
      },
    });
    expect(JSON.stringify(submittedCall[0].metadata)).not.toContain(
      'synthetic-login의 팀',
    );
  });
});
