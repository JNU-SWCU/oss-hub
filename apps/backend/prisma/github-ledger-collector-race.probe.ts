import { PrismaClient } from '@prisma/client';
import { CollectionUserActivityRepository } from '../src/github/repository-provision-job.repository';
import { PrismaService } from '../src/platform/prisma.service';

type ProbeMode = 'pkey' | 'same-count' | 'logical';

const readMode = (argv: readonly string[]): ProbeMode => {
  const mode = argv[2];
  if (mode === 'pkey' || mode === 'same-count' || mode === 'logical') {
    return mode;
  }
  throw new Error('mode must be pkey, same-count, or logical');
};

const prisma = new PrismaClient();
const repository = new CollectionUserActivityRepository(
  prisma as unknown as PrismaService,
);

const githubId = 42n;
const sharedCounts = {
  pullRequestCount: 2,
  issueCount: 3,
  repositoryCount: 4,
  starCount: 5,
};

const writeObservation = async (
  commitCount: number,
  observedAt: Date,
): Promise<void> => {
  await repository.upsertObservation({
    githubId,
    year: 2026,
    month: 4,
    githubLogin: 'octocat',
    commitCount,
    ...sharedCounts,
    observedAt,
  });
};

const run = async (mode: ProbeMode): Promise<void> => {
  if (mode === 'pkey') {
    await writeObservation(2, new Date('2026-04-02T00:00:00.000Z'));
    process.stdout.write('pkey_write=ok\n');
    return;
  }
  if (mode === 'same-count') {
    await writeObservation(5, new Date('2026-04-03T00:00:00.000Z'));
    process.stdout.write('same_count_write=ok\n');
    return;
  }
  await writeObservation(4, new Date('2026-05-01T00:00:00.000Z'));
  await writeObservation(4, new Date('2026-05-02T00:00:00.000Z'));
  await writeObservation(9, new Date('2026-05-01T00:00:00.000Z'));
  await writeObservation(9, new Date('2026-05-03T00:00:00.000Z'));
  await writeObservation(10, new Date('2026-05-04T00:00:00.000Z'));
  process.stdout.write('logical_write=ok\n');
};

const main = async (): Promise<void> => {
  try {
    await run(readMode(process.argv));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`write_error=${message}\n`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

void main();
