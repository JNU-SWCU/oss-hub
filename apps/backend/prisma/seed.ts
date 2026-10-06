import { seedAuth } from './seeds/auth';
import {
  assertOssHubSeedAllowed,
  assertSeedAllowed,
  parseOssHubTeamAccounts,
  prisma,
  resolveSeedProfile,
  resolveTeardownFlag,
  SeedProfile,
  SeedStats,
  seedNow,
} from './seeds/helpers';
import { seedDemo, teardownDemo } from './seeds/demo';
import { seedIntake } from './seeds/intake';
import { seedMilestones } from './seeds/milestones';
import { seedOssHub } from './seeds/oss-hub';
import { seedProgramOverview } from './seeds/program-overview';
import { seedRepositories } from './seeds/repositories';
import { S3SubmissionFileStorage } from '../src/submissions/s3-submission-file.storage';
import { SubmissionFileStorageConfig } from '../src/submissions/submission-file-storage.config';
import type { SubmissionFileStoragePort } from '../src/submissions/submission-file-storage.port';

function createSubmissionFileStorage(): SubmissionFileStoragePort {
  return new S3SubmissionFileStorage(new SubmissionFileStorageConfig());
}

export async function runProfile(
  profile: SeedProfile,
  stats: SeedStats,
): Promise<void> {
  if (profile === 'oss-hub') {
    assertOssHubSeedAllowed(
      process.env.NODE_ENV,
      process.env.OSS_HUB_SEED_CONFIRMATION,
    );
  }
  const ossHubAccounts =
    profile === 'oss-hub'
      ? parseOssHubTeamAccounts(process.env.OSS_HUB_TEAM_ACCOUNTS)
      : undefined;
  if (profile === 'auth' || profile === 'oss-hub' || profile === 'all') {
    await seedAuth(stats);
  }
  if (profile === 'intake' || profile === 'all') {
    await seedIntake(stats);
  }
  if (profile === 'milestones' || profile === 'all') {
    await seedMilestones(stats);
  }
  if (profile === 'repositories' || profile === 'all') {
    await seedRepositories(stats);
  }
  if (profile === 'program-overview' || profile === 'all') {
    await seedProgramOverview(stats);
  }
  if (profile === 'oss-hub' && ossHubAccounts) {
    await seedOssHub(stats, ossHubAccounts);
  }
  if (profile === 'demo') {
    await seedDemo(stats, createSubmissionFileStorage());
  }
}

export async function runTeardown(
  profile: SeedProfile,
  stats: SeedStats,
): Promise<void> {
  if (profile !== 'demo') {
    throw new Error(
      `--teardown은 현재 demo profile만 지원합니다 (입력: "${profile}").`,
    );
  }
  await teardownDemo(stats, createSubmissionFileStorage());
}

async function main(): Promise<void> {
  const profile = resolveSeedProfile();
  assertSeedAllowed(process.env.NODE_ENV, profile);
  const teardown = resolveTeardownFlag();
  const stats = new SeedStats();

  if (teardown) {
    console.log(
      `[seed] teardown profile=${profile} SEED_NOW=${seedNow().toISOString()}`,
    );
    await runTeardown(profile, stats);
    console.log(`[seed] teardown 완료 (profile=${profile})`);
    console.log(stats.report());
    return;
  }

  console.log(`[seed] profile=${profile} SEED_NOW=${seedNow().toISOString()}`);
  await runProfile(profile, stats);
  console.log(`[seed] 완료 (profile=${profile})`);
  console.log(stats.report());
}

if (require.main === module) {
  main()
    .catch((error: unknown) => {
      console.error('[seed] 실패:', error);
      process.exitCode = 1;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
