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

function target(
  overrides: Partial<ResubmissionTarget> = {},
): ResubmissionTarget {
  return {
    id: submissionId,
    status: SubmissionStatus.CHANGES_REQUESTED,
    currentRevision: 1,
    submissionType: MilestoneSubmissionType.TEXT,
    applicationStatus: ApplicationStatus.APPROVED,
    repositoryUrl: null,
    ...overrides,
  };
}

function buildService(
  overrides: {
    readonly actor?: { readonly id: string } | null;
    readonly target?: ResubmissionTarget | null;
    readonly exists?: boolean;
    readonly createError?: Error;
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
    createSubmissionRevision: overrides.createError
      ? jest.fn().mockRejectedValue(overrides.createError)
      : jest.fn().mockResolvedValue({ revision: 2 }),
  };
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
  };
}

it('CHANGES_REQUESTED + 일치하는 baseRevision이면 새 revision을 만들고 SUBMITTED로 응답한다', async () => {
  // Given
  const { service, createSubmissionRevision } = buildService();

  // When
  const result = await service.resubmit(githubId, submissionId, textInput);

  // Then
  expect(result).toEqual({
    submissionId,
    revision: 2,
    status: SubmissionStatus.SUBMITTED,
  });
  expect(createSubmissionRevision).toHaveBeenCalledWith({
    submissionId,
    baseRevision: 1,
    content: textInput.content,
    comment: textInput.comment,
    submittedById: 'student-1',
  });
});

it.each([
  [SubmissionStatus.SUBMITTED],
  [SubmissionStatus.APPROVED],
  [SubmissionStatus.REJECTED],
])('최신 상태 %s는 409 RESUBMISSION_NOT_ALLOWED다', async (status) => {
  // Given
  const { service, createSubmissionRevision } = buildService({
    target: target({ status }),
  });

  // When & Then
  await expect(
    service.resubmit(githubId, submissionId, textInput),
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
    service.resubmit(githubId, submissionId, textInput),
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
    service.resubmit(githubId, submissionId, textInput),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.STALE_SUBMISSION_REVISION },
  });
});

it('마일스톤 지정 유형과 content.type이 다르면 422 CONTENT_TYPE_MISMATCH다', async () => {
  // Given
  const { service } = buildService({
    target: target({
      submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
    }),
  });

  // When & Then
  await expect(
    service.resubmit(githubId, submissionId, textInput),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.CONTENT_TYPE_MISMATCH },
  });
});

it('FILE 유형 재제출은 #115와 동일하게 422 FILE_SUBMISSION_UNAVAILABLE이다', async () => {
  // Given
  const { service } = buildService({
    target: target({ submissionType: MilestoneSubmissionType.FILE }),
  });

  // When & Then
  await expect(
    service.resubmit(githubId, submissionId, {
      ...textInput,
      content: { type: MilestoneSubmissionType.FILE, fileId: 'file-id' },
    }),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.FILE_SUBMISSION_UNAVAILABLE },
  });
});

it('REPOSITORY_RELEASE는 #115와 동일한 저장소·release URL 검증을 통과해야 한다', async () => {
  // Given
  const releaseInput: ResubmitSubmissionInput = {
    ...textInput,
    content: {
      type: MilestoneSubmissionType.REPOSITORY_RELEASE,
      releaseUrl: 'https://github.invalid/other-org/other-repo/releases/tag/v2',
    },
  };
  const noRepository = buildService({
    target: target({
      submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
    }),
  });
  const unlinked = buildService({
    target: target({
      submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
      repositoryUrl: 'https://github.invalid/oss-hub-seed/repository-ready',
    }),
  });

  // When & Then
  await expect(
    noRepository.service.resubmit(githubId, submissionId, releaseInput),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.REPOSITORY_NOT_READY },
  });
  await expect(
    unlinked.service.resubmit(githubId, submissionId, releaseInput),
  ).rejects.toMatchObject({
    errorCode: {
      code: SubmissionsErrorCode.RELEASE_URL_NOT_LINKED_REPOSITORY,
    },
  });
});

it('존재하지 않는 제출은 404, 남의 제출은 403으로 구분한다', async () => {
  // Given
  const missing = buildService({ target: null, exists: false });
  const notMember = buildService({ target: null, exists: true });

  // When & Then
  await expect(
    missing.service.resubmit(githubId, submissionId, textInput),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.SUBMISSION_NOT_FOUND },
  });
  await expect(
    notMember.service.resubmit(githubId, submissionId, textInput),
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
    service.resubmit(githubId, submissionId, textInput),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED },
  });
});

it('비학생 계정은 재제출할 수 없다', async () => {
  // Given
  const { service } = buildService({ actor: null });

  // When & Then
  await expect(
    service.resubmit(githubId, submissionId, textInput),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.STUDENT_ONLY },
  });
});
