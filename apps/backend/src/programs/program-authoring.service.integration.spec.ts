import {
  MilestoneSubmissionType,
  ProgramAuthoringUploadLifecycle,
} from '@prisma/client';
import {
  ProgramAuthoringIdempotencyConflictError,
  ProgramAuthoringUploadTokenError,
  ProgramAuthoringValidationError,
  type ProgramAuthoringDocumentRequest,
} from './program-authoring.types';
import type { AuditLogService } from '../audit-log/audit-log.service';
import { ProgramAuthoringRepository } from './program-authoring.repository';
import { ProgramAuthoringService } from './program-authoring.service';
import {
  AUTHORING_TEST_PREFIX,
  ProgramAuthoringIntegrationHarness,
  authoringDocument,
  authoringMilestone,
  authoringRequest,
} from './program-authoring.integration-support';

describe('ProgramAuthoringService integration', () => {
  const harness = new ProgramAuthoringIntegrationHarness();
  const service = new ProgramAuthoringService(
    new ProgramAuthoringRepository(harness.prisma),
    { record: jest.fn() } as unknown as AuditLogService,
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
    // Given
    const actor = await harness.createActor('graph');
    const templateId = await harness.seedUpload({
      actorId: actor.id,
      label: 'graph-template',
      realObject: true,
      expiresAt: futureExpiry(),
    });
    const optionalTemplate: ProgramAuthoringDocumentRequest = {
      name: 'Optional template',
      required: false,
      submissionType: MilestoneSubmissionType.FILE,
      templateUploadId: templateId,
    };
    const request = authoringRequest('graph', [
      authoringMilestone('file', MilestoneSubmissionType.FILE, [
        authoringDocument('required-file', MilestoneSubmissionType.FILE),
        optionalTemplate,
      ]),
      authoringMilestone('text', MilestoneSubmissionType.TEXT, [
        authoringDocument('required-text', MilestoneSubmissionType.TEXT),
      ]),
      authoringMilestone('empty', MilestoneSubmissionType.TEXT, []),
    ]);

    // When
    const created = await service.create(actor.githubId, 'graph-key', request);
    const replayed = await service.create(actor.githubId, 'graph-key', request);

    // Then
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
                required: true,
                submissionType: true,
                templateFile: true,
              },
            },
          },
        },
      },
    });
    expect(graph.milestones.map(({ documents }) => documents.length)).toEqual([
      2, 1, 0,
    ]);
    expect(graph.milestones[0]?.documents[1]).toMatchObject({
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

  it('rejects a changed payload under the same actor idempotency key', async () => {
    // Given
    const actor = await harness.createActor('conflict');
    const initial = authoringRequest('conflict', [
      authoringMilestone('empty', MilestoneSubmissionType.TEXT, []),
    ]);
    await service.create(actor.githubId, 'conflict-key', initial);

    // When / Then
    await expect(
      service.create(actor.githubId, 'conflict-key', {
        ...initial,
        description: 'A distinct canonical payload',
      }),
    ).rejects.toBeInstanceOf(ProgramAuthoringIdempotencyConflictError);
  });

  it.each([
    ['foreign', 'NOT_OWNED'],
    ['expired', 'EXPIRED'],
  ] as const)(
    'rejects a %s pending token without persisting a graph',
    async (kind, reason) => {
      // Given
      const actor = await harness.createActor(`token-${kind}`);
      const owner =
        kind === 'foreign' ? await harness.createActor('other-owner') : actor;
      const tokenId = await harness.seedUpload({
        actorId: owner.id,
        label: `token-${kind}`,
        expiresAt: kind === 'expired' ? new Date(0) : futureExpiry(),
      });

      // When / Then
      await expect(
        service.create(
          actor.githubId,
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
    // Given
    const actor = await harness.createActor('replayed');
    const tokenId = await harness.seedUpload({
      actorId: actor.id,
      label: 'replayed',
      expiresAt: futureExpiry(),
    });
    const initial = requestWithTemplate('replayed-first', tokenId);
    await service.create(actor.githubId, 'replayed-first-key', initial);
    const duplicate = authoringRequest('duplicate', [
      authoringMilestone('duplicate', MilestoneSubmissionType.FILE, [
        authoringDocument('first', MilestoneSubmissionType.FILE, tokenId),
        authoringDocument('second', MilestoneSubmissionType.FILE, tokenId),
      ]),
    ]);

    // When / Then
    await expect(
      service.create(
        actor.githubId,
        'replayed-second-key',
        requestWithTemplate('replayed-second', tokenId),
      ),
    ).rejects.toMatchObject<Partial<ProgramAuthoringUploadTokenError>>({
      reason: 'NOT_PENDING',
    });
    await expect(
      service.create(actor.githubId, 'duplicate-key', duplicate),
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
    // Given
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

    // When
    await expect(harness.maintenance.runDue()).resolves.toBe(1);

    // Then
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
    authoringMilestone('file', MilestoneSubmissionType.FILE, [
      authoringDocument(
        'template',
        MilestoneSubmissionType.FILE,
        templateUploadId,
      ),
    ]),
  ]);
}

function futureExpiry(): Date {
  return new Date(Date.now() + 24 * 60 * 60 * 1_000);
}
