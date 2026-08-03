import {
  ApplicationStatus,
  MilestoneSubmissionType,
  ReviewDecision,
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
  const now = new Date('2026-07-31T00:00:00.000Z');

  // When
  const checklist = await service.checklist(githubId, 'program-1', now);

  // Then
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

// 마감 전 SUBMITTED 는 교체할 수 있다(#블로커 6b) — 잘못 낸 파일을 마감 전에 고칠
// 경로가 없던 것이 결함이었다. APPROVED·REJECTED 는 판정이 난 뒤라 교체하지 않는다.
it.each([
  [SubmissionStatus.SUBMITTED, true],
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
          file: null,
        },
      }),
    ],
  });

  // When
  const checklist = await service.checklist(githubId, 'program-1');

  // Then
  expect(checklist.items[0]?.submission).toMatchObject({ canResubmit });
});

it.each([
  [ReviewDecision.APPROVED, SubmissionStatus.APPROVED],
  [ReviewDecision.REJECTED, SubmissionStatus.REJECTED],
  [ReviewDecision.CHANGES_REQUESTED, SubmissionStatus.CHANGES_REQUESTED],
])(
  '판정 %s과 코멘트를 본인 체크리스트에 반환한다',
  async (decision, status) => {
    // Given
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

    const checklist = await service.checklist(githubId, 'program-1');

    expect(checklist.items[0]?.submission).toMatchObject({
      decision,
      lastReviewedAt: '2026-08-28T01:00:00.000Z',
      reviewComment: '검토 코멘트',
    });
    expect(checklist.items[1]?.submission).toMatchObject({
      decision: null,
      lastReviewedAt: null,
      reviewComment: null,
    });
  },
);

it('현재 revision의 첨부 파일은 storageKey 없이 다운로드 URL과 안전한 메타데이터만 반환한다', async () => {
  // Given
  const { service } = buildService({
    milestones: [
      milestone({
        submission: {
          id: 'submission-file',
          status: SubmissionStatus.SUBMITTED,
          currentRevision: 1,
          latestReview: null,
          file: {
            fileId: 'file-opaque',
            fileName: 'report.pdf',
            contentType: 'application/pdf',
            size: 1024,
            expiresAt: new Date('2028-01-01T00:00:00.000Z'),
            downloadUrl: '/api/v1/submission-files/file-opaque',
          },
        },
      }),
    ],
  });

  // When
  const checklist = await service.checklist(githubId, 'program-1');

  // Then
  const serialized = JSON.stringify(checklist);
  expect(checklist.items[0]?.submission).toMatchObject({
    file: {
      fileId: 'file-opaque',
      fileName: 'report.pdf',
      contentType: 'application/pdf',
      size: 1024,
      expiresAt: '2028-01-01T00:00:00.000Z',
      downloadUrl: '/api/v1/submission-files/file-opaque',
    },
  });
  expect(serialized).not.toContain('storageKey');
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
