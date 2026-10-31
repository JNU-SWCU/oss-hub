import { createHash } from 'node:crypto';
import {
  ProgramTrackType,
  ProgramAuthoringUploadLifecycle,
} from '@prisma/client';
import { ProgramAuthoringValidationError } from './program-authoring-validation.error';
import type { AuditLogService } from '../platform/audit-log.service';
import { ProgramAuthoringRepository } from './program-authoring.repository';
import { ProgramAuthoringService } from './program-authoring.service';
import {
  AUTHORING_TEST_PREFIX,
  ProgramAuthoringIntegrationHarness,
  authoringDocument,
  authoringMilestone,
  authoringRequest,
} from './program-authoring.integration-support';
import {
  ProgramAuthoringIdempotencyConflictError,
  ProgramAuthoringUploadTokenError,
} from './program-authoring.error';
import { type ProgramAuthoringDocumentRequest } from './program-authoring-upload-transaction.repository';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { ProgramRulesService } from './program-rules.service';
import { ProgramUploadRulesService } from './program-upload-rules.service';
import { SubmissionFileRulesService } from './submission-file-rules.service';

const programAuthoringService = new ProgramAuthoringService(
  undefined as never,
  undefined as never,
  new AuditLogMetadataService(),
  new ProgramRulesService(),
  new ProgramUploadRulesService(new SubmissionFileRulesService()),
);

describe('ProgramAuthoringService integration', () => {
  const harness = new ProgramAuthoringIntegrationHarness();
  const service = new ProgramAuthoringService(
    new ProgramAuthoringRepository(harness.prisma),
    { record: jest.fn() } as unknown as AuditLogService,
    new AuditLogMetadataService(),
    new ProgramRulesService(),
    new ProgramUploadRulesService(new SubmissionFileRulesService()),
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
          orderBy: { createdAt: 'asc' },
          select: {
            documents: {
              orderBy: { sortOrder: 'asc' },
              select: {
                name: true,
                required: true,
                templateFile: true,
              },
            },
          },
        },
      },
    });
    expect(graph.milestones.map(({ documents }) => documents.length)).toEqual([
      2, 1, 1,
    ]);
    expect(graph.milestones[0]?.documents[1]).toMatchObject({
      name: 'Optional template',
      required: false,
      templateFile: { originalFileName: 'graph-template.pdf' },
    });
    await expect(
      harness.prisma.program.count({
        where: { name: `${AUTHORING_TEST_PREFIX}program:graph` },
      }),
    ).resolves.toBe(1);
    const upload =
      await harness.prisma.programAuthoringUpload.findUniqueOrThrow({
        where: { id: templateId },
        select: { lifecycle: true, createRequestId: true },
      });
    expect(upload.lifecycle).toBe(ProgramAuthoringUploadLifecycle.ATTACHED);
    expect(typeof upload.createRequestId).toBe('string');
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
      await harness.prisma.programCreateRequest.count({
        where: { actorId: actor.id },
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
    await harness.prisma.programCreateRequest.update({
      where: {
        actorId_idempotencyKey: {
          actorId: actor.id,
          idempotencyKey: 'legacy-key',
        },
      },
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
      await harness.prisma.programCreateRequest.count({
        where: { actorId: actor.id },
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
    const before =
      await harness.prisma.programAuthoringUpload.findUniqueOrThrow({
        where: { id: uploadId },
        select: { storageKey: true },
      });

    await expect(harness.maintenance.runDue()).resolves.toBe(1);

    await expect(harness.objectExists(before.storageKey)).resolves.toBe(false);
    const deleted =
      await harness.prisma.programAuthoringUpload.findUniqueOrThrow({
        where: { id: uploadId },
        select: {
          lifecycle: true,
          deletedAt: true,
          deleteClaimOwner: true,
          nextDeleteAttemptAt: true,
        },
      });
    expect(deleted.lifecycle).toBe(ProgramAuthoringUploadLifecycle.DELETED);
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
