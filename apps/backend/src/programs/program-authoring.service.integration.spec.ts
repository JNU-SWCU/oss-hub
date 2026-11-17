import { TEST_READ_LIMIT } from '../../test/test-read-limit.config';
import { createProgramNoticeFetchClient } from '../../test/program-notice-client.fixture';
import { ProgramScheduleService } from './program-schedule.service';
import { ProgramTemplatesService } from './team-application.service';
import {
  SubmissionFileAdmissionService,
  ProgramAuthoringUploadService,
} from './files.service';
import {
  ProgramCoverRepository,
  ProgramAuthoringUploadTransactionRepository,
} from './files.repository';
import { createHash } from 'node:crypto';
import { ProgramTrackType, FileLifecycle } from '@prisma/client';
import {
  ProgramAuthoringValidationError,
  ProgramAuthoringIdempotencyConflictError,
  ProgramAuthoringUploadTokenError,
} from './programs.error';
import {
  ProgramHistoryRepository,
  ProgramAuthoringRepository,
} from './programs.repository';
import { ProgramAuthoringService } from './programs.service';
import {
  AUTHORING_TEST_PREFIX,
  ProgramAuthoringIntegrationHarness,
  authoringDocument,
  authoringMilestone,
  authoringRequest,
} from './program-authoring.integration-support';
import { type ProgramAuthoringDocumentRequest } from './files.config';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { ProgramOrganizersService } from './program-organizers.service';

const programAuthoringService = new ProgramAuthoringService(
  undefined as never,
  undefined as never,
  new HistoryMetadataService(),
  new ProgramScheduleService(),
  new ProgramTemplatesService(),
  new ProgramAuthoringUploadService(
    {} as never,
    {} as never,
    new SubmissionFileAdmissionService(),
    createProgramNoticeFetchClient(),
  ),
  new ProgramAuthoringUploadTransactionRepository(),
  new ProgramOrganizersService(),
);

describe('ProgramAuthoringService integration', () => {
  const harness = new ProgramAuthoringIntegrationHarness();
  const service = new ProgramAuthoringService(
    new ProgramAuthoringRepository(
      harness.prisma,
      new ProgramAuthoringUploadTransactionRepository(),
      new ProgramCoverRepository(
        harness.prisma,
        new ProgramAuthoringUploadTransactionRepository(),
      ),
    ),
    new ProgramHistoryRepository(),
    new HistoryMetadataService(),
    new ProgramScheduleService(),
    new ProgramTemplatesService(),
    new ProgramAuthoringUploadService(
      {} as never,
      {} as never,
      new SubmissionFileAdmissionService(),
      createProgramNoticeFetchClient(),
    ),
    new ProgramAuthoringUploadTransactionRepository(),
    new ProgramOrganizersService(),
  );

  beforeAll(async () => {
    await harness.start();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  afterAll(async () => {
    await harness.stop();
  });

  it('creates a complete ordered graph and replays the same key without another Program', async () => {
    const actor = await harness.createActor('graph');
    const templateId = await harness.seedUpload({
      actorId: actor.id,
      label: 'graph-template',
      realObject: true,
      expiresAt: futureExpiry(),
    });
    const [requiredTemplateId, secondTemplateId, defaultTemplateId] =
      await Promise.all(
        ['graph-required', 'graph-second', 'graph-default'].map((label) =>
          harness.seedUpload({
            actorId: actor.id,
            label,
            realObject: true,
            expiresAt: futureExpiry(),
          }),
        ),
      );
    const optionalTemplate: ProgramAuthoringDocumentRequest = {
      name: 'Optional template',
      required: false,
      templateUploadId: templateId,
    };
    const request = authoringRequest('graph', [
      authoringMilestone('file', [
        authoringDocument('required-file', requiredTemplateId),
        optionalTemplate,
      ]),
      authoringMilestone('second-file', [
        authoringDocument('required-file-2', secondTemplateId),
      ]),
      authoringMilestone('default-item', [
        authoringDocument('default-item', defaultTemplateId),
      ]),
    ]);

    const created = await service.create(actor, 'graph-key', request);
    const replayed = await service.create(actor, 'graph-key', request);

    expect(replayed.id).toBe(created.id);
    const graph = await harness.prisma.program.findUniqueOrThrow({
      where: { id: created.id },
      select: {
        milestones: {
          take: TEST_READ_LIMIT,
          orderBy: { createdAt: 'asc' },
          select: {
            requirements: {
              take: TEST_READ_LIMIT,
              orderBy: { sortOrder: 'asc' },
              select: {
                name: true,
                required: true,
                files: {
                  take: TEST_READ_LIMIT,
                  where: { kind: 'TEMPLATE', lifecycle: 'ATTACHED' },
                },
              },
            },
          },
        },
      },
    });
    expect(
      graph.milestones.map(({ requirements: documents }) => documents.length),
    ).toEqual([2, 1, 1]);
    expect(graph.milestones[0]?.requirements[1]).toMatchObject({
      name: 'Optional template',
      required: false,
      files: [{ originalFileName: 'graph-template.pdf' }],
    });
    await expect(
      harness.prisma.program.count({
        where: { name: `${AUTHORING_TEST_PREFIX}program:graph` },
      }),
    ).resolves.toBe(1);
    const upload = await harness.prisma.file.findUniqueOrThrow({
      where: { kind: 'TEMPLATE', id: templateId },
      select: {
        lifecycle: true,
        requirement: { select: { milestone: { select: { programId: true } } } },
      },
    });
    expect(upload.lifecycle).toBe(FileLifecycle.ATTACHED);
    expect(upload.requirement?.milestone.programId).toBe(created.id);
  });

  it('persists a milestone ending exactly with its program', async () => {
    const actor = await harness.createActor('inclusive-end');
    const input = authoringRequest('inclusive-end', [
      authoringMilestone('boundary', []),
    ]);
    const boundaryMilestone = input.milestones[0];
    if (boundaryMilestone === undefined)
      throw new TypeError('Missing boundary milestone fixture.');

    const program = await service.create(actor, 'inclusive-end-key', {
      ...input,
      milestones: [{ ...boundaryMilestone, dueAt: input.endAt }],
    });

    await expect(
      harness.prisma.milestone.findFirstOrThrow({
        where: { programId: program.id },
        select: { dueAt: true },
      }),
    ).resolves.toEqual({ dueAt: new Date(input.endAt) });
  });

  it.each([
    ['an empty list', [], 'REQUIRED', '주관기관을 1개 이상 입력해 주세요.'],
    [
      'a whitespace-only label',
      ['   '],
      'REQUIRED',
      '주관기관을 1개 이상 입력해 주세요.',
    ],
    [
      'eleven labels',
      Array.from({ length: 11 }, (_, index) => `기관 ${index}`),
      'TOO_MANY',
      '주관기관은 10개까지 입력할 수 있습니다.',
    ],
    [
      'a 51-character label',
      ['가'.repeat(51)],
      'TOO_LONG',
      '주관기관 이름은 50자 이하로 입력해 주세요.',
    ],
  ])(
    'rejects organizers with %s as an organizers field error before any Program exists',
    async (_label, organizers, code, message) => {
      const actor = await harness.createActor(
        `organizers-${code}-${organizers.length}`,
      );
      const request = {
        ...authoringRequest(`organizers-${code}-${organizers.length}`, [
          authoringMilestone('default-item', []),
        ]),
        organizers,
      };

      await expect(
        service.createFromRequest(actor, `organizers-${code}-key`, request),
      ).rejects.toMatchObject({
        name: 'DomainException',
        errorCode: { code: 'PRG_001', status: 400 },
        extensions: { fieldErrors: [{ field: 'organizers', code, message }] },
      });
      await expect(
        harness.prisma.program.count({ where: { name: request.name } }),
      ).resolves.toBe(0);
    },
  );

  it('rejects a changed payload under the same actor idempotency key', async () => {
    const actor = await harness.createActor('conflict');
    const initial = authoringRequest('conflict', [
      authoringMilestone('default-item', []),
    ]);
    await service.create(actor, 'conflict-key', initial);

    await expect(
      service.create(actor, 'conflict-key', {
        ...initial,
        description: 'A distinct canonical payload',
      }),
    ).rejects.toBeInstanceOf(ProgramAuthoringIdempotencyConflictError);
  });

  it('concurrent identical creation requests commit exactly one Program', async () => {
    const actor = await harness.createActor('concurrent-key');
    const input = authoringRequest('concurrent-key', [
      authoringMilestone('one', []),
    ]);

    const [first, second] = await Promise.all([
      service.create(actor, 'concurrent-key', input),
      service.create(actor, 'concurrent-key', input),
    ]);

    expect(second.id).toBe(first.id);
    await expect(
      harness.prisma.program.count({
        where: { createdById: actor.id, idempotencyKey: 'concurrent-key' },
      }),
    ).resolves.toBe(1);
  });

  it('a retry keeps the original identity after the Program is marked deleted', async () => {
    const actor = await harness.createActor('deleted-key');
    const input = authoringRequest('deleted-key', [
      authoringMilestone('one', []),
    ]);
    const original = await service.create(actor, 'deleted-key', input);
    await harness.prisma.program.update({
      where: { id: original.id },
      data: { lifecycle: 'DELETED' },
    });

    await expect(
      service.create(actor, 'deleted-key', input),
    ).resolves.toMatchObject({
      id: original.id,
      lifecycle: 'DELETED',
    });
    await expect(
      harness.prisma.program.count({
        where: { createdById: actor.id, idempotencyKey: 'deleted-key' },
      }),
    ).resolves.toBe(1);
  });

  it('rejects track changes while the original retry still returns exactly one program', async () => {
    const actor = await harness.createActor('track-conflict');
    const initial = authoringRequest('track-conflict', [
      authoringMilestone('default-item', []),
    ]);
    const created = await service.create(actor, 'track-key', initial);

    await expect(
      service.create(actor, 'track-key', {
        ...initial,
        trackType: ProgramTrackType.EXTRACURRICULAR,
      }),
    ).rejects.toMatchObject({ existingProgramId: created.id });
    expect((await service.create(actor, 'track-key', initial)).id).toBe(
      created.id,
    );
    expect(
      await harness.prisma.program.count({
        where: { createdById: actor.id },
      }),
    ).toBe(1);
  });

  it('does not treat an edited current track as evidence of a historical creation input', async () => {
    const actor = await harness.createActor('legacy-track');
    const initial = authoringRequest('legacy-track', [
      authoringMilestone('default-item', []),
    ]);
    const created = await service.create(actor, 'legacy-key', initial);
    const canonical =
      programAuthoringService.toCanonicalProgramAuthoringPayload(
        programAuthoringService.buildProgramAuthoringPlan(initial),
      );
    const { trackType, ...legacyProgram } = canonical.program;
    expect(trackType).toBe(ProgramTrackType.CURRICULAR);
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify({
          ...canonical,
          schemaVersion: 1,
          program: legacyProgram,
        }),
      )
      .digest('hex');
    await harness.prisma.program.update({
      where: { id: created.id },
      data: { payloadHash },
    });
    await harness.prisma.program.update({
      where: { id: created.id },
      data: { trackType: ProgramTrackType.EXTRACURRICULAR },
    });

    await expect(
      service.create(actor, 'legacy-key', {
        ...initial,
        trackType: ProgramTrackType.EXTRACURRICULAR,
      }),
    ).rejects.toMatchObject({ existingProgramId: created.id });
    expect(
      await harness.prisma.program.count({
        where: { createdById: actor.id },
      }),
    ).toBe(1);
  });

  it.each([
    ['foreign', 'NOT_OWNED'],
    ['expired', 'EXPIRED'],
  ] as const)(
    'rejects a %s pending token without persisting a graph',
    async (kind, reason) => {
      const actor = await harness.createActor(`token-${kind}`);
      const owner =
        kind === 'foreign' ? await harness.createActor('other-owner') : actor;
      const tokenId = await harness.seedUpload({
        actorId: owner.id,
        label: `token-${kind}`,
        expiresAt: kind === 'expired' ? new Date(0) : futureExpiry(),
      });

      await expect(
        service.create(
          actor,
          `token-${kind}-key`,
          requestWithTemplate(`token-${kind}`, tokenId),
        ),
      ).rejects.toMatchObject<Partial<ProgramAuthoringUploadTokenError>>({
        reason,
      });
      await expect(
        harness.prisma.program.count({
          where: { name: `${AUTHORING_TEST_PREFIX}program:token-${kind}` },
        }),
      ).resolves.toBe(0);
    },
  );

  it('rejects duplicate and replayed upload tokens before a partial graph exists', async () => {
    const actor = await harness.createActor('replayed');
    const tokenId = await harness.seedUpload({
      actorId: actor.id,
      label: 'replayed',
      expiresAt: futureExpiry(),
    });
    const initial = requestWithTemplate('replayed-first', tokenId);
    await service.create(actor, 'replayed-first-key', initial);
    const duplicate = authoringRequest('duplicate', [
      authoringMilestone('duplicate', [
        authoringDocument('first', tokenId),
        authoringDocument('second', tokenId),
      ]),
    ]);

    await expect(
      service.create(
        actor,
        'replayed-second-key',
        requestWithTemplate('replayed-second', tokenId),
      ),
    ).rejects.toMatchObject<Partial<ProgramAuthoringUploadTokenError>>({
      reason: 'NOT_PENDING',
    });
    await expect(
      service.create(actor, 'duplicate-key', duplicate),
    ).rejects.toBeInstanceOf(ProgramAuthoringValidationError);
    await expect(
      harness.prisma.program.count({
        where: {
          name: {
            in: [
              `${AUTHORING_TEST_PREFIX}program:replayed-second`,
              `${AUTHORING_TEST_PREFIX}program:duplicate`,
            ],
          },
        },
      }),
    ).resolves.toBe(0);
  });

  it('deletes an expired object through the leased maintenance transition', async () => {
    const actor = await harness.createActor('cleanup');
    const uploadId = await harness.seedUpload({
      actorId: actor.id,
      label: 'cleanup',
      realObject: true,
      expiresAt: new Date(0),
    });
    const before = await harness.prisma.file.findUniqueOrThrow({
      where: { kind: 'UPLOAD', id: uploadId },
      select: { storageKey: true },
    });

    await expect(harness.maintenance.runDue()).resolves.toBe(1);

    await expect(harness.objectExists(before.storageKey)).resolves.toBe(false);
    const deleted = await harness.prisma.file.findUniqueOrThrow({
      where: { kind: 'UPLOAD', id: uploadId },
      select: {
        lifecycle: true,
        deletedAt: true,
        deleteClaimOwner: true,
        nextDeleteAttemptAt: true,
      },
    });
    expect(deleted.lifecycle).toBe(FileLifecycle.DELETED);
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.deleteClaimOwner).toBeNull();
    expect(deleted.nextDeleteAttemptAt).toBeNull();
  });
});

function requestWithTemplate(label: string, templateUploadId: string) {
  return authoringRequest(label, [
    authoringMilestone('file', [
      authoringDocument('template', templateUploadId),
    ]),
  ]);
}

function futureExpiry(): Date {
  return new Date(Date.now() + 24 * 60 * 60 * 1_000);
}
