import { SubmissionStatus } from '@prisma/client';
import type { SubmissionMatrixQuery } from './domain/submission-matrix';
import { SubmissionMatrixService } from './submission-matrix.service';

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
    applicationIds: readonly string[];
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
      Promise.resolve([
        {
          id: 'legacy-review',
          applicationId: 'application',
          milestoneId: 'stage',
          currentRevision: 3,
          status: SubmissionStatus.REJECTED,
          submittedAt: afterDue,
        },
      ]),
    findDocumentFirstSubmissions: (
      applicationIds: readonly string[],
      requiredIds: readonly string[],
    ) => {
      calls.push({ applicationIds, documentIds: requiredIds });
      return Promise.resolve(
        firstTimes.flatMap((firstSubmittedAt, index) =>
          firstSubmittedAt === null
            ? []
            : [
                {
                  applicationId: 'application',
                  milestoneDocumentId: `required-${index}`,
                  firstSubmittedAt,
                },
              ],
        ),
      );
    },
  };
  return {
    service: new SubmissionMatrixService(repository),
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
    // Given
    const { service } = setup(times);
    // When
    const result = await service.matrix(1136n, 'program', query);
    // Then
    expect(result.rows[0]?.cells[0]).toMatchObject({
      deliveryStatus: status,
      status: 'REJECTED',
      revision: 3,
      submittedAt: afterDue.toISOString(),
      submissionId: 'legacy-review',
      reviewUrl: '/programs/program/submissions/legacy-review/review',
    });
  },
);

it('does not treat another application or unrelated document as a required submission', async () => {
  // Given
  const { service, repository } = setup([null]);
  repository.findDocumentFirstSubmissions = () =>
    Promise.resolve([
      {
        applicationId: 'other-application',
        milestoneDocumentId: 'required-0',
        firstSubmittedAt: onTime,
      },
      {
        applicationId: 'application',
        milestoneDocumentId: 'optional-or-other-stage',
        firstSubmittedAt: onTime,
      },
    ]);
  // When
  const result = await service.matrix(1136n, 'program', query);
  // Then
  expect(result.rows[0]?.cells[0]).toMatchObject({ deliveryStatus: 'MISSING' });
});

it('reads first-submission coordinates once for only the selected page and required items', async () => {
  // Given
  const { service, calls } = setup([onTime, dueAt]);
  // When
  await service.matrix(1136n, 'program', query);
  // Then
  expect(calls).toEqual([
    {
      applicationIds: ['application'],
      documentIds: ['required-0', 'required-1'],
    },
  ]);
});
