import { RepositoryProvisionEventService } from '../github/repository-provision-event.service';
import {
  ApplicationStatus,
  ProgramCategory,
  ProgramLifecycle,
  RepositoryConnectionMode,
} from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import type {
  ApplicationCreateStore,
  ApplicationsRepository,
  ApplyProgramRecord,
  ApplicationStudentActor,
  CreatedApplication,
} from './team.repository';
import { ApplicationsErrorCode } from './applications-error-code.error';
import { TeamApplicationService } from './team-application.service';
import type { AuditLogService } from '../platform/audit-log.service';
import {
  ApplicationDuplicateError,
  ApplicationTeamMembershipConflictError,
} from './applications.error';
import {
  APPLICATION_SUBMITTED_AUDIT_ACTIONS,
  TEAM_CREATED_AUDIT_ACTIONS,
} from '../platform/audit-log-metadata.config';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { ApplicationAnswersService } from './team-application.service';

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
  id: 'synthetic-team',
  programId: PROGRAM_ID,
  status: ApplicationStatus.SUBMITTED,
  teamId: 'synthetic-team',
  submittedAt: NOW,
  isRepositoryPublicationPlanned: true,
  repositoryConnectionMode: RepositoryConnectionMode.NEW,
  repositoryUrl: null,
};

const DEFAULT_INPUT = {
  answers: { title: '제목' },
  teamName: null as string | null,
  applicationTemplateVersion: 1,
  isRepositoryPublicationPlanned: true,
};

function buildService(overrides: {
  readonly student?: ApplicationStudentActor | null;
  readonly program?: ApplyProgramRecord | null;
  readonly store?: Partial<ApplicationCreateStore>;
  readonly createThrows?: Error;
  readonly createTeamThrows?: Error | readonly Error[];
}) {
  let createTeamCall = 0;
  const createTeamWithLeader = jest
    .fn()
    .mockImplementation((input: { readonly name: string }) => {
      if (overrides.createThrows) return Promise.reject(overrides.createThrows);
      const throws = overrides.createTeamThrows;
      if (throws instanceof Error) {
        return Promise.reject(throws);
      }
      if (throws) {
        const error: Error | undefined = throws[createTeamCall];
        createTeamCall += 1;
        if (error) return Promise.reject(error);
      }
      return Promise.resolve(CREATED);
    });

  const auditLogWriter = {} as ApplicationCreateStore['auditLogWriter'];
  const appendReviewHistory = jest.fn().mockResolvedValue({ revision: 1 });
  const store: ApplicationCreateStore = {
    validateApplicationParticipants: jest.fn().mockResolvedValue('ok'),
    createApplicationInvitations: jest.fn().mockResolvedValue(undefined),
    auditLogWriter,
    appendReviewHistory,
    lockProgramForApply: jest.fn().mockResolvedValue(overrides.program === null
        ? null
        : {
            ...OPEN_PROGRAM,
            ...overrides.program,
            teamMinSize: 1,
            teamMaxSize: 4,
        }),
    findExistingTeamMembership: jest.fn().mockResolvedValue(null),
    lockTeamForApply: jest.fn().mockResolvedValue(true),
    countTeamMembers: jest.fn().mockResolvedValue(1),
    createTeamWithLeader,
    ...overrides.store
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
    service: new TeamApplicationService(repository, new RepositoryUrlService(), new ApplicationAnswersService(), new RepositoryProvisionEventService()),
    repository,
    store,
    createTeamWithLeader,
    appendReviewHistory,
    auditLogWriter
};
}

describe('TeamApplicationService.create', () => {
  it('내린 프로그램 신청을 전용 오류로 차단한다', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({
      program: { ...OPEN_PROGRAM, lifecycle: ProgramLifecycle.ARCHIVED },
    });

    await expect(
      service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.PROGRAM_ARCHIVED, status: 422 },
    });
    expect(createTeamWithLeader).not.toHaveBeenCalled();
  });

  it('잠금 전 정책이 닫혀 있어도 잠금 후 유효한 양식 버전으로 저장한다', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({
      program: {
        ...OPEN_PROGRAM,
        lifecycle: ProgramLifecycle.ARCHIVED,
        applicationEndAt: new Date('2026-07-01T00:00:00.000Z'),
      },
      store: {
        lockProgramForApply: jest.fn().mockResolvedValue({
          ...OPEN_PROGRAM,
          applicationTemplateVersion: 2,
        }),
      },
    });

    await service.create(
      GITHUB_ID,
      PROGRAM_ID,
      { ...DEFAULT_INPUT, applicationTemplateVersion: 2 },
      NOW,
    );

    expect(createTeamWithLeader).toHaveBeenCalledWith(
      expect.objectContaining({ applicationTemplateVersion: 2 }),
    );
  });

  it.each([
    [
      {
        ...OPEN_PROGRAM,
        applicationStartAt: new Date('2026-07-16T00:00:00.000Z'),
      },
      ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED,
    ],
    [
      {
        ...OPEN_PROGRAM,
        applicationEndAt: new Date('2026-07-14T00:00:00.000Z'),
      },
      ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED,
    ],
    [
      { ...OPEN_PROGRAM, applicationTemplateVersion: 2 },
      ApplicationsErrorCode.TEMPLATE_VERSION_MISMATCH,
    ],
    [
      { ...OPEN_PROGRAM, lifecycle: ProgramLifecycle.ARCHIVED },
      ApplicationsErrorCode.PROGRAM_ARCHIVED,
    ],
    [null, ApplicationsErrorCode.PROGRAM_NOT_FOUND],
  ])(
    '잠금 후 정책 %j는 %s로 거절하며 부수효과가 없다',
    async (policy, code) => {
      const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({
        store: { lockProgramForApply: jest.fn().mockResolvedValue(policy) },
      });

      await expect(
        service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW),
      ).rejects.toMatchObject({ errorCode: { code } });
      expect(createTeamWithLeader).not.toHaveBeenCalled();
      expect(createTeamWithLeader).not.toHaveBeenCalled();
      expect(appendReviewHistory).not.toHaveBeenCalled();
      expect(appendReviewHistory).not.toHaveBeenCalled();
    },
  );

  it.each([OPEN_PROGRAM.applicationStartAt, OPEN_PROGRAM.applicationEndAt])(
    '요청 시각 %s가 잠금 후 기간 경계와 같으면 신청한다',
    async (now) => {
      const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({});
      await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, now);
      expect(createTeamWithLeader).toHaveBeenCalledTimes(1);
    },
  );

  it('신청 시 1인 팀을 만들고 leader 가 신청자이며 SUBMITTED 로 생성한다', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService(
      {},
    );

    const result = await service.create(
      GITHUB_ID,
      PROGRAM_ID,
      DEFAULT_INPUT,
      NOW,
    );

    expect(result).toMatchObject({
      id: 'synthetic-team',
      status: ApplicationStatus.SUBMITTED,
      teamId: 'synthetic-team',
    });
    expect(createTeamWithLeader).toHaveBeenCalledWith({
      programId: PROGRAM_ID,
      name: 'synthetic-login의 팀',
      leaderId: STUDENT.id,
      answers: {
        applicantName: '합성 학생',
        title: '제목',
      },
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: true,
    });
  });

  it('팀 이름 미입력 시 실명이 아닌 GitHub 닉네임 기반 기본값을 쓴다', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({});

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(createTeamWithLeader).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'synthetic-login의 팀' }),
    );
  });

  it('팀 이름 입력 시 그 이름을 쓴다', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({});

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

  it('실명이 있어도 팀 이름에는 쓰지 않는다 — 공개 프로젝트 표시명으로 흘러간다', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({
      student: { ...STUDENT, name: null },
    });

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(createTeamWithLeader).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'synthetic-login의 팀' }),
    );
    const calls = createTeamWithLeader.mock.calls as unknown as ReadonlyArray<
      readonly [{ readonly answers: { readonly applicantName: string } }]
    >;
    expect(calls[0]?.[0].answers.applicantName).toBe('synthetic-login');
  });

  it('이전 INDIVIDUAL 템플릿 프로그램에도 동일하게 1인 팀을 만든다', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({
      program: { ...OPEN_PROGRAM, category: ProgramCategory.BASIC },
    });

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(createTeamWithLeader).toHaveBeenCalledTimes(1);
    expect(createTeamWithLeader).toHaveBeenCalledWith(
      expect.objectContaining({ leaderId: STUDENT.id }),
    );
  });

  it('초대를 전혀 하지 않은 1인 팀으로도 신청이 정상 완성된다', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({
      store: {
        lockProgramForApply: jest.fn().mockResolvedValue({
          ...OPEN_PROGRAM,
          teamMinSize: 1,
          teamMaxSize: 4,
        }),
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
    expect(createTeamWithLeader).toHaveBeenCalledTimes(1);
  });

  it('ACTIVE STUDENT 가 아니면 APP_008', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({ student: null });

    await expect(
      service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.STUDENT_ONLY },
    });
  });

  it('프로그램이 없으면 APP_009', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({ program: null });

    await expect(
      service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.PROGRAM_NOT_FOUND },
    });
  });

  it('신청 기간 밖이면 APP_010', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({});

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
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({});

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

  it('answers 의 제거된 summary·알 수 없는 키면 APP_015', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({});

    await expect(
      service.create(
        GITHUB_ID,
        PROGRAM_ID,
        {
          ...DEFAULT_INPUT,
          answers: { summary: '요약' },
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

  it('지명 없이 혼자 지원하면 프로그램 최소 인원을 검사한다', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({
      store: {
        lockProgramForApply: jest.fn().mockResolvedValue({
          ...OPEN_PROGRAM,
          teamMinSize: 2,
          teamMaxSize: 4,
        }),
      },
    });

    await expect(
      service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW),
    ).rejects.toMatchObject({ errorCode: { code: 'APP_019' } });
    expect(createTeamWithLeader).not.toHaveBeenCalled();
    expect(createTeamWithLeader).not.toHaveBeenCalled();
  });

  it('팀 멤버십 충돌(이미 프로그램 팀 소속)은 APP_011 로 매핑한다', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({
      createTeamThrows: new ApplicationTeamMembershipConflictError(),
    });

    await expect(
      service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.DUPLICATE_APPLICATION },
    });
  });

  it('P2002 레이스는 APP_011 로 매핑한다', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({
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

  it('명시적 isRepositoryPublicationPlanned=false 를 store.createTeamWithLeader 까지 그대로 전달한다', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({});

    await service.create(
      GITHUB_ID,
      PROGRAM_ID,
      { ...DEFAULT_INPUT, isRepositoryPublicationPlanned: false },
      NOW,
    );

    expect(createTeamWithLeader).toHaveBeenCalledWith(
      expect.objectContaining({ isRepositoryPublicationPlanned: false }),
    );
  });

  it('최소 인원 설정이 없으면 1인 팀 신청을 허용한다', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({
      store: {
        lockProgramForApply: jest.fn().mockResolvedValue({
          ...OPEN_PROGRAM,
          teamMinSize: 1,
          teamMaxSize: 4,
        }),
      },
    });

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(createTeamWithLeader).toHaveBeenCalled();
  });

  it('최소 인원이 1이면 1인 팀 신청을 허용한다', async () => {
    const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({
      store: {
        lockProgramForApply: jest.fn().mockResolvedValue({
          ...OPEN_PROGRAM,
          teamMinSize: 1,
          teamMaxSize: 4,
        }),
      },
    });

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(createTeamWithLeader).toHaveBeenCalled();
  });

  it.each([true, false])(
    'creates a team from the same safe fields when provisioning is %s',
    async (repositoryProvisioningEnabled) => {
      const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({
        program: { ...OPEN_PROGRAM, repositoryProvisioningEnabled },
      });

      await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

      expect(createTeamWithLeader).toHaveBeenCalledWith(
        { programId: PROGRAM_ID, name: 'synthetic-login의 팀', leaderId: STUDENT.id,
          answers: { applicantName: STUDENT.name, title: '제목' }, applicationTemplateVersion: 1, isRepositoryPublicationPlanned: true },
      );
    },
  );
  it("기존 소속이 있으면 새 Team을 만들지 않는다", async () => { const lockTeamForApply = jest.fn().mockResolvedValue(true);
const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({
      store: {
        findExistingTeamMembership: jest
          .fn()
          .mockResolvedValue({ id: 'existing-team', name: '먼저 만든 팀' }),
        lockTeamForApply,
        countTeamMembers: jest.fn().mockResolvedValue(1),
      },
    });
await expect(service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW)).rejects.toMatchObject({ errorCode: { code: ApplicationsErrorCode.DUPLICATE_APPLICATION } });
expect(createTeamWithLeader).not.toHaveBeenCalled();
expect(appendReviewHistory).not.toHaveBeenCalled();
expect(store.createApplicationInvitations).not.toHaveBeenCalled(); });

  it("기존 소속은 최소 인원과 관계없이 중복 지원이다", async () => { 
const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({
      store: {
        lockProgramForApply: jest.fn().mockResolvedValue({
          ...OPEN_PROGRAM,
          teamMinSize: 2,
          teamMaxSize: 4,
        }),
        findExistingTeamMembership: jest
          .fn()
          .mockResolvedValue({ id: 'existing-team', name: '먼저 만든 팀' }),
        countTeamMembers: jest.fn().mockResolvedValue(1),
      },
    });
await expect(service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW)).rejects.toMatchObject({ errorCode: { code: ApplicationsErrorCode.DUPLICATE_APPLICATION } });
expect(createTeamWithLeader).not.toHaveBeenCalled();
expect(appendReviewHistory).not.toHaveBeenCalled();
expect(store.createApplicationInvitations).not.toHaveBeenCalled(); });

  it("인원을 채운 기존 팀도 새 지원을 만들지 않는다", async () => { 
const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({
      store: {
        lockProgramForApply: jest.fn().mockResolvedValue({
          ...OPEN_PROGRAM,
          teamMinSize: 2,
          teamMaxSize: 4,
        }),
        findExistingTeamMembership: jest
          .fn()
          .mockResolvedValue({ id: 'existing-team', name: '2인 팀' }),
        countTeamMembers: jest.fn().mockResolvedValue(2),
      },
    });
await expect(service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW)).rejects.toMatchObject({ errorCode: { code: ApplicationsErrorCode.DUPLICATE_APPLICATION } });
expect(createTeamWithLeader).not.toHaveBeenCalled();
expect(appendReviewHistory).not.toHaveBeenCalled();
expect(store.createApplicationInvitations).not.toHaveBeenCalled(); });

  it('새 Team 생성에는 SUBMITTED 이력 한 건을 남긴다', async () => { const { service, appendReviewHistory, createTeamWithLeader, store } = buildService({}); await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW); expect(appendReviewHistory).toHaveBeenCalledTimes(1); expect(appendReviewHistory).toHaveBeenCalledWith({ teamId: CREATED.id, eventKind: 'SUBMITTED', actorId: STUDENT.id, occurredAt: NOW, rejectionReason: null }); });

  it("기존 팀에는 제출 이력을 중복으로 쓰지 않는다", async () => { 
const { service, appendReviewHistory, createTeamWithLeader, store } = buildService({
      store: {
        findExistingTeamMembership: jest
          .fn()
          .mockResolvedValue({ id: 'existing-team', name: '먼저 만든 팀' }),
      },
    });
await expect(service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW)).rejects.toMatchObject({ errorCode: { code: ApplicationsErrorCode.DUPLICATE_APPLICATION } });
expect(createTeamWithLeader).not.toHaveBeenCalled();
expect(appendReviewHistory).not.toHaveBeenCalled();
expect(store.createApplicationInvitations).not.toHaveBeenCalled(); });
});

describe('TeamApplicationService.create — 프로그램당 한 사람 한 팀', () => {
  const EXISTING_TEAM = { id: 'existing-team', name: '함께 만든 팀' };

  function buildTeamService(overrides: {
    readonly leaderAfterLock: boolean;
    readonly teamMinSize?: number | null;
    readonly memberCount?: number;
  }) {
    const lockTeamForApply = jest
      .fn()
      .mockResolvedValue(overrides.leaderAfterLock);
    const countTeamMembers = jest
      .fn()
      .mockResolvedValue(overrides.memberCount ?? 2);
    const built = buildService({
      store: {
        findExistingTeamMembership: jest.fn().mockResolvedValue(EXISTING_TEAM),
        lockProgramForApply: jest.fn().mockResolvedValue({
          ...OPEN_PROGRAM,
          teamMinSize: overrides.teamMinSize ?? 1,
          teamMaxSize: 4,
        }),
        lockTeamForApply,
        countTeamMembers,
      },
    });
    return { ...built, lockTeamForApply, countTeamMembers };
  }

  it("기존 팀원은 중복 지원으로 거절한다", async () => { 
const { service, createTeamWithLeader, lockTeamForApply, appendReviewHistory, store } = buildTeamService({ leaderAfterLock: false });
await expect(service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW)).rejects.toMatchObject({ errorCode: { code: ApplicationsErrorCode.DUPLICATE_APPLICATION } });
expect(createTeamWithLeader).not.toHaveBeenCalled();
expect(appendReviewHistory).not.toHaveBeenCalled();
expect(store.createApplicationInvitations).not.toHaveBeenCalled(); });

  it("기존 소속은 이전 팀장 권한과 관계없이 중복 지원이다", async () => { 
const { service, createTeamWithLeader, lockTeamForApply, countTeamMembers, appendReviewHistory, store } =
      buildTeamService({ leaderAfterLock: false });
await expect(service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW)).rejects.toMatchObject({ errorCode: { code: ApplicationsErrorCode.DUPLICATE_APPLICATION } });
expect(createTeamWithLeader).not.toHaveBeenCalled();
expect(appendReviewHistory).not.toHaveBeenCalled();
expect(store.createApplicationInvitations).not.toHaveBeenCalled(); });

  it("팀장을 위임받아도 새 지원은 중복으로 거절한다", async () => { 
const { service, createTeamWithLeader, lockTeamForApply, appendReviewHistory, store } = buildTeamService({
      leaderAfterLock: true,
      teamMinSize: 2,
      memberCount: 2,
    });
await expect(service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW)).rejects.toMatchObject({ errorCode: { code: ApplicationsErrorCode.DUPLICATE_APPLICATION } });
expect(createTeamWithLeader).not.toHaveBeenCalled();
expect(appendReviewHistory).not.toHaveBeenCalled();
expect(store.createApplicationInvitations).not.toHaveBeenCalled(); });

  it('현재 소속이 사라졌으면 이전 팀을 재사용하지 않고 새 팀을 만든다', async () => {
  const { service, store, createTeamWithLeader } = buildTeamService({ leaderAfterLock: false, teamMinSize: 1 });
  jest.spyOn(store, 'findExistingTeamMembership').mockResolvedValue(null);
  const result = await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);
  expect(result.id).not.toBe(EXISTING_TEAM.id);
  expect(createTeamWithLeader).toHaveBeenCalledTimes(1);
  expect(createTeamWithLeader).toHaveBeenCalledWith(expect.objectContaining({ name: 'synthetic-login의 팀', leaderId: STUDENT.id }));
});

  it('현재 팀이 없는 신청자는 새 팀의 팀장이 된다', async () => { const lockTeamForApply = jest.fn().mockResolvedValue(true); const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({
      store: {
        findExistingTeamMembership: jest.fn().mockResolvedValue(null),
        lockTeamForApply,
      },
    }); await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW); expect(lockTeamForApply).not.toHaveBeenCalled(); expect(createTeamWithLeader).toHaveBeenCalledWith(expect.objectContaining({ leaderId: STUDENT.id })); });

  it("기존 팀장도 인원 부족과 관계없이 중복 지원으로 거절한다", async () => { 
const { service, createTeamWithLeader, appendReviewHistory, store } = buildTeamService({
      leaderAfterLock: true,
      teamMinSize: 2,
      memberCount: 1,
    });
await expect(service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW)).rejects.toMatchObject({ errorCode: { code: ApplicationsErrorCode.DUPLICATE_APPLICATION } });
expect(createTeamWithLeader).not.toHaveBeenCalled();
expect(appendReviewHistory).not.toHaveBeenCalled();
expect(store.createApplicationInvitations).not.toHaveBeenCalled(); });

  it("팀장의 중복 신청은 계속 APP_011로 매핑한다 (기존 Team의 중복 지원 거절)", async () => { const lockTeamForApply = jest.fn().mockResolvedValue(true);
const { service, createTeamWithLeader, appendReviewHistory, store } = buildService({
      createThrows: new ApplicationDuplicateError(),
      store: {
        findExistingTeamMembership: jest.fn().mockResolvedValue(EXISTING_TEAM),
        lockTeamForApply,
        countTeamMembers: jest.fn().mockResolvedValue(2),
      },
    });
await expect(service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW)).rejects.toMatchObject({ errorCode: { code: ApplicationsErrorCode.DUPLICATE_APPLICATION } });
expect(createTeamWithLeader).not.toHaveBeenCalled();
expect(appendReviewHistory).not.toHaveBeenCalled();
expect(store.createApplicationInvitations).not.toHaveBeenCalled(); });
});

describe('TeamApplicationService.create — 최초 제출 이력', () => {
  it('신청 생성과 같은 트랜잭션 store로 SUBMITTED 이력을 남긴다', async () => {
    const { service, appendReviewHistory, createTeamWithLeader, store } = buildService({});

    await service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW);

    expect(appendReviewHistory).toHaveBeenCalledWith({
      teamId: CREATED.id,
      eventKind: 'SUBMITTED',
      actorId: STUDENT.id,
      occurredAt: CREATED.submittedAt,
      rejectionReason: null,
    });
  });

  it('신청이 만들어지지 않으면 이력도 남기지 않는다', async () => {
    const { service, appendReviewHistory, createTeamWithLeader, store } = buildService({
      program: { ...OPEN_PROGRAM, lifecycle: ProgramLifecycle.ARCHIVED },
    });

    await expect(
      service.create(GITHUB_ID, PROGRAM_ID, DEFAULT_INPUT, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.PROGRAM_ARCHIVED },
    });

    expect(appendReviewHistory).not.toHaveBeenCalled();
  });
});
