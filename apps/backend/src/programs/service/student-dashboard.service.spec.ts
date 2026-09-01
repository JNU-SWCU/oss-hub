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

function program(milestones: readonly Record<string, unknown>[]) {
  return { id: 'program-1', name: 'Synthetic Program', milestones };
}

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: 'application-1',
    status: ApplicationStatus.APPROVED,
    // D5: 개인 참여 = 1인 팀. teamId/team은 항상 있고 멤버 수로 개인/팀을 가른다.
    teamId: 'solo-team-1',
    applicant: {
      profile: { name: 'Synthetic Applicant' },
      nickname: 'synthetic',
    },
    team: { name: 'Synthetic Applicant', _count: { members: 1 } },
    program: program([
      legacyMilestone('milestone-1', 'First milestone', DUE_AT),
    ]),
    milestoneDocumentSubmissions: [],
    ...overrides,
  };
}

describe('StudentDashboardService', () => {
  const findMany = jest.fn();
  const prisma = {
    application: { findMany },
  } as unknown as PrismaService;
  const getMyRepositories = jest.fn();
  const repositories = {
    getMyRepositories,
  } as RepositoriesReadPort;
  const service = new StudentDashboardService(prisma, repositories);

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([]);
    getMyRepositories.mockResolvedValue([]);
  });

  it('returns no items when the student owns no applications', async () => {
    await expect(service.getStudentDashboard(404n)).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(getMyRepositories).toHaveBeenCalledWith(404n);
  });

  it('compiles with the DTO-only repositories read-port token', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StudentDashboardService,
        {
          provide: PrismaService,
          useValue: { application: { findMany: jest.fn() } },
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

  it('maps owned solo-team and multi-member team applications and queries team membership only', async () => {
    findMany.mockResolvedValue([
      application(),
      application({
        id: 'application-2',
        teamId: 'team-1',
        applicant: { profile: { name: 'Other applicant' }, nickname: 'other' },
        team: { name: 'Synthetic Team', _count: { members: 2 } },
      }),
    ]);

    const items = await service.getStudentDashboard(101n);

    // D5: teamId는 항상 non-null이므로 멤버 수(1명 = 개인, 2명 이상 = 팀)로 가른다.
    expect(items).toEqual([
      expect.objectContaining({
        applicationId: 'application-1',
        applicationMode: 'PERSONAL',
        displayName: 'Synthetic Applicant',
        detailUrl: '/programs/program-1',
        checklistUrl: '/programs/program-1/submissions',
      }),
      expect.objectContaining({
        applicationId: 'application-2',
        applicationMode: 'TEAM',
        displayName: 'Synthetic Team',
      }),
    ]);
    expect(items[0]?.repository?.provisionStatus).toBe('NOT_STARTED');
    expect(getMyRepositories).toHaveBeenCalledWith(101n);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          // production student-dashboard.service.ts — 팀 소속 하나로 판정(D5).
          team: {
            OR: [
              { leader: { githubId: 101n } },
              { members: { some: { user: { githubId: 101n } } } },
            ],
          },
        },
      }),
    );
  });

  /**
   * 카드가 학생을 **어디로 보내는지**. 이 단언이 없는 동안 `detailUrl`은 아무 곳이나
   * 가리켜도 모든 테스트가 초록불이었고, 그래서 반려된 학생이 사유도 신청 상태도 없는
   * 프로그램 상세로 가는 것을 아무도 잡지 못했다(#733).
   *
   * frontend 검증기(`features/dashboard/api.ts`)가 같은 규칙을 반대편에서 **글자 그대로**
   * 강제한다 — 한쪽만 바뀌면 검증기가 던져서 그 학생의 대시보드가 통째로 오류 화면이 된다.
   * 그래서 세 상태를 전부 고정한다. 하나만 고정하면 나머지가 조용히 갈릴 수 있다.
   */
  it.each([
    [ApplicationStatus.SUBMITTED, '/programs/program-1/apply'],
    [ApplicationStatus.REJECTED, '/programs/program-1/apply'],
    [ApplicationStatus.APPROVED, '/programs/program-1'],
  ])('points a %s application at %s', async (status, detailUrl) => {
    findMany.mockResolvedValue([application({ status })]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.detailUrl).toBe(detailUrl);
  });

  it('keeps nextMilestone null for applications that are not approved', async () => {
    findMany.mockResolvedValue([
      application({ status: ApplicationStatus.SUBMITTED }),
    ]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toBeNull();
  });

  it('skips approved milestones and returns null when all milestones are approved', async () => {
    findMany.mockResolvedValue([
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

  /**
   * #1091 — 새 방식 마일스톤은 `submissionType` 이 없고 서류 항목으로만 완료한다.
   *
   * 대시보드가 옛 방식 슬롯만 골라 오던 동안 이 축의 제출은 한 건도 도착하지 않아,
   * 학생이 다 내고 승인까지 받아도 카드가 첫 마일스톤에 머물렀다. 아래 네 건은 조회가
   * 다시 옛 방식 슬롯만 보게 되면 전부 깨진다.
   */
  it('reads the whole target ledger instead of the legacy submission slot alone', async () => {
    await service.getStudentDashboard(101n);

    const [args] = findMany.mock.calls[0] as [Prisma.ApplicationFindManyArgs];
    expect(args.select?.milestoneDocumentSubmissions).toEqual({
      select: submissionCompletionTargetSelect,
    });
  });

  it('holds the milestone while any required document is unapproved', async () => {
    findMany.mockResolvedValue([
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
    findMany.mockResolvedValue([
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
    findMany.mockResolvedValue([
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
    findMany.mockResolvedValue([
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
    findMany.mockResolvedValue([application()]);

    const [item] = await service.getStudentDashboard(101n);

    expect(item?.nextMilestone).toEqual({
      id: 'milestone-1',
      name: 'First milestone',
      dueAt: DUE_AT,
      submissionStatus: 'NOT_SUBMITTED',
    });
  });

  it('maps a validated successful repository and current-user invitation', async () => {
    findMany.mockResolvedValue([application()]);
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
    findMany.mockResolvedValue([application()]);
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
    findMany.mockResolvedValue([
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
    findMany.mockResolvedValue([application()]);
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
    findMany.mockResolvedValue([application()]);
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
