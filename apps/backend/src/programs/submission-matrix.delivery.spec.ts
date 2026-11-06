import { MilestoneCompletionService } from './submissions.service';
import { RequirementCollectionService } from './requirement-archive.service';
import { SubmissionMatrixResponseDto } from './dto/submission-matrix-response.dto';
import { SubmissionStatus } from '@prisma/client';
import {
  SubmissionMatrixService,
  type SubmissionMatrixQuery,
} from './submission-matrix.service';

const dueAt = new Date('2026-09-10T12:00:00Z');
const onTime = new Date('2026-09-10T11:00:00Z');
const afterDue = new Date('2026-09-10T12:00:00.001Z');
const query: SubmissionMatrixQuery = {
  q: '',
  applicationMode: null,
  page: 1,
  pageSize: 20,
};

function setup(firstTimes: readonly (Date | null)[]) {
  const documentIds = firstTimes.map((_, index) => `required-${index}`);
  const calls: Array<{
    teamIds: readonly string[];
    documentIds: readonly string[];
  }> = [];
  const repository = {
    findActiveStaffOrAdmin: () => Promise.resolve({ id: 'synthetic-staff' }),
    programExists: () => Promise.resolve(true),
    findMilestones: () =>
      Promise.resolve([
        {
          id: 'stage',
          name: '합성 계획서',
          dueAt,
          requiredDocumentIds: documentIds,
        },
      ]),
    findApprovedApplications: () =>
      Promise.resolve({
        items: [
          {
            id: 'application',
            applicant: { name: null, nickname: 'synthetic-student' },
            team: null,
          },
        ],
        total: 1,
      }),
    findCurrentSubmissions: () =>
      Promise.resolve(
        firstTimes.flatMap((time, index) =>
          time === null
            ? []
            : [
                {
                  id: `submission-${index}`,
                  requirementId: `required-${index}`,
                  teamId: 'application',
                  milestoneId: 'stage',
                  currentRevision: 3,
                  status: SubmissionStatus.REJECTED,
                  submittedAt: afterDue,
                },
              ],
        ),
      ),
    findDocumentChangeRequests: () => Promise.resolve([]),
    findDocumentFirstSubmissions: (
      teamIds: readonly string[],
      requiredIds: readonly string[],
    ) => {
      calls.push({ teamIds, documentIds: requiredIds });
      return Promise.resolve(
        firstTimes.flatMap((firstSubmittedAt, index) =>
          firstSubmittedAt === null
            ? []
            : [
                {
                  teamId: 'application',
                  requirementId: `required-${index}`,
                  firstSubmittedAt,
                },
              ],
        ),
      );
    },
  };
  return {
    service: new SubmissionMatrixService(
      repository,
      new RequirementCollectionService({} as never),
      new MilestoneCompletionService(),
    ),
    repository,
    calls,
  };
}

it.each([
  [
    'on-time first submissions despite rejected late revision',
    [onTime, dueAt],
    'COMPLETE',
  ],
  ['first submission after the exact deadline', [afterDue], 'LATE'],
  [
    'one missing required item even when another is late',
    [afterDue, null],
    'MISSING',
  ],
  ['all required items missing', [null, null], 'MISSING'],
  ['no required items', [], 'NO_REQUIRED_ITEMS'],
] as const)(
  'classifies %s independently from review state',
  async (_, times, status) => {
    const { service } = setup(times);

    const result = SubmissionMatrixResponseDto.from(
      await service.matrix('program', query),
      'program',
    );

    expect(result.rows[0]?.cells[0]).toMatchObject({
      deliveryStatus: status,
      status: times.some((time) => time !== null)
        ? 'REJECTED'
        : 'NOT_SUBMITTED',
      revision: times.length === 1 && times[0] !== null ? 3 : null,
      submittedAt:
        times.length === 1 && times[0] !== null ? afterDue.toISOString() : null,
      submissionId:
        times.length === 1 && times[0] !== null ? 'submission-0' : null,
      reviewUrl:
        times.length === 1 && times[0] !== null
          ? '/programs/program/submissions/submission-0/review'
          : null,
    });
  },
);

it('does not treat another application or unrelated document as a required submission', async () => {
  const { service, repository } = setup([null]);
  repository.findDocumentFirstSubmissions = () =>
    Promise.resolve([
      {
        teamId: 'other-application',
        requirementId: 'required-0',
        firstSubmittedAt: onTime,
      },
      {
        teamId: 'application',
        requirementId: 'optional-or-other-stage',
        firstSubmittedAt: onTime,
      },
    ]);

  const result = SubmissionMatrixResponseDto.from(
    await service.matrix('program', query),
    'program',
  );

  expect(result.rows[0]?.cells[0]).toMatchObject({ deliveryStatus: 'MISSING' });
});

it('reads first-submission coordinates once for only the selected page and required items', async () => {
  const { service, calls } = setup([onTime, dueAt]);

  await service.matrix('program', query);

  expect(calls).toEqual([
    {
      teamIds: ['application'],
      documentIds: ['required-0', 'required-1'],
    },
  ]);
});
