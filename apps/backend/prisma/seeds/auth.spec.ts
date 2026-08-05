import { AUTH_SCENARIOS } from './auth';
import { seedGithubId, seedId } from './helpers';

const scenarioIds = Object.keys(AUTH_SCENARIOS) as ReadonlyArray<
  keyof typeof AUTH_SCENARIOS
>;

describe('AUTH_SCENARIOS 카탈로그', () => {
  it('#184 e2e가 쓰는 페르소나가 카탈로그에 등록돼 있다', () => {
    // Given & When & Then: 시드 함수만 고치고 카탈로그에 올리지 않으면 e2e가 id로
    // 사용자를 찾지 못한다.
    expect(AUTH_SCENARIOS['staff-revocable']).toBe('seed:auth:staff-revocable');
    expect(AUTH_SCENARIOS['admin-second']).toBe('seed:auth:admin-second');
  });

  it('모든 시나리오 id가 seed:auth:<slug> 규칙을 따른다', () => {
    for (const scenarioId of scenarioIds) {
      expect(AUTH_SCENARIOS[scenarioId]).toBe(seedId('auth', scenarioId));
    }
  });

  it('시나리오마다 서로 다른 githubId가 파생된다', () => {
    // githubId는 sha256을 10^12로 자른 값이라 원리상 충돌할 수 있다. 충돌하면 뒤에
    // 심는 페르소나의 upsert가 앞사람의 githubId unique 제약에 걸려 시드가 실패한다.
    const githubIds = scenarioIds.map((scenarioId) =>
      seedGithubId(AUTH_SCENARIOS[scenarioId]).toString(),
    );

    expect(new Set(githubIds).size).toBe(scenarioIds.length);
  });
});
