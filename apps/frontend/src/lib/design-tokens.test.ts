import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `docs/design-tokens/tokens.json`은 생성 파일이다(design.md R-36). 원본 `globals.css`가
 * 바뀌었는데 다시 내보내지 않으면 Figma가 낡은 값을 읽는다 — 그 어긋남을 여기서 잡는다.
 */
const FRONTEND_DIR = fileURLToPath(new URL('../..', import.meta.url));
const TOKENS_PATH = fileURLToPath(
  new URL('../../../../docs/design-tokens/tokens.json', import.meta.url),
);

describe('design tokens export', () => {
  it('저장된 tokens.json은 globals.css에서 다시 만든 것과 같다 (tokens:check)', () => {
    const output = execFileSync(
      process.execPath,
      ['scripts/export-design-tokens.mjs', '--check'],
      { cwd: FRONTEND_DIR, encoding: 'utf8' },
    );
    expect(output).toContain('최신');
  });

  it('원본 값과 alias가 그대로 옮겨진다', () => {
    const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));
    expect(tokens.primitive.palette.navy['600']).toEqual({
      value: '#003399',
      type: 'color',
    });
    expect(tokens.dimension.space['5']).toEqual({
      value: '24px',
      type: 'spacing',
    });
    expect(tokens.dimension.fontSize.page.value).toBe('40px');
    expect(tokens.light.primary.value).toBe('{palette.navy.600}');
    expect(tokens.dark.primary.value).toBe('{palette.navy.300}');
    expect(tokens.light['control-height'].value).toBe('{measure.44}');
    expect(tokens.light.status.pending.fg.value).toBe('{palette.amber.800}');
    // 계산값은 풀지 않고 손으로 지정할 자리로 남긴다.
    expect(tokens.light.hero.border.description).toContain('손으로');
    expect(tokens.$metadata.tokenSetOrder).toEqual([
      'primitive',
      'dimension',
      'light',
      'dark',
    ]);
  });
});
