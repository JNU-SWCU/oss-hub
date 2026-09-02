import {
  ApplicationStatus,
  MilestoneSubmissionType,
  SubmissionStatus,
} from '@prisma/client';
import type { ResubmitSubmissionInput } from './domain/submission-content';
import { SubmissionsErrorCode } from './submissions-error-code.enum';
import type {
  ResubmissionTarget,
  SubmissionsRepository,
  SubmissionsStore,
} from './submissions.repository';
import { StaleSubmissionRevisionError } from './submissions.repository';
import { SubmissionsService } from './submissions.service';

const githubId = 4242n;
const submissionId = 'submission-1';

const textInput: ResubmitSubmissionInput = {
  baseRevision: 1,
  content: { type: MilestoneSubmissionType.TEXT, text: '보완한 본문' },
  comment: '실행 화면을 추가했습니다',
};

/**
 * 이 스펙이 서는 고정 시각. 기본 `dueAt`(2027-01-01)보다 앞이라 마감 전 상태를 뜻한다.
 *
 * ⚠ `service.resubmit`의 `now`는 기본값이 `new Date()`다. 넘기지 않으면 실제 시각으로
 * 마감을 판정하므로, 고정 `dueAt`을 지나는 순간 코드를 아무도 건드리지 않았는데
 * 테스트가 뒤집힌다 — 같은 일이 checklist 스펙에서 실제로 일어났다(#1144).
 * 마감 경계 자체를 보는 테스트만 자기 시각을 따로 넘긴다.
 */
const NOW = new Date('2026-07-31T00:00:00.000Z');

function target(
  overrides: Partial<ResubmissionTarget> = {},
): ResubmissionTarget {
  return {
    id: submissionId,
    submissionRecordId: 'target-submission-1',
    applicationId: 'application-1',
    milestoneId: 'milestone-1',
    programId: 'program-1',
    status: SubmissionStatus.CHANGES_REQUESTED,
    currentRevision: 1,
    submissionType: MilestoneSubmissionType.TEXT,
    applicationStatus: ApplicationStatus.APPROVED,
    dueAt: new Date('2027-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildService(
  overrides: {
    readonly actor?: { readonly id: string } | null;
    readonly target?: ResubmissionTarget | null;
    readonly exists?: boolean;
    readonly createError?: Error;
    readonly targets?: readonly (ResubmissionTarget | null)[];
  } = {},
) {
  const store = {
    findActiveStudentByGithubId: jest
      .fn()
      .mockResolvedValue(
        overrides.actor === undefined ? { id: 'student-1' } : overrides.actor,
      ),
    findSubmissionForParticipant: jest
      .fn()
      .mockResolvedValue(
        overrides.target === undefined ? target() : overrides.target,
      ),
    submissionExists: jest.fn().mockResolvedValue(overrides.exists ?? true),
    lockProgramEndAt: jest
      .fn()
      .mockResolvedValue(new Date('2027-01-01T00:00:00.000Z')),
    createSubmissionRevision: overrides.createError
      ? jest.fn().mockRejectedValue(overrides.createError)
      : jest.fn().mockResolvedValue({ revision: 2 }),
  };
  if (overrides.targets) {
    for (const value of overrides.targets) {
      store.findSubmissionForParticipant.mockResolvedValueOnce(value);
    }
  }
  const repository = {
    ...store,
    withTransaction: (
      operation: (transactionStore: SubmissionsStore) => Promise<unknown>,
    ) => operation(store as unknown as SubmissionsStore),
  } as unknown as SubmissionsRepository;
  return {
    service: new SubmissionsService(repository),
    createSubmissionRevision: store.createSubmissionRevision,
    submissionExists: store.submissionExists,
    findSubmissionForParticipant: store.findSubmissionForParticipant,
  };
}

it('FILE 재제출은 Program 잠금 뒤 authoritative target을 다시 검증한다', async () => {
  // Given
  const fileInput: ResubmitSubmissionInput = {
    baseRevision: 1,
    content: { type: MilestoneSubmissionType.FILE, fileId: 'file-1' },
    comment: null,
  };
  const { service, createSubmissionRevision, findSubmissionForParticipant } =
    buildService({
      targets: [
        target({ submissionType: MilestoneSubmissionType.FILE }),
        target({ submissionType: MilestoneSubmissionType.TEXT }),
      ],
    });

  // When
  const result = service.resubmit(githubId, submissionId, fileInput, NOW);

  // Then
  await expect(result).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.CONTENT_TYPE_MISMATCH },
  });
  expect(findSubmissionForParticipant).toHaveBeenCalledTimes(2);
  expect(createSubmissionRevision).not.toHaveBeenCalled();
});

it.each([
  {
    name: 'status',
    lockedTarget: target({ status: SubmissionStatus.SUBMITTED }),
    code: SubmissionsErrorCode.STALE_SUBMISSION_REVISION,
  },
  {
    name: 'baseRevision',
    lockedTarget: target({ currentRevision: 2 }),
    code: SubmissionsErrorCode.STALE_SUBMISSION_REVISION,
  },
  {
    name: 'application approval',
    lockedTarget: target({ applicationStatus: ApplicationStatus.SUBMITTED }),
    code: SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED,
  },
])('FILE 재제출은 Program 잠금 뒤 최신 $name을 검증한다', async (scenario) => {
  // Given
  const fileInput: ResubmitSubmissionInput = {
    baseRevision: 1,
    content: { type: MilestoneSubmissionType.FILE, fileId: 'file-1' },
    comment: null,
  };
  const { service, createSubmissionRevision } = buildService({
    targets: [
      target({ submissionType: MilestoneSubmissionType.FILE }),
      scenario.lockedTarget,
    ],
  });

  // When
  const result = service.resubmit(githubId, submissionId, fileInput, NOW);

  // Then
  await expect(result).rejects.toMatchObject({
    errorCode: { code: scenario.code },
  });
  expect(createSubmissionRevision).not.toHaveBeenCalled();
});

it('CHANGES_REQUESTED + 일치하는 baseRevision이면 새 revision을 만들고 SUBMITTED로 응답한다', async () => {
  // Given
  const { service, createSubmissionRevision } = buildService();

  // When
  const result = await service.resubmit(githubId, submissionId, textInput, NOW);

  // Then
  expect(result).toEqual({
    submissionId,
    revision: 2,
    status: SubmissionStatus.SUBMITTED,
  });
  expect(createSubmissionRevision).toHaveBeenCalledWith(
    expect.objectContaining({
      submissionId: 'target-submission-1',
      applicationId: 'application-1',
      milestoneId: 'milestone-1',
      baseRevision: 1,
      baseStatus: SubmissionStatus.CHANGES_REQUESTED,
      content: textInput.content,
      comment: textInput.comment,
      submittedById: 'student-1',
      fileExpiresAt: null,
    }),
  );
});

it('마감 후 SUBMITTED 제출물 교체는 422 SUBMISSION_REPLACEMENT_CLOSED다', async () => {
  const { service, createSubmissionRevision } = buildService({
    target: target({
      status: SubmissionStatus.SUBMITTED,
      dueAt: new Date('2026-01-01T00:00:00.000Z'),
    }),
  });

  await expect(
    service.resubmit(githubId, submissionId, textInput, NOW),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.SUBMISSION_REPLACEMENT_CLOSED },
  });
  expect(createSubmissionRevision).not.toHaveBeenCalled();
});

// 승인된 제출물은 마감 전이든 후든 교체하지 않는다 — 교체를 허용하면 교직원 판정이
// 옛 revision 을 가리킨 채 남아 심사 무결성이 깨진다.
it.each([
  new Date('2026-01-01T00:00:00.000Z'),
  new Date('2099-01-01T00:00:00.000Z'),
])('APPROVED 제출물 교체는 마감(%s)과 무관하게 거부한다', async (dueAt) => {
  const { service, createSubmissionRevision } = buildService({
    target: target({ status: SubmissionStatus.APPROVED, dueAt }),
  });

  await expect(
    service.resubmit(githubId, submissionId, textInput, NOW),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.RESUBMISSION_NOT_ALLOWED },
  });
  expect(createSubmissionRevision).not.toHaveBeenCalled();
});

it('마감 전 SUBMITTED 제출물은 새 revision으로 교체한다', async () => {
  const { service, createSubmissionRevision } = buildService({
    target: target({ status: SubmissionStatus.SUBMITTED }),
  });

  const result = await service.resubmit(githubId, submissionId, textInput, NOW);

  expect(result).toMatchObject({
    revision: 2,
    status: SubmissionStatus.SUBMITTED,
  });
  expect(createSubmissionRevision).toHaveBeenCalledWith(
    expect.objectContaining({ baseStatus: SubmissionStatus.SUBMITTED }),
  );
});

it('마감 시각과 정확히 같은 SUBMITTED 제출물은 새 revision으로 교체한다', async () => {
  const dueAt = new Date('2026-08-08T12:00:00.000Z');
  const { service, createSubmissionRevision } = buildService({
    target: target({ status: SubmissionStatus.SUBMITTED, dueAt }),
  });

  await expect(
    service.resubmit(githubId, submissionId, textInput, dueAt),
  ).resolves.toMatchObject({ revision: 2, status: SubmissionStatus.SUBMITTED });
  expect(createSubmissionRevision).toHaveBeenCalled();
});

it('REJECTED 제출물은 마감 전에도 교체할 수 없다', async () => {
  const { service, createSubmissionRevision } = buildService({
    target: target({ status: SubmissionStatus.REJECTED }),
  });

  await expect(
    service.resubmit(githubId, submissionId, textInput, NOW),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.RESUBMISSION_NOT_ALLOWED },
  });
  expect(createSubmissionRevision).not.toHaveBeenCalled();
});

it('baseRevision이 currentRevision과 다르면 409 STALE_SUBMISSION_REVISION이다', async () => {
  // Given
  const { service, createSubmissionRevision } = buildService({
    target: target({ currentRevision: 2 }),
  });

  // When & Then
  await expect(
    service.resubmit(githubId, submissionId, textInput, NOW),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.STALE_SUBMISSION_REVISION },
  });
  expect(createSubmissionRevision).not.toHaveBeenCalled();
});

it('동시 재제출로 저장 시점에 밀린 경우도 409 STALE_SUBMISSION_REVISION이다', async () => {
  // Given
  const { service } = buildService({
    createError: new StaleSubmissionRevisionError(),
  });

  // When & Then
  await expect(
    service.resubmit(githubId, submissionId, textInput, NOW),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.STALE_SUBMISSION_REVISION },
  });
});

it('마일스톤 지정 유형과 content.type이 다르면 422 CONTENT_TYPE_MISMATCH다', async () => {
  // Given
  const { service } = buildService({
    target: target({
      submissionType: MilestoneSubmissionType.FILE,
    }),
  });

  // When & Then
  await expect(
    service.resubmit(githubId, submissionId, textInput, NOW),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.CONTENT_TYPE_MISMATCH },
  });
});

it('FILE 유형 재제출은 replacement fileId로 새 revision을 만든다', async () => {
  // Given
  const { service, createSubmissionRevision } = buildService({
    target: target({ submissionType: MilestoneSubmissionType.FILE }),
  });
  const input: ResubmitSubmissionInput = {
    ...textInput,
    content: { type: MilestoneSubmissionType.FILE, fileId: 'replacement-file' },
  };

  // When
  const result = await service.resubmit(githubId, submissionId, input, NOW);

  // Then
  expect(result).toEqual({
    submissionId,
    revision: 2,
    status: SubmissionStatus.SUBMITTED,
  });
  expect(createSubmissionRevision).toHaveBeenCalledWith(
    expect.objectContaining({
      submissionId: 'target-submission-1',
      applicationId: 'application-1',
      milestoneId: 'milestone-1',
      baseRevision: 1,
      content: input.content,
      comment: input.comment,
      submittedById: 'student-1',
      fileExpiresAt: new Date('2028-01-01T00:00:00.000Z'),
    }),
  );
});

it('존재하지 않는 제출은 404, 남의 제출은 403으로 구분한다', async () => {
  // Given
  const missing = buildService({ target: null, exists: false });
  const notMember = buildService({ target: null, exists: true });

  // When & Then
  await expect(
    missing.service.resubmit(githubId, submissionId, textInput, NOW),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.SUBMISSION_NOT_FOUND },
  });
  await expect(
    notMember.service.resubmit(githubId, submissionId, textInput, NOW),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.NOT_APPLICATION_MEMBER },
  });
});

it('신청이 더 이상 APPROVED가 아니면 403이다', async () => {
  // Given
  const { service } = buildService({
    target: target({ applicationStatus: ApplicationStatus.REJECTED }),
  });

  // When & Then
  await expect(
    service.resubmit(githubId, submissionId, textInput, NOW),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED },
  });
});

it('비학생 계정은 재제출할 수 없다', async () => {
  // Given
  const { service } = buildService({ actor: null });

  // When & Then
  await expect(
    service.resubmit(githubId, submissionId, textInput, NOW),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.STUDENT_ONLY },
  });
});
