import { ProgramTrackType } from '@prisma/client';
import { buildProgramAuthoringPlan } from '../programs/program-authoring-plan';
import { E2eAdapterError } from './e2e-program-authoring.adapter-error';
import {
  adoptPersistedE2eProgramGraph,
  inspectE2eProgramAdoption,
  type E2eProgramAdoptionCandidate,
} from './e2e-program-authoring-graph-adoption';

const PREFIX = 'e2e:program-authoring:';
const PROGRAM_ID = 'generated-program-id';
const AUTHOR_GITHUB_ID = 9_600_000_000_000_001n;

type PersistedAuthoredCandidate = E2eProgramAdoptionCandidate & {
  readonly organizer: string;
  readonly description: string;
};

function authoredCandidate(): PersistedAuthoredCandidate {
  const plan = buildProgramAuthoringPlan({
    name: `${PREFIX}happy-program`,
    organizer: `${PREFIX}organizer`,
    trackType: ProgramTrackType.EXTRACURRICULAR,
    applicationStartAt: '2026-08-19T00:00:00.000Z',
    applicationEndAt: '2026-08-20T00:00:00.000Z',
    startAt: '2026-08-20T00:00:00.000Z',
    endAt: '2026-08-30T09:00:00.000Z',
    teamMinSize: 1,
    teamMaxSize: 1,
    description: `${PREFIX}description`,
    repositoryProvisioningEnabled: true,
    notifyOnDeadline: true,
    milestones: [
      {
        name: `${PREFIX}information-milestone`,
        startAt: '2026-08-20T01:00:00.000Z',
        dueAt: '2026-08-20T02:00:00.000Z',
        documents: [],
      },
      {
        name: `${PREFIX}required-milestone`,
        startAt: '2026-08-20T02:00:00.000Z',
        dueAt: '2026-08-20T09:00:00.000Z',
        documents: [
          {
            name: `${PREFIX}information-document.pdf`,
            required: false,
            templateUploadId: 'upload-information',
          },
          {
            name: `${PREFIX}required-document.pdf`,
            required: true,
            templateUploadId: 'upload-required',
          },
        ],
      },
    ],
  });
  return {
    id: PROGRAM_ID,
    name: plan.program.name,
    organizer: plan.program.organizer,
    description: plan.program.description,
    createRequest: { actor: { githubId: AUTHOR_GITHUB_ID } },
    milestones: plan.milestones.map((milestone, milestoneIndex) => ({
      id: `milestone-${milestoneIndex}`,
      name: milestone.name,
      submissionType: milestone.submissionType,
      documents: milestone.documents.map((document, documentIndex) => ({
        id: `document-${milestoneIndex}-${documentIndex}`,
        name: document.name,
        required: document.required,
      })),
    })),
  };
}

describe('adoptPersistedE2eProgramGraph', () => {
  it('accepts the exact persisted shape produced by the UI authoring aggregate', () => {
    const candidate = authoredCandidate();

    expect(
      inspectE2eProgramAdoption(
        candidate,
        PROGRAM_ID,
        AUTHOR_GITHUB_ID,
        PREFIX,
      ),
    ).toEqual({
      exactProgramId: true,
      exactProgramMarker: true,
      authenticatedActor: true,
      exactMilestoneCount: true,
      requiredFileDocument: true,
    });
    expect(
      adoptPersistedE2eProgramGraph(
        candidate,
        PROGRAM_ID,
        AUTHOR_GITHUB_ID,
        PREFIX,
      ),
    ).toEqual({
      programId: PROGRAM_ID,
      milestoneId: 'milestone-1',
      documentId: 'document-1-1',
    });
  });

  it('treats organizer and description as authored content rather than graph markers', () => {
    const candidate = {
      ...authoredCandidate(),
      organizer: 'Synthetic organizer',
      description: 'Synthetic description',
    };

    expect(
      inspectE2eProgramAdoption(candidate, PROGRAM_ID, AUTHOR_GITHUB_ID, PREFIX)
        .exactProgramMarker,
    ).toBe(true);
    expect(() =>
      adoptPersistedE2eProgramGraph(
        candidate,
        PROGRAM_ID,
        AUTHOR_GITHUB_ID,
        PREFIX,
      ),
    ).not.toThrow();
  });

  it.each([
    {
      predicate: 'exactProgramId',
      change: (candidate: E2eProgramAdoptionCandidate) => ({
        ...candidate,
        id: 'different-generated-program-id',
      }),
    },
    {
      predicate: 'exactProgramMarker',
      change: (candidate: E2eProgramAdoptionCandidate) => ({
        ...candidate,
        name: `${PREFIX}another-program`,
      }),
    },
    {
      predicate: 'authenticatedActor',
      change: (candidate: E2eProgramAdoptionCandidate) => ({
        ...candidate,
        createRequest: { actor: { githubId: AUTHOR_GITHUB_ID + 1n } },
      }),
    },
    {
      predicate: 'exactMilestoneCount',
      change: (candidate: E2eProgramAdoptionCandidate) => ({
        ...candidate,
        milestones: candidate.milestones.slice(1),
      }),
    },
    {
      predicate: 'requiredFileDocument',
      change: (candidate: E2eProgramAdoptionCandidate) => ({
        ...candidate,
        milestones: candidate.milestones.map((milestone) => ({
          ...milestone,
          documents: milestone.documents.map((document) => ({
            ...document,
            required: false,
          })),
        })),
      }),
    },
  ] as const)(
    'rejects the graph when the $predicate predicate is false',
    ({ predicate, change }) => {
      const candidate = change(authoredCandidate());
      const predicates = inspectE2eProgramAdoption(
        candidate,
        PROGRAM_ID,
        AUTHOR_GITHUB_ID,
        PREFIX,
      );

      expect(predicates[predicate]).toBe(false);
      expect(() =>
        adoptPersistedE2eProgramGraph(
          candidate,
          PROGRAM_ID,
          AUTHOR_GITHUB_ID,
          PREFIX,
        ),
      ).toThrow(E2eAdapterError);
    },
  );
});
