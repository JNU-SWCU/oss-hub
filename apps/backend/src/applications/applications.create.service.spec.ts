import { ApplicationStatus, ProgramCategory } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  ApplicationDuplicateError,
  type ApplicationCreateStore,
  type ApplicationsRepository,
  type ApplyProgramRecord,
  type ApplicationStudentActor,
  type CreatedApplication,
} from './applications.repository';
import { ApplicationsErrorCode } from './applications-error-code.enum';
import { ApplicationsService } from './applications.service';

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
  applicationTemplateVersion: 1,
  applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
  applicationEndAt: new Date('2026-07-31T23:59:59.000Z'),
};

const CREATED: CreatedApplication = {
  id: 'synthetic-application',
  programId: PROGRAM_ID,
  status: ApplicationStatus.SUBMITTED,
  teamId: null,
  submittedAt: NOW,
  isRepositoryPublicationPlanned: true,
};

function buildService(overrides: {
  readonly student?: ApplicationStudentActor | null;
  readonly program?: ApplyProgramRecord | null;
  readonly store?: Partial<ApplicationCreateStore>;
  readonly createThrows?: Error;
}) {
  const createApplication = jest.fn().mockImplementation((input: unknown) => {
    if (overrides.createThrows) {
      return Promise.reject(overrides.createThrows);
    }
    const rawTeamId =
      typeof input === 'object' && input !== null && 'teamId' in input
        ? Reflect.get(input, 'teamId')
        : null;
    const teamId = typeof rawTeamId === 'string' ? rawTeamId : null;
    const created: CreatedApplication = {
      ...CREATED,
      teamId,
    };
    return Promise.resolve(created);
  });

  const store: ApplicationCreateStore = {
    findTeamForApply: jest.fn().mockResolvedValue(null),
    findPersonalDuplicate: jest.fn().mockResolvedValue(false),
    findTeamDuplicate: jest.fn().mockResolvedValue(false),
    createApplication,
    ...overrides.store,
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
        overrides.program === undefined ? OPEN_PROGRAM : overrides.program,
      ),
    withCreateTransaction: jest.fn(
      async (operation: (s: ApplicationCreateStore) => Promise<unknown>) =>
        operation(store),
    ),
    withTransaction: jest.fn(),
    findRepositoryProvisionEvent: jest.fn(),
  } as unknown as ApplicationsRepository;

  return {
    service: new ApplicationsService(repository),
    repository,
    store,
    createApplication,
  };
}

describe('ApplicationsService.create', () => {
  it('개인 신청을 SUBMITTED 로 생성하고 서버 applicantName 을 주입한다', async () => {
    const { service, createApplication } = buildService({});

    const result = await service.create(
      GITHUB_ID,
      PROGRAM_ID,
      {
        answers: { title: '제목', summary: '요약' },
        teamId: null,
        applicationTemplateVersion: 1,
        isRepositoryPublicationPlanned: true,
      },
      NOW,
    );

    expect(result).toMatchObject({
      id: 'synthetic-application',
      status: ApplicationStatus.SUBMITTED,
      teamId: null,
    });
    expect(createApplication).toHaveBeenCalledWith({
      programId: PROGRAM_ID,
      applicantId: STUDENT.id,
      teamId: null,
      answers: {
        applicantName: '합성 학생',
        title: '제목',
        summary: '요약',
      },
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: true,
    });
  });

  it('name 이 없으면 nickname 을 applicantName 으로 쓴다', async () => {
    const { service, createApplication } = buildService({
      student: { ...STUDENT, name: null },
    });

    await service.create(
      GITHUB_ID,
      PROGRAM_ID,
      {
        answers: { title: '제목', summary: '요약' },
        teamId: null,
        applicationTemplateVersion: 1,
        isRepositoryPublicationPlanned: true,
      },
      NOW,
    );

    expect(createApplication).toHaveBeenCalled();
    const calls = createApplication.mock.calls as unknown as ReadonlyArray<
      readonly [{ readonly answers: { readonly applicantName: string } }]
    >;
    expect(calls[0]?.[0].answers.applicantName).toBe('synthetic-login');
  });

  it('ACTIVE STUDENT 가 아니면 APP_008', async () => {
    const { service } = buildService({ student: null });

    await expect(
      service.create(
        GITHUB_ID,
        PROGRAM_ID,
        {
          answers: { title: '제목', summary: '요약' },
          teamId: null,
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
        },
        NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.STUDENT_ONLY },
    });
  });

  it('프로그램이 없으면 APP_009', async () => {
    const { service } = buildService({ program: null });

    await expect(
      service.create(
        GITHUB_ID,
        PROGRAM_ID,
        {
          answers: { title: '제목', summary: '요약' },
          teamId: null,
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
        },
        NOW,
      ),
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
        {
          answers: { title: '제목', summary: '요약' },
          teamId: null,
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
        },
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
        {
          answers: { title: '제목', summary: '요약' },
          teamId: null,
          applicationTemplateVersion: 2,
          isRepositoryPublicationPlanned: true,
        },
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
          answers: { title: '제목' },
          teamId: null,
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
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
          answers: { title: '제목', summary: '요약', extra: 'no' },
          teamId: null,
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
        },
        NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.INVALID_ANSWERS },
    });
  });

  it('개인형에 teamId 가 있으면 APP_013', async () => {
    const { service } = buildService({});

    await expect(
      service.create(
        GITHUB_ID,
        PROGRAM_ID,
        {
          answers: { title: '제목', summary: '요약' },
          teamId: 'team-1',
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
        },
        NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.TEAM_NOT_ALLOWED },
    });
  });

  it('팀형에 teamId 없으면 APP_012', async () => {
    const { service } = buildService({
      program: { ...OPEN_PROGRAM, category: ProgramCategory.OSS_CONTEST },
    });

    await expect(
      service.create(
        GITHUB_ID,
        PROGRAM_ID,
        {
          answers: { title: '제목', summary: '요약' },
          teamId: null,
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
        },
        NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.TEAM_REQUIRED },
    });
  });

  it('팀 구성원이 아니면 APP_014', async () => {
    const { service } = buildService({
      program: { ...OPEN_PROGRAM, category: ProgramCategory.OSS_CONTEST },
      store: {
        findTeamForApply: jest.fn().mockResolvedValue({
          id: 'team-1',
          programId: PROGRAM_ID,
          leaderId: 'other',
          isMember: false,
          memberCount: 1,
          teamMinSize: 2,
        }),
      },
    });

    await expect(
      service.create(
        GITHUB_ID,
        PROGRAM_ID,
        {
          answers: { title: '제목', summary: '요약' },
          teamId: 'team-1',
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
        },
        NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.TEAM_MEMBERSHIP_REQUIRED },
    });
  });

  it('팀원이 최소 인원보다 적으면 신청을 생성하지 않고 APP_019를 반환한다', async () => {
    // Given
    const { service, createApplication } = buildService({
      program: { ...OPEN_PROGRAM, category: ProgramCategory.OSS_CONTEST },
      store: {
        findTeamForApply: jest.fn().mockResolvedValue({
          id: 'team-1',
          programId: PROGRAM_ID,
          leaderId: STUDENT.id,
          isMember: true,
          memberCount: 1,
          teamMinSize: 2,
        }),
      },
    });

    // When
    const submission = service.create(
      GITHUB_ID,
      PROGRAM_ID,
      {
        answers: { title: '팀 제목', summary: '팀 요약' },
        teamId: 'team-1',
        applicationTemplateVersion: 1,
        isRepositoryPublicationPlanned: true,
      },
      NOW,
    );

    // Then
    await expect(submission).rejects.toMatchObject({
      errorCode: { code: 'APP_019', status: 422 },
      extensions: { memberCount: 1, teamMinSize: 2 },
    });
    expect(createApplication).not.toHaveBeenCalled();
  });

  it('중복 개인 신청 precheck 는 APP_011', async () => {
    const { service } = buildService({
      store: {
        findPersonalDuplicate: jest.fn().mockResolvedValue(true),
      },
    });

    await expect(
      service.create(
        GITHUB_ID,
        PROGRAM_ID,
        {
          answers: { title: '제목', summary: '요약' },
          teamId: null,
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
        },
        NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.DUPLICATE_APPLICATION },
    });
  });

  it('P2002 레이스는 APP_011 로 매핑한다', async () => {
    const { service } = buildService({
      createThrows: new ApplicationDuplicateError(),
    });

    await expect(
      service.create(
        GITHUB_ID,
        PROGRAM_ID,
        {
          answers: { title: '제목', summary: '요약' },
          teamId: null,
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(DomainException);

    await expect(
      service.create(
        GITHUB_ID,
        PROGRAM_ID,
        {
          answers: { title: '제목', summary: '요약' },
          teamId: null,
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
        },
        NOW,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.DUPLICATE_APPLICATION },
    });
  });

  it('팀 신청 성공 경로를 생성한다', async () => {
    const { service, createApplication } = buildService({
      program: { ...OPEN_PROGRAM, category: ProgramCategory.CAPSTONE },
      store: {
        findTeamForApply: jest.fn().mockResolvedValue({
          id: 'team-1',
          programId: PROGRAM_ID,
          leaderId: STUDENT.id,
          isMember: true,
          memberCount: 2,
          teamMinSize: 2,
        }),
        findTeamDuplicate: jest.fn().mockResolvedValue(false),
      },
    });

    await service.create(
      GITHUB_ID,
      PROGRAM_ID,
      {
        answers: { title: '팀 제목', summary: '팀 요약' },
        teamId: 'team-1',
        applicationTemplateVersion: 1,
        isRepositoryPublicationPlanned: true,
      },
      NOW,
    );

    expect(createApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-1',
        applicantId: STUDENT.id,
      }),
    );
  });

  it('명시적 isRepositoryPublicationPlanned=false 를 store.createApplication 까지 그대로 전달한다', async () => {
    const { service, createApplication } = buildService({});

    await service.create(
      GITHUB_ID,
      PROGRAM_ID,
      {
        answers: { title: '제목', summary: '요약' },
        teamId: null,
        applicationTemplateVersion: 1,
        isRepositoryPublicationPlanned: false,
      },
      NOW,
    );

    expect(createApplication).toHaveBeenCalledWith(
      expect.objectContaining({ isRepositoryPublicationPlanned: false }),
    );
  });
});
