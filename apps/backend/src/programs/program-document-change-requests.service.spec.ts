import { PlatformRepository } from '../platform/platform.repository';
import { MilestoneDocumentSubmissionRepository } from './milestone-document-submission.repository';
import { ReviewDecision, SubmissionStatus } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import { MilestoneDocumentsErrorCode } from './milestone-documents-error-code.error';
import type { ProgramArchiveReader } from './milestone-document-archive.repository';
import type {
  MilestoneDocumentsRepository,
  MilestoneDocumentWriteStore,
} from './milestone-documents.repository';
import { ProgramDocumentChangeRequestsService } from './program-document-change-requests.service';
import {
  type ProgramDocumentChangeRequestCandidate,
  type ProgramDocumentChangeRequestInput,
} from './milestone-document-collection-read.repository';
import { MilestoneDocumentRulesService } from './milestone-document-rules.service';
import { ProgramRulesService } from './program-rules.service';

const milestoneDocumentRulesService = new MilestoneDocumentRulesService(
  new ProgramRulesService(),
);

const programId = 'synthetic-program';
const now = new Date('2026-10-12T03:00:00.000Z');
const dueAt = new Date('2026-10-19T14:59:59.000Z');

function candidate(
  applicationId: string,
  status: SubmissionStatus,
): ProgramDocumentChangeRequestCandidate {
  return { milestoneDocumentId: 'document-1', applicationId, status };
}

const previewed = [
  candidate('application-a', SubmissionStatus.SUBMITTED),
  candidate('application-b', SubmissionStatus.CHANGES_REQUESTED),
  candidate('application-c', SubmissionStatus.APPROVED),
];

function programs(
  teams: readonly string[] = [
    'application-a',
    'application-b',
    'application-c',
  ],
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

function writeStore(
  candidates: readonly ProgramDocumentChangeRequestCandidate[] = previewed,
) {
  return {
    lockProgramDocumentIds: jest.fn().mockResolvedValue(['document-1']),
    lockApprovedApplicationIds: jest
      .fn()
      .mockResolvedValue(['application-a', 'application-b', 'application-c']),
    findChangeRequestCandidates: jest.fn().mockResolvedValue(candidates),
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

function repository(
  store: ReturnType<typeof writeStore>,
  preview: readonly ProgramDocumentChangeRequestCandidate[],
) {
  return {
    findChangeRequestCandidates: jest.fn().mockResolvedValue(preview),
    withTransaction: jest.fn(
      (operation: (store: MilestoneDocumentWriteStore) => Promise<unknown>) =>
        operation(store as unknown as MilestoneDocumentWriteStore),
    ),
  };
}

function service(input: {
  readonly store?: ReturnType<typeof writeStore>;
  readonly programs?: jest.Mocked<ProgramArchiveReader>;
  readonly preview?: readonly ProgramDocumentChangeRequestCandidate[];
  readonly allowed?: boolean;
}) {
  const store = input.store ?? writeStore();
  const repo = repository(store, input.preview ?? previewed);
  return {
    store,
    repo,
    service: new ProgramDocumentChangeRequestsService(
      repo as unknown as MilestoneDocumentsRepository,
      input.programs ?? programs(),
      new MilestoneDocumentRulesService(new ProgramRulesService()),
      new MilestoneDocumentSubmissionRepository(new PlatformRepository()),
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
    expectedVersion:
      milestoneDocumentRulesService.changeRequestTargetsVersion(previewed),
    ...overrides,
  };
}

function code(error: unknown): string | undefined {
  return error instanceof DomainException ? error.errorCode.code : undefined;
}

describe('ProgramDocumentChangeRequestsService.targets', () => {
  it('범위 안 서류 제출을 상태별로 세고 지금 대상의 버전을 함께 돌려준다', async () => {
    const { service: subject, repo } = service({});

    await expect(
      subject.targets(programId, { kind: 'PROGRAM' }),
    ).resolves.toEqual({
      counts: {
        SUBMITTED: 1,
        CHANGES_REQUESTED: 1,
        APPROVED: 1,
        REJECTED: 0,
      },
      version:
        milestoneDocumentRulesService.changeRequestTargetsVersion(previewed),
    });
    expect(repo.findChangeRequestCandidates).toHaveBeenCalledWith(programId, [
      'application-a',
      'application-b',
      'application-c',
    ]);
  });

  it('승인된 신청이 없는 팀이면 거절하지 않고 0건으로 센다', async () => {
    const reader = programs([]);
    const { service: subject, repo } = service({
      programs: reader,
      preview: [],
    });

    await expect(
      subject.targets(programId, { kind: 'TEAM', teamId: 'team-x' }),
    ).resolves.toEqual({
      counts: { SUBMITTED: 0, CHANGES_REQUESTED: 0, APPROVED: 0, REJECTED: 0 },
      version: milestoneDocumentRulesService.changeRequestTargetsVersion([]),
    });
    expect(reader.findApprovedTeams.mock.calls).toEqual([
      [programId, 'team-x'],
    ]);
    expect(repo.findChangeRequestCandidates).toHaveBeenCalledWith(
      programId,
      [],
    );
  });

  it('없는 프로그램이면 거절한다', async () => {
    const reader = programs();
    reader.findProgram.mockResolvedValue(null);
    const { service: subject } = service({ programs: reader });

    const error = await subject
      .targets(programId, { kind: 'PROGRAM' })
      .catch((caught: unknown) => caught);

    expect(code(error)).toBe(MilestoneDocumentsErrorCode.PROGRAM_NOT_FOUND);
  });
});

describe('ProgramDocumentChangeRequestsService.requestChanges', () => {
  it('대상마다 보완 요청 판정 이력을 더하고 제출 상태만 보완 요청으로 바꾼다', async () => {
    const store = writeStore();
    const { service: subject } = service({ store });

    await expect(
      subject.requestChanges('staff-1', programId, request(), () => now),
    ).resolves.toEqual({ requestedCount: 2 });

    expect(store.lockProgramDocumentIds).toHaveBeenCalledWith(programId);
    expect(store.findChangeRequestCandidates).toHaveBeenCalledWith({
      documentIds: ['document-1'],
      applicationIds: ['application-a', 'application-b', 'application-c'],
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
    expect(store.updateSubmissionStatus.mock.calls).toEqual([
      ['application-a:document-1', SubmissionStatus.CHANGES_REQUESTED],
      ['application-b:document-1', SubmissionStatus.CHANGES_REQUESTED],
    ]);
  });

  it('서류 행을 잠근 뒤 신청 행을 잠그고 그때의 승인 범위로 대상을 찾는다', async () => {
    const store = writeStore();
    store.lockApprovedApplicationIds.mockResolvedValue(['application-a']);
    const reader = programs();
    const { service: subject } = service({ store, programs: reader });

    await subject
      .requestChanges(
        'staff-1',
        programId,
        request({ scope: { kind: 'TEAM', teamId: 'team-a' } }),
        () => now,
      )
      .catch((caught: unknown) => caught);

    expect(store.lockApprovedApplicationIds).toHaveBeenCalledWith(
      programId,
      'team-a',
    );
    expect(store.findChangeRequestCandidates).toHaveBeenCalledWith({
      documentIds: ['document-1'],
      applicationIds: ['application-a'],
    });
    expect(
      store.lockProgramDocumentIds.mock.invocationCallOrder[0],
    ).toBeLessThan(
      store.lockApprovedApplicationIds.mock.invocationCallOrder[0] ?? 0,
    );
    expect(reader.findApprovedTeams.mock.calls).toEqual([]);
  });

  it('이미 승인·반려한 제출도 포함하면 승인된 제출까지 보완 요청으로 바꾼다', async () => {
    const store = writeStore();
    const { service: subject } = service({ store });

    await expect(
      subject.requestChanges(
        'staff-1',
        programId,
        request({ includeFinalDecisions: true }),
        () => now,
      ),
    ).resolves.toEqual({ requestedCount: 3 });
    expect(store.updateSubmissionStatus).toHaveBeenCalledWith(
      'application-c:document-1',
      SubmissionStatus.CHANGES_REQUESTED,
    );
  });

  it('건수가 같아도 하나가 승인되고 새 제출이 들어와 대상이 바뀌었으면 하나도 바꾸지 않는다', async () => {
    const store = writeStore([
      candidate('application-a', SubmissionStatus.SUBMITTED),
      candidate('application-b', SubmissionStatus.APPROVED),
      candidate('application-c', SubmissionStatus.APPROVED),
      candidate('application-d', SubmissionStatus.SUBMITTED),
    ]);
    const { service: subject } = service({ store });

    const error = await subject
      .requestChanges('staff-1', programId, request(), () => now)
      .catch((caught: unknown) => caught);

    expect(code(error)).toBe(MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED);
    expect(store.createReview).not.toHaveBeenCalled();
    expect(store.updateSubmissionStatus).not.toHaveBeenCalled();
  });

  it('보완 요청 중인 제출을 학생이 다시 내도 대상은 그대로라 보낸다', async () => {
    const store = writeStore([
      candidate('application-a', SubmissionStatus.SUBMITTED),
      candidate('application-b', SubmissionStatus.SUBMITTED),
      candidate('application-c', SubmissionStatus.APPROVED),
    ]);
    const { service: subject } = service({ store });

    await expect(
      subject.requestChanges('staff-1', programId, request(), () => now),
    ).resolves.toEqual({ requestedCount: 2 });
  });

  it('재제출 기한이 지금 이후가 아니면 잠그기 전에 거절한다', async () => {
    const { service: subject, repo } = service({});

    const error = await subject
      .requestChanges(
        'staff-1',
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
});
