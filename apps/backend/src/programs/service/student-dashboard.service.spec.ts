import {
  ApplicationStatus,
  MilestoneDocumentKind,
  MilestoneSubmissionType,
  type Prisma,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  SubmissionStatus,
} from '@prisma/client';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import {
  REPOSITORIES_READ_PORT,
  type RepositoriesReadPort,
} from '../../github/repositories-read.port';
import { submissionCompletionTargetSelect } from '../../submissions/submission-completion-projection';
import {
  StudentDashboardReadRepository,
  type StudentDashboardApplicationRow,
} from '../repository/student-dashboard-read.repository';
import { StudentDashboardService } from './student-dashboard.service';

const DUE_AT = new Date('2026-08-01T00:00:00.000Z');
const SECOND_DUE_AT = new Date('2026-08-02T00:00:00.000Z');

/** 옛 방식 단일 제출을 보존하는 내부 슬롯 행 — 마일스톤당 하나뿐이다. */
function legacySubmission(milestoneId: string, status: SubmissionStatus) {
  return {
    status,
    milestoneDocument: {
      id: `${milestoneId}-legacy-slot`,
      milestoneId,
      kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
    },
  };
}

/** 서류 항목 하나의 제출 행. 항목마다 따로 쌓이므로 한 마일스톤에 여러 건이 온다. */
function documentSubmission(
  milestoneId: string,
  documentId: string,
  status: SubmissionStatus,
) {
  return {
    status,
    milestoneDocument: {
      id: documentId,
      milestoneId,
      kind: MilestoneDocumentKind.DOCUMENT,
    },
  };
}

/** 옛 방식 마일스톤 — 단일 제출 축만 쓰고 서류 항목이 없다. */
function legacyMilestone(id: string, name: string, dueAt: Date) {
  return {
    id,
    name,
    dueAt,
    submissionType: MilestoneSubmissionType.FILE,
    documents: [],
  };
}

/**
 * 새 방식 마일스톤 — 단일 제출 축이 없고 필수 서류 항목으로만 완료한다.
 *
 * `documents`에 **필수** 항목만 담는 것은 조회 조건(`required: true`)의 결과를 그대로
 * 흉내 낸 것이다. 선택 서류는 제출 행이 있어도 이 목록에 오지 않는다.
 */
function documentMilestone(
  id: string,
  name: string,
  dueAt: Date,
  requiredDocumentIds: readonly string[],
) {
  return {
    id,
    name,
    dueAt,
    submissionType: null,
    documents: requiredDocumentIds.map((documentId) => ({ id: documentId })),
  };
}

function program(
  milestones: readonly StudentDashboardApplicationRow['program']['milestones'][number][],
  id = 'program-1',
) {
  return { id, name: 'Synthetic Program', milestones };
}

/**
 * repository 가 주는 행 — 지금 그 팀에 속한 사람의 신청만 여기 온다.
 * `applicant` 스칼라는 아예 없다(대시보드가 사람 이름을 추론하지 않는다).
 */
function application(
  overrides: Partial<StudentDashboardApplicationRow> = {},
): StudentDashboardApplicationRow {
  return {
    id: 'application-1',
    status: ApplicationStatus.APPROVED,
    // D5: 개인 참여도 1인 팀이라 team 은 항상 있다.
    team: { name: 'Synthetic Solo Team' },
    program: program([
      legacyMilestone('milestone-1', 'First milestone', DUE_AT),
    ]),
    milestoneDocumentSubmissions: [],
    ...overrides,
  };
}

describe('StudentDashboardService', () => {
  const findParticipatingApplications = jest.fn();
  const repository = {
    findParticipatingApplications,
  } as unknown as StudentDashboardReadRepository;
  const getMyRepositories = jest.fn();
  const repositories = {
    getMyRepositories,
  } as RepositoriesReadPort;
  const service = new StudentDashboardService(repository, repositories);

  beforeEach(() => {
    jest.clearAllMocks();
    findParticipatingApplications.mockResolvedValue([]);
    getMyRepositories.mockResolvedValue([]);
  });

  it('returns no items when the student is in no team', async () => {
    await expect(service.getStudentDashboard(404n)).resolves.toEqual([]);
    expect(findParticipatingApplications).toHaveBeenCalledWith(404n);
    expect(getMyRepositories).toHaveBeenCalledWith(404n);
  });

  it('compiles with the read repository and the DTO-only repositories read-port token', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StudentDashboardService,
        StudentDashboardReadRepository,
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: jest.fn() },
            application: { findMany: jest.fn() },
          },
        },
        {
          provide: REPOSITORIES_READ_PORT,
          useValue: { getMyRepositories: jest.fn() },
        },
      ],
    }).compile();

    expect(moduleRef.get(StudentDashboardService)).toBeInstanceOf(
      StudentDashboardService,
    );
  });

  /**
   * 카드의 이름은 **지금 그 팀의 이름**이다. 팀장이든 아니든, 1인 팀이든 여러 명이든
   * 같은 이름과 같은 「우리 팀」 주소를 받는다 — 인원수로 개인/팀을 갈라 사람 이름을
   * 띄우던 규칙(applicationMode/displayName)은 사라졌다.
   */
  it('gives every current member the same team name and my-team link', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({ team: { name: 'Solo Team' } }),
      application({
        id: 'application-2',
        team: { name: 'Synthetic Team' },
      }),
    ]);

    const items = await service.getStudentDashboard(101n);

    expect(items).toEqual([
      expect.objectContaining({
        applicationId: 'application-1',
        teamName: 'Solo Team',
        teamUrl: '/programs/program-1/my-team',
        detailUrl: '/programs/program-1',
        checklistUrl: '/programs/program-1/submissions',
      }),
      expect.objectContaining({
        applicationId: 'application-2',
        teamName: 'Synthetic Team',
        teamUrl: '/programs/program-1/my-team',
      }),
    ]);
    // 없어진 계약이 되살아나면 frontend 디코더가 다시 사람 이름을 그린다.
    expect(items[0]).not.toHaveProperty('applicationMode');
    expect(items[0]).not.toHaveProperty('displayName');
    expect(items[0]?.repository?.provisionStatus).toBe('NOT_STARTED');
  });

  it('percent-encodes the program id in every card link', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program(
          [legacyMilestone('milestone-1', 'First milestone', DUE_AT)],
          'program:1',
        ),
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.teamUrl).toBe('/programs/program%3A1/my-team');
    expect(item?.detailUrl).toBe('/programs/program%3A1');
    expect(item?.checklistUrl).toBe('/programs/program%3A1/submissions');
  });

  it('drops a card whose team name is blank instead of inventing one', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({ team: { name: '   ' } }),
    ]);

    await expect(service.getStudentDashboard(101n)).resolves.toEqual([]);
  });

  /**
   * 카드가 학생을 **어디로 보내는지**. 이 단언이 없는 동안 `detailUrl`은 아무 곳이나
   * 가리켜도 모든 테스트가 초록불이었고, 그래서 반려된 학생이 사유도 신청 상태도 없는
   * 프로그램 상세로 가는 것을 아무도 잡지 못했다(#733).
   */
  it.each([
    [ApplicationStatus.SUBMITTED, '/programs/program-1/apply'],
    [ApplicationStatus.REJECTED, '/programs/program-1/apply'],
    [ApplicationStatus.APPROVED, '/programs/program-1'],
  ])('points a %s application at %s', async (status, detailUrl) => {
    findParticipatingApplications.mockResolvedValue([application({ status })]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.detailUrl).toBe(detailUrl);
    // 「우리 팀」은 판정과 무관하다 — 신청 중에도 팀은 이미 존재한다.
    expect(item?.teamUrl).toBe('/programs/program-1/my-team');
  });

  it('keeps nextMilestone null for applications that are not approved', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({ status: ApplicationStatus.SUBMITTED }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toBeNull();
  });

  it('skips approved milestones and returns null when all milestones are approved', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program([
          legacyMilestone('milestone-1', 'First', DUE_AT),
          legacyMilestone('milestone-2', 'Second', SECOND_DUE_AT),
        ]),
        milestoneDocumentSubmissions: [
          legacySubmission('milestone-1', SubmissionStatus.APPROVED),
          legacySubmission('milestone-2', SubmissionStatus.CHANGES_REQUESTED),
        ],
      }),
      application({
        id: 'application-2',
        milestoneDocumentSubmissions: [
          legacySubmission('milestone-1', SubmissionStatus.APPROVED),
        ],
      }),
    ]);

    const items = await service.getStudentDashboard(101n);

    expect(items[0]?.nextMilestone).toMatchObject({
      id: 'milestone-2',
      submissionStatus: 'CHANGES_REQUESTED',
    });
    expect(items[1]?.nextMilestone).toBeNull();
  });

  it('holds the milestone while any required document is unapproved', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program([
          documentMilestone('milestone-1', 'First', DUE_AT, [
            'document-1',
            'document-2',
          ]),
          documentMilestone('milestone-2', 'Second', SECOND_DUE_AT, [
            'document-3',
          ]),
        ]),
        milestoneDocumentSubmissions: [
          documentSubmission(
            'milestone-1',
            'document-1',
            SubmissionStatus.SUBMITTED,
          ),
          documentSubmission(
            'milestone-1',
            'document-2',
            SubmissionStatus.APPROVED,
          ),
        ],
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    // 나쁜 쪽이 이긴다 — 승인 한 건이 미승인 한 건을 덮지 못한다.
    expect(item?.nextMilestone).toMatchObject({
      id: 'milestone-1',
      submissionStatus: 'SUBMITTED',
    });
  });

  it('advances past a milestone whose required documents are all approved', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program([
          documentMilestone('milestone-1', 'First', DUE_AT, [
            'document-1',
            'document-2',
          ]),
          documentMilestone('milestone-2', 'Second', SECOND_DUE_AT, [
            'document-3',
          ]),
        ]),
        milestoneDocumentSubmissions: [
          documentSubmission(
            'milestone-1',
            'document-1',
            SubmissionStatus.APPROVED,
          ),
          documentSubmission(
            'milestone-1',
            'document-2',
            SubmissionStatus.APPROVED,
          ),
          // 선택 서류의 승인은 두 번째 마일스톤을 끝낸 것으로 만들지 않는다.
          documentSubmission(
            'milestone-2',
            'optional-document',
            SubmissionStatus.APPROVED,
          ),
        ],
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toMatchObject({
      id: 'milestone-2',
      submissionStatus: 'NOT_SUBMITTED',
    });
  });

  it('empties nextMilestone once every milestone has its required documents approved', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program([
          documentMilestone('milestone-1', 'First', DUE_AT, ['document-1']),
          documentMilestone('milestone-2', 'Second', SECOND_DUE_AT, [
            'document-2',
          ]),
        ]),
        milestoneDocumentSubmissions: [
          documentSubmission(
            'milestone-1',
            'document-1',
            SubmissionStatus.APPROVED,
          ),
          documentSubmission(
            'milestone-2',
            'document-2',
            SubmissionStatus.APPROVED,
          ),
          // 선택 서류의 보완 요청은 마일스톤을 되돌리지 않는다.
          documentSubmission(
            'milestone-2',
            'optional-document',
            SubmissionStatus.CHANGES_REQUESTED,
          ),
        ],
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toBeNull();
  });

  /**
   * 축이 둘 다 살아 있는 #820 마일스톤. 프로그램 상세(`milestoneStatusFor`)는 이 칸을
   * 두 축의 나쁜 쪽으로 읽으므로, 대시보드도 같은 답을 내야 두 화면이 같은 말을 한다.
   */
  it('lets an unapproved required document outrank an approved legacy submission', async () => {
    findParticipatingApplications.mockResolvedValue([
      application({
        program: program([
          {
            ...legacyMilestone('milestone-1', 'First milestone', DUE_AT),
            documents: [{ id: 'document-1' }],
          },
        ]),
        milestoneDocumentSubmissions: [
          documentSubmission(
            'milestone-1',
            'document-1',
            SubmissionStatus.SUBMITTED,
          ),
          legacySubmission('milestone-1', SubmissionStatus.APPROVED),
        ],
      }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toMatchObject({
      id: 'milestone-1',
      submissionStatus: 'SUBMITTED',
    });
  });

  it('treats a missing submission as NOT_SUBMITTED', async () => {
    findParticipatingApplications.mockResolvedValue([application()]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toEqual({
      id: 'milestone-1',
      name: 'First milestone',
      dueAt: DUE_AT,
      submissionStatus: 'NOT_SUBMITTED',
    });
  });

  it('maps a validated successful repository and current-user invitation', async () => {
    findParticipatingApplications.mockResolvedValue([application()]);
    getMyRepositories.mockResolvedValue([
      {
        applicationId: 'application-1',
        repositoryName: 'synthetic-repository',
        provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
        invitationStatus: RepositoryInvitationStatus.PENDING,
        githubUrl: 'https://github.com/JNU-SWCU/synthetic-repository',
      },
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.repository).toEqual({
      repositoryName: 'synthetic-repository',
      provisionStatus: 'SUCCEEDED',
      invitationStatus: 'PENDING',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-repository',
    });
  });

  it('reuses the canonical pre-success repository projection', async () => {
    findParticipatingApplications.mockResolvedValue([application()]);
    getMyRepositories.mockResolvedValue([
      {
        applicationId: 'application-1',
        repositoryName: null,
        provisionStatus: RepositoryProvisionJobStatus.PROCESSING,
        invitationStatus: null,
        githubUrl: null,
      },
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.repository).toEqual({
      repositoryName: null,
      provisionStatus: 'PROCESSING',
      invitationStatus: null,
      githubUrl: null,
    });
  });

  it('distinguishes retryable and final provisioning failures without exposing raw errors', async () => {
    findParticipatingApplications.mockResolvedValue([
      application(),
      application({ id: 'application-2' }),
    ]);
    getMyRepositories.mockResolvedValue([
      {
        applicationId: 'application-1',
        repositoryName: null,
        provisionStatus: RepositoryProvisionJobStatus.FAILED_RETRYABLE,
        invitationStatus: null,
        githubUrl: null,
        lastErrorCode: 'raw upstream response that must not be exposed',
      },
      {
        applicationId: 'application-2',
        repositoryName: null,
        provisionStatus: RepositoryProvisionJobStatus.FAILED_FINAL,
        invitationStatus: null,
        githubUrl: null,
        lastErrorCode: 'raw upstream response that must not be exposed',
      },
    ]);

    const items = await service.getStudentDashboard(101n);

    expect(items.map((item) => item.repository?.provisionStatus)).toEqual([
      'FAILED_RETRYABLE',
      'FAILED_FINAL',
    ]);
    expect(JSON.stringify(items)).not.toContain(
      'raw upstream response that must not be exposed',
    );
  });

  it('fails closed when repository creation succeeded without current-user invitation evidence', async () => {
    findParticipatingApplications.mockResolvedValue([application()]);
    getMyRepositories.mockResolvedValue([
      {
        applicationId: 'application-1',
        connectionMode: 'NEW',
        repositoryName: 'synthetic-repository',
        provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
        invitationStatus: null,
        githubUrl: 'https://github.com/JNU-SWCU/synthetic-repository',
      },
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.repository).toEqual({
      repositoryName: 'synthetic-repository',
      provisionStatus: 'SUCCEEDED',
      invitationStatus: 'FAILED_FINAL',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-repository',
    });
  });

  it('keeps a successful OWN repository complete without an organization invitation', async () => {
    findParticipatingApplications.mockResolvedValue([application()]);
    getMyRepositories.mockResolvedValue([
      {
        applicationId: 'application-1',
        connectionMode: 'OWN',
        repositoryName: 'synthetic-repository',
        provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
        invitationStatus: null,
        githubUrl: 'https://github.com/synthetic-owner/synthetic-repository',
      },
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.repository).toEqual({
      repositoryName: 'synthetic-repository',
      provisionStatus: 'SUCCEEDED',
      invitationStatus: null,
      githubUrl: 'https://github.com/synthetic-owner/synthetic-repository',
    });
  });
});

/**
 * 카드가 **누구에게 보이는가**는 이 조회 조건 하나가 정한다. service 는 Prisma 를 잡지
 * 않으므로 여기서 진짜 repository 에 mock Prisma 를 물려 조건 자체를 고정한다.
 */
describe('StudentDashboardReadRepository', () => {
  const findUnique = jest.fn();
  const findMany = jest.fn();
  const prisma = {
    user: { findUnique },
    application: { findMany },
  } as unknown as PrismaService;
  const repository = new StudentDashboardReadRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue({ id: 'user-1' });
    findMany.mockResolvedValue([]);
  });

  /**
   * 팀에서 빠진 옛 신청자는 카드를 잃는다. 조건에 `applicant`나 `team.leader` 절이
   * 하나라도 남으면 그 사람이 남의 팀 카드를 계속 들고 있게 된다.
   */
  it('narrows applications to current TeamMember rows only', async () => {
    await repository.findParticipatingApplications(101n);

    expect(findUnique).toHaveBeenCalledWith({
      where: { githubId: 101n },
      select: { id: true },
    });
    const [args] = findMany.mock.calls[0] as [Prisma.ApplicationFindManyArgs];
    expect(args.where).toEqual({
      team: { members: { some: { userId: 'user-1' } } },
    });
    expect(JSON.stringify(args.where)).not.toContain('applicant');
    expect(JSON.stringify(args.where)).not.toContain('leader');
  });

  it('returns nothing and never queries applications for an unknown session user', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      repository.findParticipatingApplications(404n),
    ).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  /**
   * #1091 — 새 방식 마일스톤은 `submissionType` 이 없고 서류 항목으로만 완료한다.
   * 조회가 다시 옛 방식 슬롯만 보게 되면 다 낸 학생이 첫 마일스톤에 갇힌다.
   */
  it('selects the whole target ledger and the current team name only', async () => {
    await repository.findParticipatingApplications(101n);

    const [args] = findMany.mock.calls[0] as [Prisma.ApplicationFindManyArgs];
    expect(args.select?.milestoneDocumentSubmissions).toEqual({
      select: submissionCompletionTargetSelect,
    });
    expect(args.select?.team).toEqual({ select: { name: true } });
    // 신청자 스칼라는 표시 이름의 원본이 아니다 — 아예 읽지 않는다.
    expect(args.select).not.toHaveProperty('applicant');
  });
});
