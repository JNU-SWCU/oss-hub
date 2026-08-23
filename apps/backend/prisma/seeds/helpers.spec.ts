import {
  assertOssHubSeedAllowed,
  assertSeedAllowed,
  DEFAULT_SEED_PROFILE,
  parseOssHubTeamAccounts,
  resolveSeedProfile,
  resolveTeardownFlag,
  seedGithubId,
  seedId,
  SeedStats,
  seedNameWithOwner,
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

describe('seedNameWithOwner', () => {
  it('실존 owner와 겹치지 않는 합성 네임스페이스(oss-hub-seed)를 쓴다', () => {
    const nameWithOwner = seedNameWithOwner('repository-public');
    expect(nameWithOwner).toBe('oss-hub-seed/repository-public');
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

describe('assertOssHubSeedAllowed', () => {
  it.each([undefined, '', 'production', 'ci', 'Production'])(
    'NODE_ENV=%p이면 확인값이 있어도 oss-hub 실행을 거부한다',
    (nodeEnv) => {
      expect(() => assertOssHubSeedAllowed(nodeEnv, 'NON_PRODUCTION')).toThrow(
        /NODE_ENV/,
      );
    },
  );

  it.each([undefined, '', 'NON_PRODUCTION ', 'YES'])(
    'OSS_HUB_SEED_CONFIRMATION=%p이면 oss-hub 실행을 거부한다',
    (confirmation) => {
      expect(() => assertOssHubSeedAllowed('test', confirmation)).toThrow(
        /OSS_HUB_SEED_CONFIRMATION/,
      );
    },
  );

  it.each(['development', 'test', 'staging', 'preview'] as const)(
    '%s 환경에서 정확한 확인값이 있으면 oss-hub 실행을 허용한다',
    (nodeEnv) => {
      expect(() =>
        assertOssHubSeedAllowed(nodeEnv, 'NON_PRODUCTION'),
      ).not.toThrow();
    },
  );
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

  it.each(['auth', 'intake', 'milestones', 'repositories', 'all'] as const)(
    '기존 %s profile을 그대로 해석한다',
    (profile) => {
      expect(
        resolveSeedProfile(['node', 'seed.ts', '--profile', profile], {}),
      ).toBe(profile);
    },
  );

  it('oss-hub profile을 해석한다', () => {
    expect(
      resolveSeedProfile(['node', 'seed.ts', '--profile', 'oss-hub'], {}),
    ).toBe('oss-hub');
  });
});

describe('resolveTeardownFlag', () => {
  it('--teardown이 없으면 false다', () => {
    expect(resolveTeardownFlag(['node', 'seed.ts'])).toBe(false);
    expect(resolveTeardownFlag(['node', 'seed.ts', '--profile', 'demo'])).toBe(
      false,
    );
  });

  it('--teardown이 있으면 true다(profile 인자 순서와 무관)', () => {
    expect(
      resolveTeardownFlag([
        'node',
        'seed.ts',
        '--profile',
        'demo',
        '--teardown',
      ]),
    ).toBe(true);
    expect(
      resolveTeardownFlag([
        'node',
        'seed.ts',
        '--teardown',
        '--profile',
        'demo',
      ]),
    ).toBe(true);
  });
});

describe('parseOssHubTeamAccounts', () => {
  const validInput = [
    '101:team-alpha:ADMIN',
    '102:team-beta:ADMIN',
    '103:team-gamma:ADMIN',
    '104:team-delta:ADMIN',
  ].join(',');

  it('서로 다른 GitHub 계정 네 개를 ADMIN으로 해석한다', () => {
    expect(parseOssHubTeamAccounts(validInput)).toEqual([
      { githubId: 101n, login: 'team-alpha', role: 'ADMIN' },
      { githubId: 102n, login: 'team-beta', role: 'ADMIN' },
      { githubId: 103n, login: 'team-gamma', role: 'ADMIN' },
      { githubId: 104n, login: 'team-delta', role: 'ADMIN' },
    ]);
  });

  it('4번째 세그먼트(displayName)가 있으면 함께 해석한다', () => {
    const withDisplayNames = [
      '101:team-alpha:ADMIN:시드운영자알파',
      '102:team-beta:ADMIN:시드운영자베타',
      '103:team-gamma:ADMIN',
      '104:team-delta:ADMIN:시드운영자델타',
    ].join(',');

    expect(parseOssHubTeamAccounts(withDisplayNames)).toEqual([
      {
        githubId: 101n,
        login: 'team-alpha',
        hasAdminAccess: true,
        displayName: '시드운영자알파',
      },
      {
        githubId: 102n,
        login: 'team-beta',
        hasAdminAccess: true,
        displayName: '시드운영자베타',
      },
      { githubId: 103n, login: 'team-gamma', role: 'ADMIN' },
      {
        githubId: 104n,
        login: 'team-delta',
        hasAdminAccess: true,
        displayName: '시드운영자델타',
      },
    ]);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['three entries', validInput.split(',').slice(0, 3).join(',')],
    ['five entries', `${validInput},105:team-epsilon:ADMIN`],
    ['malformed id', validInput.replace('101', 'not-numeric')],
    ['zero id', validInput.replace('101', '0')],
    ['out-of-range id', validInput.replace('101', '9223372036854775808')],
    ['malformed login', validInput.replace('team-alpha', '-invalid')],
    ['malformed entry', validInput.replace('101:team-alpha:ADMIN', 'broken')],
    ['non-admin role', validInput.replace('ADMIN', 'STAFF')],
    ['duplicate id', validInput.replace('104', '101')],
    ['duplicate login', validInput.replace('team-delta', 'TEAM-ALPHA')],
    [
      'too many segments',
      validInput.replace(
        '101:team-alpha:ADMIN',
        '101:team-alpha:ADMIN:시드운영자알파:extra',
      ),
    ],
    [
      'blank displayName',
      validInput.replace('101:team-alpha:ADMIN', '101:team-alpha:ADMIN:   '),
    ],
    [
      'too long displayName',
      validInput.replace(
        '101:team-alpha:ADMIN',
        `101:team-alpha:ADMIN:${'시'.repeat(101)}`,
      ),
    ],
  ])('%s 입력을 fail-closed로 거부한다', (_label, raw) => {
    expect(() => parseOssHubTeamAccounts(raw)).toThrow(/OSS_HUB_TEAM_ACCOUNTS/);
  });

  it('오류에 원문 입력을 포함하지 않는다', () => {
    const raw = `${validInput},sentinel-raw-value`;
    let message = '';

    try {
      parseOssHubTeamAccounts(raw);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('OSS_HUB_TEAM_ACCOUNTS');
    expect(message).not.toContain(raw);
    expect(message).not.toContain('sentinel-raw-value');
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
