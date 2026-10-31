import { SubmissionInputService } from './submission-input.service';
import {
  ApplicationStatus,
  MilestoneSubmissionType,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';
import { SubmissionsErrorCode } from './submissions-error-code.error';
import type {
  ChecklistApplication,
  SubmissionsRepository,
} from './submissions.repository';
import { SubmissionsService } from './submissions.service';
import { type ChecklistMilestone } from './submissions.repository';
import { ProgramRulesService } from './program-rules.service';
import { SubmissionFileRulesService } from './submission-file-rules.service';

const githubId = 4242n;

function milestone(
  overrides: Partial<ChecklistMilestone> = {},
): ChecklistMilestone {
  return {
    id: 'milestone-1',
    name: '중간 보고',
    dueAt: new Date('2026-09-01T14:59:59.000Z'),
    submissionType: MilestoneSubmissionType.TEXT,
    submission: null,
    ...overrides,
  };
}

function buildService(
  overrides: {
    readonly actor?: { readonly id: string } | null;
    readonly application?: ChecklistApplication | null;
    readonly milestones?: readonly ChecklistMilestone[];
  } = {},
) {
  const findActiveStudentByGithubId = jest
    .fn()
    .mockResolvedValue(
      overrides.actor === undefined ? { id: 'student-1' } : overrides.actor,
    );
  const findChecklistApplication = jest.fn().mockResolvedValue(
    overrides.application === undefined
      ? {
          id: 'application-1',
          teamId: 'team-solo',
          teamMemberCount: 1,
          status: ApplicationStatus.APPROVED,
        }
      : overrides.application,
  );
  const listChecklistMilestones = jest
    .fn()
    .mockResolvedValue(overrides.milestones ?? []);
  const repository = {
    findActiveStudentByGithubId,
    findChecklistApplication,
    listChecklistMilestones,
  } as unknown as SubmissionsRepository;
  return {
    service: new SubmissionsService(
      repository,
      new ProgramRulesService(),
      new SubmissionFileRulesService(),
      new SubmissionInputService(),
    ),
    findChecklistApplication,
    listChecklistMilestones,
  };
}

it('미제출 마일스톤은 submission=null로, 마감은 Date로 반환한다', async () => {
  const { service, listChecklistMilestones } = buildService({
    milestones: [milestone()],
  });
  const now = new Date('2026-07-31T00:00:00.000Z');

  const checklist = await service.checklist(githubId, 'program-1', now);

  expect(listChecklistMilestones).toHaveBeenCalledWith(
    'program-1',
    'application-1',
    now,
  );
  expect(checklist).toEqual({
    applicationId: 'application-1',
    applicationMode: 'PERSONAL',
    items: [
      {
        milestoneId: 'milestone-1',
        name: '중간 보고',
        dueAt: new Date('2026-09-01T14:59:59.000Z'),
        submissionType: MilestoneSubmissionType.TEXT,
        submission: null,
      },
    ],
  });
});

it('팀형 신청은 applicationMode=TEAM으로 반환한다', async () => {
  const { service } = buildService({
    application: {
      id: 'application-team',
      teamId: 'team-1',
      teamMemberCount: 3,
      status: ApplicationStatus.APPROVED,
    },
  });

  const checklist = await service.checklist(
    githubId,
    'program-1',
    new Date('2026-07-31T00:00:00.000Z'),
  );

  expect(checklist.applicationMode).toBe('TEAM');
});

it.each([
  {
    label: 'SUBMITTED, 마감 전',
    status: SubmissionStatus.SUBMITTED,
    now: new Date('2026-07-31T00:00:00.000Z'),
    canResubmit: true,
  },
  {
    label: 'SUBMITTED, 정확히 마감 시각',
    status: SubmissionStatus.SUBMITTED,
    now: new Date('2026-09-01T14:59:59.000Z'),
    canResubmit: true,
  },
  {
    label: 'SUBMITTED, 마감 후',
    status: SubmissionStatus.SUBMITTED,
    now: new Date('2026-09-01T15:00:00.000Z'),
    canResubmit: false,
  },
  {
    label: 'CHANGES_REQUESTED, 마감 후',
    status: SubmissionStatus.CHANGES_REQUESTED,
    now: new Date('2026-09-01T15:00:00.000Z'),
    canResubmit: true,
  },
  {
    label: 'APPROVED',
    status: SubmissionStatus.APPROVED,
    now: new Date('2026-07-31T00:00:00.000Z'),
    canResubmit: false,
  },
  {
    label: 'REJECTED',
    status: SubmissionStatus.REJECTED,
    now: new Date('2026-07-31T00:00:00.000Z'),
    canResubmit: false,
  },
])(
  '$label 상태의 canResubmit은 $canResubmit이다',
  async ({ status, now, canResubmit }) => {
    const { service } = buildService({
      milestones: [
        milestone({
          submission: {
            id: 'submission-1',
            status,
            currentRevision: 1,
            latestReview: null,
            file: null,
          },
        }),
      ],
    });

    const checklist = await service.checklist(githubId, 'program-1', now);

    expect(checklist.items[0]?.submission).toMatchObject({ canResubmit });
  },
);

it.each([
  [ReviewDecision.APPROVED, SubmissionStatus.APPROVED],
  [ReviewDecision.REJECTED, SubmissionStatus.REJECTED],
  [ReviewDecision.CHANGES_REQUESTED, SubmissionStatus.CHANGES_REQUESTED],
])(
  '판정 %s과 코멘트를 본인 체크리스트에 반환한다',
  async (decision, status) => {
    const { service } = buildService({
      milestones: [
        milestone({
          id: `reviewed-${decision}`,
          submission: {
            id: 'submission-reviewed',
            status,
            currentRevision: 1,
            latestReview: {
              decision,
              reviewedAt: new Date('2026-08-28T01:00:00.000Z'),
              comment: '검토 코멘트',
            },
            file: null,
          },
        }),
        milestone({
          id: 'unreviewed',
          submission: {
            id: 'submission-unreviewed',
            status: SubmissionStatus.SUBMITTED,
            currentRevision: 1,
            latestReview: null,
            file: null,
          },
        }),
      ],
    });

    const checklist = await service.checklist(
      githubId,
      'program-1',
      new Date('2026-07-31T00:00:00.000Z'),
    );

    expect(checklist.items[0]?.submission).toMatchObject({
      decision,
      lastReviewedAt: new Date('2026-08-28T01:00:00.000Z'),
      reviewComment: '검토 코멘트',
    });
    expect(checklist.items[1]?.submission).toMatchObject({
      decision: null,
      lastReviewedAt: null,
      reviewComment: null,
    });
  },
);

it.each([
  ['비학생', { actor: null }, SubmissionsErrorCode.STUDENT_ONLY],
  [
    '비멤버',
    { application: null },
    SubmissionsErrorCode.NOT_APPLICATION_MEMBER,
  ],
  [
    '미승인 신청',
    {
      application: {
        id: 'application-1',
        teamId: 'team-solo',
        teamMemberCount: 1,
        status: ApplicationStatus.SUBMITTED,
      },
    },
    SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED,
  ],
] as const)('%s은 403으로 끝난다', async (_, overrides, errorCode) => {
  const { service } = buildService(overrides);

  await expect(
    service.checklist(
      githubId,
      'program-1',
      new Date('2026-07-31T00:00:00.000Z'),
    ),
  ).rejects.toMatchObject({
    errorCode: { code: errorCode },
  });
});
