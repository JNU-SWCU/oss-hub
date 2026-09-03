import { ProgramCategory, ProgramTrackType } from '@prisma/client';
import {
  ProgramAuthoringValidationError,
  type ProgramAuthoringDocumentRequest,
  type ProgramAuthoringMilestoneRequest,
  type ProgramAuthoringRequest,
} from './program-authoring.types';
import { buildProgramAuthoringPlan } from './program-authoring-plan';

function request(): ProgramAuthoringRequest {
  return {
    name: '  Synthetic Program  ',
    organizer: '  Synthetic Organizer  ',
    trackType: ProgramTrackType.EXTRACURRICULAR,
    applicationStartAt: '2026-08-01T09:00:00+09:00',
    applicationEndAt: '2026-08-10T09:00:00+09:00',
    startAt: '2026-08-10T09:00:00+09:00',
    endAt: '2026-09-01T09:00:00+09:00',
    description: '  Synthetic description  ',
    milestones: [
      {
        name: '  Planning  ',
        dueAt: '2026-08-20T09:00:00+09:00',
        instructions: '  Submit once  ',
        documents: [
          {
            name: '  Plan.pdf  ',
            required: true,
            templateUploadId: ' upload-plan ',
          },
          {
            name: ' Summary.docx ',
            required: false,
            templateUploadId: ' upload-summary ',
          },
        ],
      },
      {
        name: ' Demo ',
        startAt: '2026-08-21T09:00:00+09:00',
        dueAt: '2026-08-30T09:00:00+09:00',
        documents: [
          {
            name: ' Demo.mov ',
            required: true,
            templateUploadId: ' upload-demo ',
          },
        ],
      },
    ],
  };
}

function milestoneAt(
  input: ProgramAuthoringRequest,
  index: number,
): ProgramAuthoringMilestoneRequest {
  const milestone = input.milestones[index];
  if (milestone === undefined)
    throw new TypeError('Missing milestone fixture.');
  return milestone;
}

function documentAt(
  milestone: ProgramAuthoringMilestoneRequest,
  index: number,
): ProgramAuthoringDocumentRequest {
  const document = milestone.documents[index];
  if (document === undefined) throw new TypeError('Missing document fixture.');
  return document;
}

function expectValidationCodes(
  input: ProgramAuthoringRequest,
  codes: readonly string[],
): void {
  try {
    buildProgramAuthoringPlan(input);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ProgramAuthoringValidationError);
    if (!(error instanceof ProgramAuthoringValidationError)) throw error;
    const actualCodes = error.issues.map((issue) => issue.code);
    for (const code of codes) expect(actualCodes).toContain(code);
    return;
  }
  throw new Error('Expected ProgramAuthoringValidationError.');
}

describe('buildProgramAuthoringPlan', () => {
  it('normalizes attachment filenames and preserves their required values', () => {
    // Given: request strings, offsets, and optional fields are not canonical.
    const input = request();

    // When: the request becomes the typed persistence plan.
    const plan = buildProgramAuthoringPlan(input);

    // Then: values are canonical while caller order remains intact.
    expect(plan.program).toMatchObject({
      name: 'Synthetic Program',
      organizer: 'Synthetic Organizer',
      trackType: ProgramTrackType.EXTRACURRICULAR,
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-10T00:00:00.000Z'),
      startAt: new Date('2026-08-10T00:00:00.000Z'),
      endAt: new Date('2026-09-01T00:00:00.000Z'),
      teamMinSize: 1,
      teamMaxSize: 1,
      repositoryProvisioningEnabled: false,
      // 저장소 발급은 생략하면 꺼지고, 마감 알림은 생략하면 켜진다 — 알림을 끄는
      // 쪽만 명시적 선택이어야 하기 때문이다(program-authoring-plan.ts).
      notifyOnDeadline: true,
      description: 'Synthetic description',
    });
    expect(plan.milestones.map((milestone) => milestone.name)).toEqual([
      'Planning',
      'Demo',
    ]);
    expect(
      plan.milestones[0]?.documents.map((document) => ({
        name: document.name,
        required: document.required,
        sortOrder: document.sortOrder,
        token: document.templateUploadId,
      })),
    ).toEqual([
      {
        name: 'Plan.pdf',
        required: true,
        sortOrder: 1,
        token: 'upload-plan',
      },
      {
        name: 'Summary.docx',
        required: false,
        sortOrder: 2,
        token: 'upload-summary',
      },
    ]);
    expect(plan.uploadTokenIds).toEqual([
      'upload-demo',
      'upload-plan',
      'upload-summary',
    ]);
  });

  it('accepts an announcement-only milestone', () => {
    const input: ProgramAuthoringRequest = {
      ...request(),
      milestones: [
        {
          ...milestoneAt(request(), 0),
          documents: [],
        },
      ],
    };

    expect(buildProgramAuthoringPlan(input).milestones[0]?.documents).toEqual(
      [],
    );
  });

  it('requires at least one milestone without repository provisioning', () => {
    expectValidationCodes(
      {
        ...request(),
        milestones: [],
      },
      ['MILESTONE_REQUIRED'],
    );
  });

  it('accepts an application period that partially overlaps operations', () => {
    const input: ProgramAuthoringRequest = {
      ...request(),
      applicationEndAt: '2026-08-15T09:00:00+09:00',
      startAt: '2026-08-10T09:00:00+09:00',
    };

    expect(buildProgramAuthoringPlan(input).program).toMatchObject({
      applicationEndAt: new Date('2026-08-15T00:00:00.000Z'),
      startAt: new Date('2026-08-10T00:00:00.000Z'),
    });
  });

  it('rejects an application period ending after operations', () => {
    const input: ProgramAuthoringRequest = {
      ...request(),
      applicationEndAt: '2026-09-02T09:00:00+09:00',
    };

    expectValidationCodes(input, ['INVALID_APPLICATION_SCHEDULE']);
  });

  it.each<readonly [string, Partial<ProgramAuthoringRequest>, string]>([
    [
      'a reversed application period',
      {
        applicationStartAt: '2026-08-11T09:00:00+09:00',
        applicationEndAt: '2026-08-10T09:00:00+09:00',
      },
      'INVALID_APPLICATION_SCHEDULE',
    ],
    [
      'a non-increasing operation period',
      {
        startAt: '2026-09-01T09:00:00+09:00',
      },
      'INVALID_PROGRAM_SCHEDULE',
    ],
  ])('rejects %s', (_case, override, code) => {
    expectValidationCodes({ ...request(), ...override }, [code]);
  });

  it.each<readonly [string, Partial<ProgramAuthoringRequest>, string]>([
    [
      'more than 50 milestones',
      {
        milestones: Array.from({ length: 51 }, () => milestoneAt(request(), 0)),
      },
      'MILESTONE_LIMIT_EXCEEDED',
    ],
    [
      'more than 20 documents in one milestone',
      {
        milestones: [
          {
            ...milestoneAt(request(), 0),
            documents: Array.from({ length: 21 }, () =>
              documentAt(milestoneAt(request(), 0), 1),
            ),
          },
        ],
      },
      'DOCUMENT_LIMIT_EXCEEDED',
    ],
    [
      'more than 100 total documents',
      {
        milestones: Array.from({ length: 6 }, () => ({
          ...milestoneAt(request(), 0),
          documents: Array.from({ length: 20 }, () =>
            documentAt(milestoneAt(request(), 0), 1),
          ),
        })),
      },
      'TOTAL_DOCUMENT_LIMIT_EXCEEDED',
    ],
  ])('rejects %s before persistence', (_case, override, code) => {
    // Given: one aggregate limit is exceeded.
    const input = { ...request(), ...override };

    // When / Then: the typed validation error identifies the violated limit.
    expectValidationCodes(input, [code]);
  });

  it.each<readonly [string, ProgramAuthoringDocumentRequest, string]>([
    [
      'a duplicate upload token',
      {
        ...documentAt(milestoneAt(request(), 0), 1),
        templateUploadId: 'upload-plan',
      },
      'DUPLICATE_UPLOAD_TOKEN',
    ],
  ])('rejects %s', (_case, secondDocument, code) => {
    // Given: document rules are violated inside one milestone.
    const firstMilestone = milestoneAt(request(), 0);
    const input: ProgramAuthoringRequest = {
      ...request(),
      milestones: [
        {
          ...firstMilestone,
          documents: [documentAt(firstMilestone, 0), secondDocument],
        },
      ],
    };

    // When / Then: invalid document plans never reach persistence.
    expectValidationCodes(input, [code]);
  });

  it('rejects a declared document without an upload token', () => {
    const firstMilestone = milestoneAt(request(), 0);
    const input: ProgramAuthoringRequest = {
      ...request(),
      milestones: [
        {
          ...firstMilestone,
          documents: [
            {
              ...documentAt(firstMilestone, 0),
              templateUploadId: '   ',
            },
          ],
        },
      ],
    };

    expectValidationCodes(input, ['REQUIRED']);
  });

  it('rejects an out-of-window milestone and reversed team range together', () => {
    // Given: all schedule and team checks can be evaluated without a transaction.
    const input: ProgramAuthoringRequest = {
      ...request(),
      teamMinSize: 4,
      teamMaxSize: 2,
      milestones: [
        {
          ...milestoneAt(request(), 0),
          dueAt: '2026-09-02T00:00:00.000Z',
        },
      ],
    };

    // When / Then: both independent violations are reported in one typed error.
    expectValidationCodes(input, [
      'INVALID_TEAM_RANGE',
      'INVALID_MILESTONE_SCHEDULE',
    ]);
  });

  it('accepts a milestone ending exactly with the operation period', () => {
    const input: ProgramAuthoringRequest = {
      ...request(),
      milestones: [
        {
          ...milestoneAt(request(), 0),
          dueAt: request().endAt,
        },
      ],
    };

    expect(() => buildProgramAuthoringPlan(input)).not.toThrow();
  });
});
