import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOCKERFILE = readFileSync(join(__dirname, '../../../Dockerfile'), 'utf8');

function runtimeStage(): string {
  const at = DOCKERFILE.indexOf('AS runtime');
  expect(at).toBeGreaterThan(-1);
  return DOCKERFILE.slice(at);
}

describe('backend 컨테이너 타임존', () => {
  it('실행 스테이지가 TZ를 Asia/Seoul로 고정한다', () => {
    expect(runtimeStage()).toMatch(/^ENV TZ=Asia\/Seoul$/m);
  });

  it('왜 필요한지가 Dockerfile에 적혀 있다', () => {
    expect(runtimeStage()).toContain('DOS');
  });
});
