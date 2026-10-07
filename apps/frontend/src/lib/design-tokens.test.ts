import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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

    expect(tokens.light.hero.border.description).toContain('손으로');
    expect(tokens.$metadata.tokenSetOrder).toEqual([
      'primitive',
      'dimension',
      'light',
      'dark',
    ]);
  });
});
