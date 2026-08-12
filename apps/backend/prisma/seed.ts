import { seedAuth } from './seeds/auth';
import {
  assertOssHubSeedAllowed,
  assertSeedAllowed,
  parseOssHubTeamAccounts,
  prisma,
  resolveSeedProfile,
  SeedProfile,
  SeedStats,
  seedNow,
} from './seeds/helpers';
import { seedDemo } from './seeds/demo';
import { seedIntake } from './seeds/intake';
import { seedMilestones } from './seeds/milestones';
import { seedOssHub } from './seeds/oss-hub';
import { seedProgramOverview } from './seeds/program-overview';
import { seedRepositories } from './seeds/repositories';
import { backfillUserProfiles } from './user-profile-backfill';

/**
 * #110 시드 진입점. 실행 계약:
 *   SEED_PROFILE=<profile> pnpm --filter backend prisma db seed
 *   pnpm --filter backend prisma db seed -- --profile <profile>
 * profile: auth | intake | milestones | repositories | program-overview | oss-hub | demo | all
 * (기본값 auth — 안전한 최소). 자세한 시나리오 카탈로그는 apps/backend/prisma/README.md 참조.
 *
 * `demo`는 `oss-hub`와 마찬가지로 `all`에 포함되지 않는다 — 명시적으로
 * `--profile demo`를 고를 때만 실행된다(qa-econovation-batch TODO 11).
 */
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
    await seedDemo(stats);
  }
  await backfillUserProfiles(prisma);
}

async function main(): Promise<void> {
  const profile = resolveSeedProfile();
  assertSeedAllowed(process.env.NODE_ENV, profile);
  const stats = new SeedStats();

  console.log(`[seed] profile=${profile} SEED_NOW=${seedNow().toISOString()}`);
  await runProfile(profile, stats);
  console.log(`[seed] 완료 (profile=${profile})`);
  console.log(stats.report());
}

// require.main === module: CLI로 직접 실행될 때만 시드를 돌린다. 통합 테스트가
// runProfile을 재사용하려고 이 파일을 import할 때는 부수효과(연결 해제 포함)가 없어야 한다.
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
