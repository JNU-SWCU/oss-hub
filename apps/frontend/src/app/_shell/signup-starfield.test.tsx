import { readFileSync } from 'node:fs';
import path from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SignupStarfield } from './signup-starfield';

const source = readFileSync(
  path.resolve(__dirname, './signup-starfield.tsx'),
  'utf-8',
);

const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
const stylesheet = readFileSync(
  path.resolve(__dirname, './signup-starfield.module.css'),
  'utf-8',
);

const html = renderToStaticMarkup(<SignupStarfield />);
const paths = html.match(/<path/g) ?? [];

const stars = html.match(/h\.01/g) ?? [];

describe('가입 무대 별밭', () => {
  it('렌더 루프를 만들지 않는다', () => {
    for (const forbidden of [
      'requestAnimationFrame',
      'setInterval',
      'canvas',
      'use client',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('움직이는 요소는 별 수와 무관하게 열 개 미만이다', () => {
    expect(stars).toHaveLength(655);
    expect(paths.length).toBeLessThan(10);

    expect(code.split('className={styles.layer}')).toHaveLength(2);
  });

  it('층의 기준 밝기를 presentation 속성으로도 남긴다', () => {
    expect(html).toContain('opacity="0.28"');
    expect(html).toContain('opacity="0.42"');
    expect(html).toContain('opacity="0.6"');
  });

  it('밝기·흐름 값은 층이 CSS 변수로 넘긴다', () => {
    expect(html).toContain('--star-opacity');
    expect(html).toContain('--star-drift');
    expect(html).toContain('--star-phase');
  });
});

describe('별밭 움직임 스타일', () => {
  it('reduce에서 움직임이 멈춘다', () => {
    expect(stylesheet).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[^}]*\{[^}]*animation: none/,
    );
  });

  const VIEW_BOX = 1000;
  const layerRule = /\.layer \{([\s\S]*?)\}/.exec(stylesheet)?.[1] ?? '';
  const scale = Number(
    /transform: scale\((\d+(?:\.\d+)?)\)/.exec(stylesheet)?.[1],
  );
  const drifts = [...source.matchAll(/drift: (\d+)/g)].map((match) =>
    Number(match[1]),
  );
  const transformBox = /transform-box: ([^;]+);/.exec(layerRule)?.[1]?.trim();
  const transformOrigin = /transform-origin: ([^;]+);/
    .exec(layerRule)?.[1]
    ?.trim();

  const CENTERED = ['center', 'center center', '50% 50%'];

  it('확대 기준점을 viewBox 가운데로 못 박는다', () => {
    expect(transformBox).toBe('view-box');
    expect(CENTERED).toContain(transformOrigin);
  });

  it('흐름의 어느 극단에서도 viewBox 네 변이 덮인다', () => {
    const origin = CENTERED.includes(transformOrigin ?? '') ? VIEW_BOX / 2 : 0;
    const drift = Math.max(...drifts);

    const at = (x: number, d: number): number =>
      scale * x + (1 - scale) * origin + scale * d;

    expect(drifts.length).toBeGreaterThan(0);
    expect(at(0, drift)).toBeLessThanOrEqual(0);
    expect(at(VIEW_BOX, -drift)).toBeGreaterThanOrEqual(VIEW_BOX);
  });
});
