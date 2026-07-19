import {
  assertSeedAllowed,
  DEFAULT_SEED_PROFILE,
  resolveSeedProfile,
  seedFixtureUrl,
  seedGithubId,
  seedId,
  SeedStats,
  seedRepositoryId,
} from './helpers';

describe('seedId', () => {
  it('같은 인자는 항상 같은 slug를 만든다', () => {
    // Given & When
    const first = seedId('auth', 'staff-pending');
    const second = seedId('auth', 'staff-pending');

    // Then
    expect(first).toBe(second);
    expect(first).toBe('seed:auth:staff-pending');
  });

  it('인자가 다르면 다른 slug를 만든다', () => {
    expect(seedId('auth', 'a')).not.toBe(seedId('auth', 'b'));
  });
});

describe('seedGithubId / seedRepositoryId', () => {
  it('같은 slug는 항상 같은 값을 만든다(멱등 upsert의 전제)', () => {
    expect(seedGithubId('auth:staff-pending')).toBe(
      seedGithubId('auth:staff-pending'),
    );
    expect(seedRepositoryId('repo-job-pending')).toBe(
      seedRepositoryId('repo-job-pending'),
    );
  });

  it('실제 GitHub numeric id 대역과 겹치지 않는 고정 대역을 쓴다', () => {
    // 2026년 기준 실제 GitHub 계정·저장소 numeric id는 10^10 미만이다.
    expect(seedGithubId('any-slug')).toBeGreaterThan(9_000_000_000_000_000n);
    expect(seedRepositoryId('any-slug')).toBeGreaterThan(
      9_000_000_000_000_000n,
    );
  });

  it('githubId와 repositoryId는 다른 대역을 쓴다(같은 slug라도 값이 겹치지 않는다)', () => {
    expect(seedGithubId('shared-slug')).not.toBe(
      seedRepositoryId('shared-slug'),
    );
  });
});

describe('seedFixtureUrl', () => {
  it('RFC 2606 예약 도메인을 쓰는 명백한 fixture URL을 만든다', () => {
    const url = seedFixtureUrl('repository-public');
    expect(url).toBe('https://github.invalid/oss-hub-seed/repository-public');
  });
});

describe('assertSeedAllowed', () => {
  it('NODE_ENV=production이면 거부한다', () => {
    expect(() => assertSeedAllowed('production')).toThrow(/production/);
  });

  it('production이 아니면 통과한다', () => {
    expect(() => assertSeedAllowed('test')).not.toThrow();
    expect(() => assertSeedAllowed(undefined)).not.toThrow();
  });
});

describe('resolveSeedProfile', () => {
  it('CLI --profile 인자를 최우선으로 쓴다', () => {
    const profile = resolveSeedProfile(
      ['node', 'seed.ts', '--profile', 'intake'],
      { SEED_PROFILE: 'repositories' },
    );
    expect(profile).toBe('intake');
  });

  it('CLI 인자가 없으면 SEED_PROFILE env를 쓴다', () => {
    const profile = resolveSeedProfile(['node', 'seed.ts'], {
      SEED_PROFILE: 'milestones',
    });
    expect(profile).toBe('milestones');
  });

  it('아무것도 없으면 기본값(안전한 최소 profile)을 쓴다', () => {
    const profile = resolveSeedProfile(['node', 'seed.ts'], {});
    expect(profile).toBe(DEFAULT_SEED_PROFILE);
    expect(profile).toBe('auth');
  });

  it('알 수 없는 profile은 거부한다', () => {
    expect(() =>
      resolveSeedProfile(['node', 'seed.ts'], { SEED_PROFILE: 'bogus' }),
    ).toThrow(/알 수 없는 SEED_PROFILE/);
  });
});

describe('SeedStats', () => {
  it('모델별 생성/갱신 카운트를 집계한다', () => {
    const stats = new SeedStats();
    stats.created('User');
    stats.created('User');
    stats.updated('User');
    stats.created('Program');

    const report = stats.report();
    expect(report).toContain('User: created=2 updated=1');
    expect(report).toContain('Program: created=1 updated=0');
  });

  it('fixture-only scenario를 별도로 기록한다', () => {
    const stats = new SeedStats();
    stats.noteFixtureOnly('application-validation-error');

    expect(stats.report()).toContain(
      'fixture-only (DB 미기록): application-validation-error',
    );
  });
});
