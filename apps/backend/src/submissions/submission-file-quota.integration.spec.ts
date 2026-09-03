import { EventEmitter, once } from 'node:events';
import { SubmissionFileLifecycle } from '@prisma/client';
import { runProfile } from '../../prisma/seed';
import { seedId, SeedStats } from '../../prisma/seeds/helpers';
import { MILESTONE_SCENARIOS } from '../../prisma/seeds/milestones';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  type CreatePendingSubmissionFileInput,
  SubmissionFilesRepository,
} from './submission-files.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new SubmissionFilesRepository(prisma);
const APPLICATION_ID = seedId('milestones', 'application', 'personal');
const UPLOADER_ID = seedId('milestones', 'user', 'applicant-personal');
const MILESTONE_ID = MILESTONE_SCENARIOS['milestones-upcoming'][0];
const PREFIX = 'integration/submission-file-quota';
const PENDING_EXPIRES_AT = new Date('2099-01-01T00:00:00.000Z');
const RETAINED_BYTES_LIMIT = 500 * 1024 * 1024;
const FILE_BYTES_LIMIT = 5 * 1024 * 1024;

function pendingInput(
  suffix: string,
  sizeBytes = 1,
): CreatePendingSubmissionFileInput {
  return {
    uploaderId: UPLOADER_ID,
    applicationId: APPLICATION_ID,
    milestoneId: MILESTONE_ID,
    storageKey: `${PREFIX}/${suffix}`,
    originalFileName: `${suffix}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes,
    pendingExpiresAt: PENDING_EXPIRES_AT,
  };
}

function retainedFile(
  suffix: string,
  sizeBytes: number,
  lifecycle: SubmissionFileLifecycle = SubmissionFileLifecycle.PENDING,
) {
  return {
    ...pendingInput(suffix, sizeBytes),
    lifecycle,
    expiresAt: PENDING_EXPIRES_AT,
    deletedAt:
      lifecycle === SubmissionFileLifecycle.DELETED ? PENDING_EXPIRES_AT : null,
  };
}

async function quotaOutcome(input: CreatePendingSubmissionFileInput) {
  const [reservation] = await Promise.allSettled([
    repository.createPending(input),
  ]);
  const aggregate = await prisma.submissionFile.aggregate({
    where: {
      uploaderId: UPLOADER_ID,
      storageKey: { startsWith: PREFIX },
      lifecycle: { not: SubmissionFileLifecycle.DELETED },
    },
    _count: { _all: true },
    _sum: { sizeBytes: true },
  });
  return {
    retainedBytes: aggregate._sum.sizeBytes ?? 0,
    retainedFiles: aggregate._count._all,
    status: reservation?.status,
  };
}

describe('SubmissionFilesRepository aggregate quota integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await runProfile('milestones', new SeedStats());
  });

  afterEach(async () => {
    await prisma.submissionFile.deleteMany({
      where: { storageKey: { startsWith: PREFIX } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects file 101 when 100 non-deleted files include DELETE_PENDING', async () => {
    // Given
    await prisma.submissionFile.createMany({
      data: [
        ...Array.from({ length: 50 }, (_, index) =>
          retainedFile(`count-pending-${index}`, 1),
        ),
        ...Array.from({ length: 50 }, (_, index) =>
          retainedFile(
            `count-delete-pending-${index}`,
            1,
            SubmissionFileLifecycle.DELETE_PENDING,
          ),
        ),
        retainedFile(
          'count-deleted-excluded',
          RETAINED_BYTES_LIMIT,
          SubmissionFileLifecycle.DELETED,
        ),
      ],
    });

    // When
    const outcome = await quotaOutcome(pendingInput('count-overflow'));

    // Then
    expect(outcome).toEqual({
      retainedBytes: 100,
      retainedFiles: 100,
      status: 'rejected',
    });
  });

  it('rejects one additional byte at 500 MiB retained across 99 files', async () => {
    // Given
    await prisma.submissionFile.createMany({
      data: [
        ...Array.from({ length: 98 }, (_, index) =>
          retainedFile(`bytes-${index}`, FILE_BYTES_LIMIT),
        ),
        retainedFile('bytes-remainder', 10 * 1024 * 1024),
      ],
    });

    // When
    const outcome = await quotaOutcome(pendingInput('bytes-overflow'));

    // Then
    expect(outcome).toEqual({
      retainedBytes: RETAINED_BYTES_LIMIT,
      retainedFiles: 99,
      status: 'rejected',
    });
  });

  it('excludes DELETED rows from both retained count and retained bytes', async () => {
    // Given
    await prisma.submissionFile.createMany({
      data: [
        ...Array.from({ length: 99 }, (_, index) =>
          retainedFile(`deleted-exclusion-${index}`, 1),
        ),
        retainedFile(
          'deleted-exclusion-large-one',
          RETAINED_BYTES_LIMIT,
          SubmissionFileLifecycle.DELETED,
        ),
        retainedFile(
          'deleted-exclusion-large-two',
          RETAINED_BYTES_LIMIT,
          SubmissionFileLifecycle.DELETED,
        ),
      ],
    });

    // When
    const reservation = repository.createPending(
      pendingInput('deleted-exclusion-allowed'),
    );

    // Then
    await expect(reservation).resolves.toBeDefined();
    await expect(
      prisma.submissionFile.count({
        where: {
          uploaderId: UPLOADER_ID,
          storageKey: { startsWith: PREFIX },
          lifecycle: { not: SubmissionFileLifecycle.DELETED },
        },
      }),
    ).resolves.toBe(100);
  });

  it('serializes two concurrent reservations so only one reaches file 100', async () => {
    // Given
    await prisma.submissionFile.createMany({
      data: Array.from({ length: 99 }, (_, index) =>
        retainedFile(`concurrent-${index}`, 1),
      ),
    });
    const gate = new EventEmitter();
    const released = once(gate, 'release');
    const reservations = ['first', 'second'].map(async (suffix) => {
      await released;
      return repository.createPending(pendingInput(`concurrent-${suffix}`));
    });

    // When
    gate.emit('release');
    const results = await Promise.allSettled(reservations);

    // Then
    expect(results.map(({ status }) => status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    await expect(
      prisma.submissionFile.count({
        where: {
          uploaderId: UPLOADER_ID,
          storageKey: { startsWith: PREFIX },
          lifecycle: { not: SubmissionFileLifecycle.DELETED },
        },
      }),
    ).resolves.toBe(100);
  });

  it('브라우저 zip MIME 별칭으로 예약한 행도 쿼터에 포함된다', async () => {
    const input: CreatePendingSubmissionFileInput = {
      ...pendingInput('windows-zip'),
      originalFileName: 'archive.zip',
      mimeType: 'application/x-zip-compressed',
    };

    await expect(repository.createPending(input)).resolves.toMatchObject({
      originalFileName: 'archive.zip',
      mimeType: 'application/x-zip-compressed',
    });
    await expect(
      prisma.submissionFile.count({
        where: {
          uploaderId: UPLOADER_ID,
          storageKey: { startsWith: PREFIX },
          lifecycle: { not: SubmissionFileLifecycle.DELETED },
        },
      }),
    ).resolves.toBe(1);
  });
});
