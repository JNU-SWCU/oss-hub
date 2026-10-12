import { ReviewDecision, SubmissionStatus } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import { MilestoneDocumentsErrorCode } from '../domain/milestone-documents-error-code.enum';
import type { ProgramDocumentChangeRequestInput } from '../domain/program-document-change-request';
import type { ProgramArchiveReader } from '../repository/milestone-document-archive.repository';
import type {
  MilestoneDocumentsRepository,
  MilestoneDocumentWriteStore,
} from '../repository/milestone-documents.repository';
import { ProgramDocumentChangeRequestsService } from './program-document-change-requests.service';

const programId = 'synthetic-program';
const now = new Date('2026-10-12T03:00:00.000Z');
const dueAt = new Date('2026-10-19T14:59:59.000Z');

function programs(
  teams: readonly string[] = ['application-a', 'application-b'],
): jest.Mocked<ProgramArchiveReader> {
  return {
    findProgram: jest.fn().mockResolvedValue({ name: '합성', milestones: [] }),
    findApprovedTeams: jest.fn().mockResolvedValue(
      teams.map((applicationId) => ({
        applicationId,
        teamName: applicationId,
        applicantName: null,
        memberNicknames: [],
      })),
    ),
  };
}

function authority(allowed = true) {
  return {
    assertActiveStaff: jest.fn((_githubId: bigint, error: () => Error) =>
      allowed
        ? Promise.resolve({ actorId: 'staff-1' })
        : Promise.reject(error()),
    ),
  };
}

function writeStore(
  targets: readonly { milestoneDocumentId: string; applicationId: string }[],
) {
  return {
    lockProgramDocumentIds: jest.fn().mockResolvedValue(['document-1']),
    findChangeRequestTargets: jest.fn().mockResolvedValue(targets),
    findSubmissionForReview: jest.fn(
      (milestoneDocumentId: string, applicationId: string) =>
        Promise.resolve({
          id: `${applicationId}:${milestoneDocumentId}`,
          revision: 2,
          submissionHistoryId: `history:${applicationId}`,
          latestHistoryCreatedAt: new Date('2026-10-11T00:00:00.000Z'),
        }),
    ),
    createReview: jest.fn().mockResolvedValue({}),
    updateSubmissionStatus: jest.fn().mockResolvedValue(undefined),
  };
}

function repository(store: ReturnType<typeof writeStore>) {
  return {
    countChangeRequestTargets: jest.fn().mockResolvedValue(
      new Map([
        [SubmissionStatus.SUBMITTED, 3],
        [SubmissionStatus.APPROVED, 1],
      ]),
    ),
    withTransaction: jest.fn(
      (operation: (store: MilestoneDocumentWriteStore) => Promise<unknown>) =>
        operation(store as unknown as MilestoneDocumentWriteStore),
    ),
  };
}

function service(input: {
  readonly store?: ReturnType<typeof writeStore>;
  readonly programs?: jest.Mocked<ProgramArchiveReader>;
  readonly allowed?: boolean;
}) {
  const store = input.store ?? writeStore([]);
  const repo = repository(store);
  return {
    store,
    repo,
    service: new ProgramDocumentChangeRequestsService(
      repo as unknown as MilestoneDocumentsRepository,
      input.programs ?? programs(),
      authority(input.allowed ?? true),
    ),
  };
}

function request(
  overrides: Partial<ProgramDocumentChangeRequestInput> = {},
): ProgramDocumentChangeRequestInput {
  return {
    scope: { kind: 'PROGRAM' },
    includeFinalDecisions: false,
    comment: '양식을 바꿔 다시 내 주세요.',
    resubmissionDueAt: dueAt,
    expectedCount: 2,
    ...overrides,
  };
}

function code(error: unknown): string | undefined {
  return error instanceof DomainException ? error.errorCode.code : undefined;
}

describe('ProgramDocumentChangeRequestsService.targets', () => {
  it('범위 안 서류 제출을 상태별로 세고 없는 상태는 0으로 돌려준다', async () => {
    const { service: subject, repo } = service({});

    await expect(
      subject.targets(1n, programId, { kind: 'PROGRAM' }),
    ).resolves.toEqual({
      SUBMITTED: 3,
      CHANGES_REQUESTED: 0,
      APPROVED: 1,
      REJECTED: 0,
    });
    expect(repo.countChangeRequestTargets).toHaveBeenCalledWith(programId, [
      'application-a',
      'application-b',
    ]);
  });

  it('팀 범위는 그 팀의 승인 신청만 세고, 없는 팀이면 거절한다', async () => {
    const reader = programs([]);
    const { service: subject } = service({ programs: reader });

    const error = await subject
      .targets(1n, programId, { kind: 'TEAM', teamId: 'team-x' })
      .catch((caught: unknown) => caught);

    expect(code(error)).toBe(
      MilestoneDocumentsErrorCode.CHANGE_REQUEST_TEAM_NOT_FOUND,
    );
    expect(reader.findApprovedTeams.mock.calls).toEqual([
      [programId, 'team-x'],
    ]);
  });

  it('교직원이 아니면 아무것도 읽지 않고 거절한다', async () => {
    const reader = programs();
    const { service: subject, repo } = service({
      programs: reader,
      allowed: false,
    });

    const error = await subject
      .targets(1n, programId, { kind: 'PROGRAM' })
      .catch((caught: unknown) => caught);

    expect(code(error)).toBe(MilestoneDocumentsErrorCode.STAFF_ONLY);
    expect(reader.findProgram.mock.calls).toEqual([]);
    expect(repo.countChangeRequestTargets).not.toHaveBeenCalled();
  });

  it('없는 프로그램이면 거절한다', async () => {
    const reader = programs();
    reader.findProgram.mockResolvedValue(null);
    const { service: subject } = service({ programs: reader });

    const error = await subject
      .targets(1n, programId, { kind: 'PROGRAM' })
      .catch((caught: unknown) => caught);

    expect(code(error)).toBe(MilestoneDocumentsErrorCode.PROGRAM_NOT_FOUND);
  });
});

describe('ProgramDocumentChangeRequestsService.requestChanges', () => {
  const targets = [
    { milestoneDocumentId: 'document-1', applicationId: 'application-a' },
    { milestoneDocumentId: 'document-1', applicationId: 'application-b' },
  ];

  it('대상마다 보완 요청 판정 이력을 더하고 제출 상태만 보완 요청으로 바꾼다', async () => {
    const store = writeStore(targets);
    const { service: subject } = service({ store });

    await expect(
      subject.requestChanges(1n, programId, request(), () => now),
    ).resolves.toEqual({ requestedCount: 2 });

    expect(store.lockProgramDocumentIds).toHaveBeenCalledWith(programId);
    expect(store.findChangeRequestTargets).toHaveBeenCalledWith({
      documentIds: ['document-1'],
      applicationIds: ['application-a', 'application-b'],
      statuses: [
        SubmissionStatus.SUBMITTED,
        SubmissionStatus.CHANGES_REQUESTED,
      ],
    });
    expect(store.createReview).toHaveBeenCalledTimes(2);
    expect(store.createReview).toHaveBeenCalledWith({
      milestoneDocumentSubmissionId: 'application-a:document-1',
      submissionHistoryId: 'history:application-a',
      revision: 2,
      reviewerId: 'staff-1',
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '양식을 바꿔 다시 내 주세요.',
      resubmissionDueAt: dueAt,
      reviewedAt: now,
    });
    expect(store.updateSubmissionStatus).toHaveBeenCalledWith(
      'application-b:document-1',
      SubmissionStatus.CHANGES_REQUESTED,
    );
  });

  it('이미 승인·반려한 제출도 포함하면 승인·반려 상태까지 대상으로 찾는다', async () => {
    const store = writeStore(targets);
    const { service: subject } = service({ store });

    await subject.requestChanges(
      1n,
      programId,
      request({ includeFinalDecisions: true }),
      () => now,
    );

    expect(store.findChangeRequestTargets).toHaveBeenCalledWith(
      expect.objectContaining({
        statuses: [
          SubmissionStatus.SUBMITTED,
          SubmissionStatus.CHANGES_REQUESTED,
          SubmissionStatus.APPROVED,
          SubmissionStatus.REJECTED,
        ],
      }),
    );
  });

  it('대상 수가 확인한 수와 다르면 판정을 하나도 남기지 않고 거절한다', async () => {
    const store = writeStore(targets);
    const { service: subject } = service({ store });

    const error = await subject
      .requestChanges(1n, programId, request({ expectedCount: 3 }), () => now)
      .catch((caught: unknown) => caught);

    expect(code(error)).toBe(MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED);
    expect(store.createReview).not.toHaveBeenCalled();
    expect(store.updateSubmissionStatus).not.toHaveBeenCalled();
  });

  it('재제출 기한이 지금 이후가 아니면 잠그기 전에 거절한다', async () => {
    const store = writeStore(targets);
    const { service: subject, repo } = service({ store });

    const error = await subject
      .requestChanges(
        1n,
        programId,
        request({ resubmissionDueAt: now }),
        () => now,
      )
      .catch((caught: unknown) => caught);

    expect(code(error)).toBe(
      MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_NOT_FUTURE,
    );
    expect(repo.withTransaction).not.toHaveBeenCalled();
  });

  it('교직원이 아니면 잠그지 않고 거절한다', async () => {
    const store = writeStore(targets);
    const { service: subject, repo } = service({ store, allowed: false });

    const error = await subject
      .requestChanges(1n, programId, request(), () => now)
      .catch((caught: unknown) => caught);

    expect(code(error)).toBe(MilestoneDocumentsErrorCode.STAFF_ONLY);
    expect(repo.withTransaction).not.toHaveBeenCalled();
  });
});
