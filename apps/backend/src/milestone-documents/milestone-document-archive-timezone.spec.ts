import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 교직원 서류 ZIP이 적는 **옛 DOS 수정 시각**은 타임존을 담지 못한다 — 「만든 쪽의 로컬 시각」
 * 그대로다. 그래서 컨테이너가 UTC로 돌면 Windows 탐색기에서 제출 시각이 9시간 이르게 보이고,
 * 마감 직후 제출이 **전날 제출로 읽힌다.**
 *
 * 이 불변식은 **코드로 지킬 수 없다.** 시각을 코드에서 밀어 맞추면 같은 ZIP의 UTC 확장 필드가
 * 대신 틀려 7-Zip·unzip·macOS 쪽이 깨진다. 지킬 자리는 컨테이너의 `TZ` 하나뿐이고, 그 값은
 * 단위 테스트가 도는 개발 기계(이미 KST)에서는 있으나 없으나 결과가 같아 **아무 테스트도
 * 알아채지 못한다.** 그래서 Dockerfile 원문을 직접 읽어 고정한다.
 *
 * 같은 폴더의 `prisma/milestone-document-review-history.spec.ts`가 스키마 원문을 읽는 것과
 * 같은 기법이고, 같은 이유다 — 실패가 실제 배포에서만 드러나는 종류라서.
 */
const DOCKERFILE = readFileSync(join(__dirname, '../../Dockerfile'), 'utf8');

/** `FROM … AS runtime` 아래만 본다 — 빌드 스테이지의 `ENV`는 실행 컨테이너에 남지 않는다. */
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
    /*
     * 값만 있으면 다음 사람이 「안 쓰는 환경변수」로 읽고 지운다. 지워도 테스트는 이 파일 하나만
     * 깨지고 그마저 「왜?」에 답이 없으면 함께 지워진다 — 이유를 코드 옆에 붙들어 둔다.
     */
    expect(runtimeStage()).toContain('DOS');
  });
});
