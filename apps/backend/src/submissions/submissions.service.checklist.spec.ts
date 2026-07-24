import {
  ApplicationStatus,
  MilestoneSubmissionType,
  SubmissionStatus,
} from '@prisma/client';
import { SubmissionsErrorCode } from './submissions-error-code.enum';
import type {
  ChecklistApplication,
  ChecklistMilestone,
  SubmissionsRepository,
} from './submissions.repository';
import { SubmissionsService } from './submissions.service';

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
          teamId: null,
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
    service: new SubmissionsService(repository),
    findChecklistApplication,
    listChecklistMilestones,
  };
}

it('미제출 마일스톤은 submission=null로, 필드는 계약 형태로 직렬화한다', async () => {
  // Given
  const { service, listChecklistMilestones } = buildService({
    milestones: [milestone()],
  });

  // When
  const checklist = await service.checklist(githubId, 'program-1');

  // Then
  expect(listChecklistMilestones).toHaveBeenCalledWith(
    'program-1',
    'application-1',
  );
  expect(checklist).toEqual({
    applicationId: 'application-1',
    applicationMode: 'PERSONAL',
    items: [
      {
        milestoneId: 'milestone-1',
        name: '중간 보고',
        dueAt: '2026-09-01T14:59:59.000Z',
        submissionType: MilestoneSubmissionType.TEXT,
        submission: null,
      },
    ],
  });
});

it('팀형 신청은 applicationMode=TEAM으로 반환한다', async () => {
  // Given
  const { service } = buildService({
    application: {
      id: 'application-team',
      teamId: 'team-1',
      status: ApplicationStatus.APPROVED,
    },
  });

  // When
  const checklist = await service.checklist(githubId, 'program-1');

  // Then
  expect(checklist.applicationMode).toBe('TEAM');
});

it.each([
  [SubmissionStatus.SUBMITTED, false],
  [SubmissionStatus.APPROVED, false],
  [SubmissionStatus.CHANGES_REQUESTED, true],
  [SubmissionStatus.REJECTED, false],
])('상태 %s의 canResubmit은 %s다', async (status, canResubmit) => {
  // Given
  const { service } = buildService({
    milestones: [
      milestone({
        submission: {
          id: 'submission-1',
          status,
          currentRevision: 1,
          latestReview: null,
        },
      }),
    ],
  });

  // When
  const checklist = await service.checklist(githubId, 'program-1');

  // Then
  expect(checklist.items[0]?.submission).toMatchObject({ canResubmit });
});

it('최신 Review의 시각과 코멘트를 반환하고, 미검토면 둘 다 null이다', async () => {
  // Given
  const { service } = buildService({
    milestones: [
      milestone({
        id: 'reviewed',
        submission: {
          id: 'submission-reviewed',
          status: SubmissionStatus.CHANGES_REQUESTED,
          currentRevision: 1,
          latestReview: {
            reviewedAt: new Date('2026-08-28T01:00:00.000Z'),
            comment: '실행 화면을 추가해 주세요',
          },
        },
      }),
      milestone({
        id: 'unreviewed',
        submission: {
          id: 'submission-unreviewed',
          status: SubmissionStatus.SUBMITTED,
          currentRevision: 1,
          latestReview: null,
        },
      }),
    ],
  });

  // When
  const checklist = await service.checklist(githubId, 'program-1');

  // Then
  expect(checklist.items[0]?.submission).toMatchObject({
    lastReviewedAt: '2026-08-28T01:00:00.000Z',
    reviewComment: '실행 화면을 추가해 주세요',
  });
  expect(checklist.items[1]?.submission).toMatchObject({
    lastReviewedAt: null,
    reviewComment: null,
  });
});

it('비학생·비멤버·미승인 신청은 각각의 403으로 끝난다', async () => {
  // Given
  const nonStudent = buildService({ actor: null });
  const nonMember = buildService({ application: null });
  const unapproved = buildService({
    application: {
      id: 'application-1',
      teamId: null,
      status: ApplicationStatus.SUBMITTED,
    },
  });

  // When & Then
  await expect(
    nonStudent.service.checklist(githubId, 'program-1'),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.STUDENT_ONLY },
  });
  await expect(
    nonMember.service.checklist(githubId, 'program-1'),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.NOT_APPLICATION_MEMBER },
  });
  await expect(
    unapproved.service.checklist(githubId, 'program-1'),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED },
  });
});
