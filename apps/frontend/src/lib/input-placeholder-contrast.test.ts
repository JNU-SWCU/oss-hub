import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  path.resolve(__dirname, '../app/globals.css'),
  'utf-8',
).replace(/\/\*[\s\S]*?\*\//g, '');
const inputSource = readFileSync(
  path.resolve(__dirname, '../components/ui/input.tsx'),
  'utf-8',
);
const textareaSource = readFileSync(
  path.resolve(__dirname, '../components/ui/textarea.tsx'),
  'utf-8',
);

const AA_NORMAL_TEXT = 4.5;
const MIN_PLACEHOLDER_TO_TEXT = 1.8;

const palette = new Map(
  [...css.matchAll(/(--palette-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(
    (match) => [match[1], match[2]] as const,
  ),
);

function block(opening: string): string {
  const start = css.indexOf(opening);
  if (start < 0) throw new Error(`${opening} 블록을 찾지 못했습니다`);
  return css.slice(start, css.indexOf('}', start));
}

function resolve(scope: string, token: string): string {
  const match = new RegExp(`${token}:\\s*var\\((--palette-[\\w-]+)\\)`).exec(
    scope,
  );
  const hex = match ? palette.get(match[1]) : undefined;
  if (!hex) throw new Error(`${token}을 팔레트 색으로 풀지 못했습니다`);
  return hex;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const scopes = {
  light: block(':root {\n  --background: var(--palette-white);'),
  dark: block('.dark {'),
};

describe('입력 칸 안내 문구 색', () => {
  it.each(Object.entries(scopes))(
    '%s: 배경 대비 AA를 지키면서 입력한 글자와 구분된다',
    (_, scope) => {
      const placeholder = resolve(scope, '--placeholder');
      expect(
        contrast(placeholder, resolve(scope, '--background')),
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      expect(
        contrast(placeholder, resolve(scope, '--foreground')),
      ).toBeGreaterThanOrEqual(MIN_PLACEHOLDER_TO_TEXT);
    },
  );

  it('Input과 Textarea가 안내 문구 토큰을 쓴다', () => {
    expect(inputSource).toContain('placeholder:text-placeholder');
    expect(textareaSource).toContain('placeholder:text-placeholder');
  });
});
