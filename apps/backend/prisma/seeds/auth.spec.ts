import { AUTH_SCENARIOS } from './auth';
import { seedGithubId, seedId } from './helpers';

const scenarioIds = Object.keys(AUTH_SCENARIOS) as ReadonlyArray<
  keyof typeof AUTH_SCENARIOS
>;

describe('AUTH_SCENARIOS 카탈로그', () => {
  it('#184 e2e가 쓰는 페르소나가 카탈로그에 등록돼 있다', () => {
    expect(AUTH_SCENARIOS['staff-revocable']).toBe('seed:auth:staff-revocable');
    expect(AUTH_SCENARIOS['admin-second']).toBe('seed:auth:admin-second');
  });

  it('모든 시나리오 id가 seed:auth:<slug> 규칙을 따른다', () => {
    for (const scenarioId of scenarioIds) {
      expect(AUTH_SCENARIOS[scenarioId]).toBe(seedId('auth', scenarioId));
    }
  });

  it('시나리오마다 서로 다른 githubId가 파생된다', () => {
    const githubIds = scenarioIds.map((scenarioId) =>
      seedGithubId(AUTH_SCENARIOS[scenarioId]).toString(),
    );

    expect(new Set(githubIds).size).toBe(scenarioIds.length);
  });
});
