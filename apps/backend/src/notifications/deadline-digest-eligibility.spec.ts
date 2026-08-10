import { AccountStatus } from '@prisma/client';
import {
  buildDeadlineEligibility,
  deadlineWindow,
  type DeadlineProgramSource,
  type DeadlineRecipientSource,
} from './deadline-digest-eligibility';

const NOW = new Date('2026-08-14T00:00:00.000Z');

function user(
  id: string,
  input: Partial<DeadlineRecipientSource> = {},
): DeadlineRecipientSource {
  return {
    id,
    nickname: `nickname-${id}`,
    notificationEmail: `${id}@example.com`,
    notifyEnabled: true,
    accountStatus: AccountStatus.ACTIVE,
    ...input,
  };
}

function source(): DeadlineProgramSource {
  const applicant = user('applicant');
  return {
    id: 'program-1',
    name: '합성 프로그램',
    notifyOnDeadline: true,
    milestones: [
      {
        id: 'before',
        name: '이미 지난 마감',
        dueAt: new Date(NOW.getTime() - 1),
        documents: [{ id: 'before-required', required: true }],
      },
      {
        id: 'at-now',
        name: '현재 마감',
        dueAt: NOW,
        documents: [
          { id: 'required-now', required: true },
          { id: 'optional-now', required: false },
        ],
      },
      {
        id: 'at-end',
        name: '24시간 경계 마감',
        dueAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
        documents: [{ id: 'required-end', required: true }],
      },
      {
        id: 'after',
        name: '경계 밖 마감',
        dueAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + 1),
        documents: [{ id: 'after-required', required: true }],
      },
      {
        id: 'optional-only',
        name: '선택 서류만 있는 마감',
        dueAt: new Date(NOW.getTime() + 60_000),
        documents: [{ id: 'optional', required: false }],
      },
      {
        id: 'informational',
        name: '안내용 마감',
        dueAt: new Date(NOW.getTime() + 120_000),
        documents: [],
      },
    ],
    applications: [
      {
        id: 'application-1',
        applicant,
        members: [user('member-2'), applicant, user('member-1')],
        submittedDocumentIds: ['required-now'],
      },
    ],
  };
}

describe('deadline digest eligibility', () => {
  it('uses the exact inclusive now through 24-hour window and ignores optional or informational documents', () => {
    // Given
    const window = deadlineWindow(NOW);

    // When
    const eligibility = buildDeadlineEligibility(source(), window);

    // Then
    expect(window.to).toEqual(new Date(NOW.getTime() + 24 * 60 * 60 * 1000));
    expect(eligibility.milestones.map((milestone) => milestone.id)).toEqual([
      'at-now',
      'at-end',
    ]);
    expect(eligibility.applicationCount).toBe(1);
    expect(eligibility.recipients.map((recipient) => recipient.id)).toEqual([
      'applicant',
      'member-1',
      'member-2',
    ]);
    expect(
      eligibility.recipients.every(
        (recipient) => recipient.milestones[0]?.id === 'at-end',
      ),
    ).toBe(true);
  });

  it('counts inactive, opted-out, and no-email recipients separately before selecting direct mail recipients', () => {
    // Given
    const input = source();
    const application = input.applications[0];
    if (application === undefined) throw new TypeError('Missing application.');
    const classified: DeadlineProgramSource = {
      ...input,
      applications: [
        {
          ...application,
          members: [
            user('deliverable'),
            user('inactive', {
              accountStatus: AccountStatus.DEACTIVATED,
              notifyEnabled: false,
              notificationEmail: null,
            }),
            user('opted-out', {
              notifyEnabled: false,
              notificationEmail: null,
            }),
            user('no-email', { notificationEmail: null }),
          ],
        },
      ],
    };

    // When
    const eligibility = buildDeadlineEligibility(
      classified,
      deadlineWindow(NOW),
    );

    // Then
    expect(eligibility.summary).toEqual({
      applicationCount: 1,
      milestoneCount: 2,
      recipientCount: 2,
      inactiveCount: 1,
      optedOutCount: 1,
      noEmailCount: 1,
    });
  });

  it('selects one adopted-fixture recipient before the required submission and none after it', () => {
    // Given
    const requiredDocumentId = 'e2e:program-authoring:required-document';
    const fixture: DeadlineProgramSource = {
      id: 'e2e:program-authoring:happy-program',
      name: 'E2E authoring program',
      notifyOnDeadline: true,
      milestones: [
        {
          id: 'e2e:program-authoring:required-milestone',
          name: 'E2E required milestone',
          dueAt: new Date('2026-08-20T09:00:00.000Z'),
          documents: [{ id: requiredDocumentId, required: true }],
        },
      ],
      applications: [
        {
          id: 'e2e:program-authoring:student-application',
          applicant: user('e2e-student', {
            notificationEmail: 'e2e-program-authoring-student@fixture.invalid',
          }),
          members: [],
          submittedDocumentIds: [],
        },
      ],
    };
    const application = fixture.applications[0];
    if (application === undefined) {
      throw new TypeError('Missing adopted-fixture application.');
    }

    // When
    const beforeSubmission = buildDeadlineEligibility(
      fixture,
      deadlineWindow(new Date('2026-08-20T00:00:00.000Z')),
    );
    const afterSubmission = buildDeadlineEligibility(
      {
        ...fixture,
        applications: [
          {
            ...application,
            submittedDocumentIds: [requiredDocumentId],
          },
        ],
      },
      deadlineWindow(new Date('2026-08-20T00:00:00.000Z')),
    );

    // Then
    expect(beforeSubmission.summary).toMatchObject({
      applicationCount: 1,
      milestoneCount: 1,
      recipientCount: 1,
    });
    expect(afterSubmission.summary).toMatchObject({
      applicationCount: 0,
      milestoneCount: 1,
      recipientCount: 0,
    });
  });

  it('produces the same SHA-256 preview version regardless of duplicate source ordering and changes it for eligibility IDs or deadlines', () => {
    // Given
    const original = source();
    const reordered: DeadlineProgramSource = {
      ...original,
      milestones: [...original.milestones].reverse(),
      applications: original.applications.map((application) => ({
        ...application,
        members: [...application.members, ...application.members].reverse(),
        submittedDocumentIds: [...application.submittedDocumentIds].reverse(),
      })),
    };
    const changed: DeadlineProgramSource = {
      ...original,
      milestones: original.milestones.map((milestone) =>
        milestone.id === 'at-end'
          ? { ...milestone, dueAt: new Date(milestone.dueAt.getTime() - 1) }
          : milestone,
      ),
    };

    // When
    const first = buildDeadlineEligibility(original, deadlineWindow(NOW));
    const duplicateOrdered = buildDeadlineEligibility(
      reordered,
      deadlineWindow(NOW),
    );
    const changedEligibility = buildDeadlineEligibility(
      changed,
      deadlineWindow(NOW),
    );

    // Then
    expect(first.previewVersion).toMatch(/^[a-f0-9]{64}$/u);
    expect(duplicateOrdered.previewVersion).toBe(first.previewVersion);
    expect(changedEligibility.previewVersion).not.toBe(first.previewVersion);
  });
});
