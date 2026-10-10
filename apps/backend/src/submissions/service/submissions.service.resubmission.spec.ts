import {
  ApplicationStatus,
  MilestoneSubmissionType,
  SubmissionStatus,
} from '@prisma/client';
import type {
  CreateSubmissionInput,
  ResubmitSubmissionInput,
} from '../domain/submission-content';
import { SubmissionMembershipChangedError } from '../../prisma/submission-membership-lock';
import { SubmissionsErrorCode } from '../domain/submissions-error-code.enum';
import type { SubmissionApplication } from '../domain/submission-record';
import type {
  ResubmissionTarget,
  SubmissionMilestone,
  SubmissionsRepository,
  SubmissionsStore,
} from '../repository/submissions.repository';
import { StaleSubmissionRevisionError } from '../repository/submissions.repository';
import { SubmissionsService } from './submissions.service';

const githubId = 4242n;
const submissionId = 'submission-1';

const textInput: ResubmitSubmissionInput = {
  baseRevision: 1,
  content: { type: MilestoneSubmissionType.TEXT, text: '보완한 본문' },
  comment: '실행 화면을 추가했습니다',
};

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

  let rolledBack = false;
  const repository = {
    ...store,
    withTransaction: async (
      operation: (transactionStore: SubmissionsStore) => Promise<unknown>,
    ) => {
      try {
        return await operation(store as unknown as SubmissionsStore);
      } catch (error: unknown) {
        rolledBack = true;
        throw error;
      }
    },
  } as unknown as SubmissionsRepository;
  return {
    service: new SubmissionsService(repository),
    createSubmissionRevision: store.createSubmissionRevision,
    submissionExists: store.submissionExists,
    findSubmissionForParticipant: store.findSubmissionForParticipant,
    didRollBack: () => rolledBack,
  };
}

it('FILE 재제출은 Program 잠금 뒤 authoritative target을 다시 검증한다', async () => {
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

  const result = service.resubmit(githubId, submissionId, fileInput, NOW);

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

  const result = service.resubmit(githubId, submissionId, fileInput, NOW);

  await expect(result).rejects.toMatchObject({
    errorCode: { code: scenario.code },
  });
  expect(createSubmissionRevision).not.toHaveBeenCalled();
});

it('CHANGES_REQUESTED + 일치하는 baseRevision이면 새 revision을 만들고 SUBMITTED로 응답한다', async () => {
  const { service, createSubmissionRevision } = buildService();

  const result = await service.resubmit(githubId, submissionId, textInput, NOW);

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
  const { service, createSubmissionRevision } = buildService({
    target: target({ currentRevision: 2 }),
  });

  await expect(
    service.resubmit(githubId, submissionId, textInput, NOW),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.STALE_SUBMISSION_REVISION },
  });
  expect(createSubmissionRevision).not.toHaveBeenCalled();
});

it('동시 재제출로 저장 시점에 밀린 경우도 409 STALE_SUBMISSION_REVISION이다', async () => {
  const { service } = buildService({
    createError: new StaleSubmissionRevisionError(),
  });

  await expect(
    service.resubmit(githubId, submissionId, textInput, NOW),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.STALE_SUBMISSION_REVISION },
  });
});

it('마일스톤 지정 유형과 content.type이 다르면 422 CONTENT_TYPE_MISMATCH다', async () => {
  const { service } = buildService({
    target: target({
      submissionType: MilestoneSubmissionType.FILE,
    }),
  });

  await expect(
    service.resubmit(githubId, submissionId, textInput, NOW),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.CONTENT_TYPE_MISMATCH },
  });
});

it('FILE 유형 재제출은 replacement fileId로 새 revision을 만든다', async () => {
  const { service, createSubmissionRevision } = buildService({
    target: target({ submissionType: MilestoneSubmissionType.FILE }),
  });
  const input: ResubmitSubmissionInput = {
    ...textInput,
    content: { type: MilestoneSubmissionType.FILE, fileId: 'replacement-file' },
  };

  const result = await service.resubmit(githubId, submissionId, input, NOW);

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
  const missing = buildService({ target: null, exists: false });
  const notMember = buildService({ target: null, exists: true });

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
  const { service } = buildService({
    target: target({ applicationStatus: ApplicationStatus.REJECTED }),
  });

  await expect(
    service.resubmit(githubId, submissionId, textInput, NOW),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED },
  });
});

it('비학생 계정은 재제출할 수 없다', async () => {
  const { service } = buildService({ actor: null });

  await expect(
    service.resubmit(githubId, submissionId, textInput, NOW),
  ).rejects.toMatchObject({
    errorCode: { code: SubmissionsErrorCode.STUDENT_ONLY },
  });
});

describe('저장 경계 멤버십 변화', () => {
  it('재제출 저장 중 팀에서 제외되면 403 NOT_APPLICATION_MEMBER로 되돌린다', async () => {
    const { service, didRollBack } = buildService({
      createError: new SubmissionMembershipChangedError(
        'application-1',
        'student-1',
      ),
    });

    await expect(
      service.resubmit(githubId, submissionId, textInput, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.NOT_APPLICATION_MEMBER },
    });
    expect(didRollBack()).toBe(true);
  });
});

const milestone: SubmissionMilestone = {
  id: 'milestone-1',
  programId: 'program-1',
  name: '1차 제출',
  dueAt: new Date('2027-01-01T00:00:00.000Z'),
  submissionType: MilestoneSubmissionType.TEXT,
  instructions: null,
  programEndAt: new Date('2027-01-01T00:00:00.000Z'),
};

function application(
  overrides: Partial<SubmissionApplication> = {},
): SubmissionApplication {
  return {
    id: 'application-1',
    programId: 'program-1',
    teamId: 'team-1',

    teamMemberCount: 3,
    status: ApplicationStatus.APPROVED,
    existingSubmission: null,
    ...overrides,
  };
}

const createTextInput: CreateSubmissionInput = {
  applicationId: 'application-1',
  milestoneId: 'milestone-1',
  content: { type: MilestoneSubmissionType.TEXT, text: '첫 제출 본문' },
  comment: null,
};

function buildCreateService(
  overrides: {
    readonly application?: SubmissionApplication | null;
    readonly milestone?: SubmissionMilestone | null;
    readonly createError?: Error;
  } = {},
) {
  const store = {
    findActiveStudentByGithubId: jest.fn().mockResolvedValue({
      id: 'student-1',
    }),
    findMilestoneById: jest
      .fn()
      .mockResolvedValue(
        overrides.milestone === undefined ? milestone : overrides.milestone,
      ),
    findApplicationForParticipant: jest
      .fn()
      .mockResolvedValue(
        overrides.application === undefined
          ? application()
          : overrides.application,
      ),
    lockProgramEndAt: jest
      .fn()
      .mockResolvedValue(new Date('2027-01-01T00:00:00.000Z')),
    createSubmission: overrides.createError
      ? jest.fn().mockRejectedValue(overrides.createError)
      : jest.fn().mockResolvedValue({
          id: 'submission-1',
          status: SubmissionStatus.SUBMITTED,
          submittedAt: NOW,
        }),
  };
  let rolledBack = false;
  const repository = {
    ...store,
    withTransaction: async (
      operation: (transactionStore: SubmissionsStore) => Promise<unknown>,
    ) => {
      try {
        return await operation(store as unknown as SubmissionsStore);
      } catch (error: unknown) {
        rolledBack = true;
        throw error;
      }
    },
  } as unknown as SubmissionsRepository;
  return {
    service: new SubmissionsService(repository),
    createSubmission: store.createSubmission,
    didRollBack: () => rolledBack,
  };
}

describe('최초 제출', () => {
  it('팀장이 아닌 현재 팀원의 제출을 지금 요청자로 귀속해 저장한다', async () => {
    const { service, createSubmission } = buildCreateService();

    const result = await service.create(githubId, createTextInput, NOW);

    expect(result).toEqual({
      submissionId: 'submission-1',
      status: SubmissionStatus.SUBMITTED,
      submittedAt: NOW.toISOString(),
    });

    expect(createSubmission).toHaveBeenCalledWith(
      createTextInput,
      'student-1',
      NOW,
      null,
    );
  });

  it('제출 저장 중 팀에서 제외되면 403 NOT_APPLICATION_MEMBER로 되돌린다', async () => {
    const { service, didRollBack } = buildCreateService({
      createError: new SubmissionMembershipChangedError(
        'application-1',
        'student-1',
      ),
    });

    await expect(
      service.create(githubId, createTextInput, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.NOT_APPLICATION_MEMBER },
    });
    expect(didRollBack()).toBe(true);
  });

  it('사전 조회에서 참여자가 아니면 저장 경계까지 가지 않는다', async () => {
    const { service, createSubmission } = buildCreateService({
      application: null,
    });

    await expect(
      service.create(githubId, createTextInput, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.NOT_APPLICATION_MEMBER },
    });
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it('마감이 지난 마일스톤은 잠금 경계 전에 거절한다', async () => {
    const { service, createSubmission } = buildCreateService({
      milestone: {
        ...milestone,
        dueAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    await expect(
      service.create(githubId, createTextInput, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.MILESTONE_CLOSED },
    });
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it('이미 제출이 있으면 잠금 경계 전에 거절한다', async () => {
    const { service, createSubmission } = buildCreateService({
      application: application({
        existingSubmission: {
          id: 'submission-0',
          status: SubmissionStatus.SUBMITTED,
        },
      }),
    });

    await expect(
      service.create(githubId, createTextInput, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.SUBMISSION_ALREADY_EXISTS },
    });
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it('승인 전 신청은 제출할 수 없다', async () => {
    const { service, createSubmission } = buildCreateService({
      application: application({ status: ApplicationStatus.SUBMITTED }),
    });

    await expect(
      service.create(githubId, createTextInput, NOW),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED },
    });
    expect(createSubmission).not.toHaveBeenCalled();
  });
});
