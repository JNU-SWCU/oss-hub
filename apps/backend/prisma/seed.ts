import { seedAuth } from './seeds/auth';
import {
  assertSeedAllowed,
  prisma,
  resolveSeedProfile,
  SeedProfile,
  SeedStats,
  seedNow,
} from './seeds/helpers';
import { seedIntake } from './seeds/intake';
import { seedMilestones } from './seeds/milestones';
import { seedRepositories } from './seeds/repositories';

/**
 * #110 시드 진입점. 실행 계약:
 *   SEED_PROFILE=<profile> pnpm --filter backend prisma db seed
 *   pnpm --filter backend prisma db seed -- --profile <profile>
 * profile: auth | intake | milestones | repositories | all (기본값 auth — 안전한 최소).
 * 자세한 시나리오 카탈로그는 apps/backend/prisma/README.md 참조.
 */
export async function runProfile(
  profile: SeedProfile,
  stats: SeedStats,
): Promise<void> {
  if (profile === 'auth' || profile === 'all') {
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
}

async function main(): Promise<void> {
  assertSeedAllowed();
  const profile = resolveSeedProfile();
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
