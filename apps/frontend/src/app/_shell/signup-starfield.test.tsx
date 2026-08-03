// 가입 무대 별밭의 **움직임 계약**(#522). 실제 애니메이션은 브라우저가 돌려야 보이므로
// 여기서 지키는 것은 값이 아니라 방식이다 — 1440에서 잰 프레임 간격(평균 8.33ms ·
// 20ms 초과 0회, 애니메이션을 끈 대조군과 같음)은 PR 본문에 남긴다.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SignupStarfield } from './signup-starfield';

const source = readFileSync(
  path.resolve(__dirname, './signup-starfield.tsx'),
  'utf-8',
);
/** 주석은 "canvas를 쓰지 않는다"처럼 금지어 자체를 설명한다 — 코드만 본다. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
const stylesheet = readFileSync(
  path.resolve(__dirname, './signup-starfield.module.css'),
  'utf-8',
);

const html = renderToStaticMarkup(<SignupStarfield />);
const paths = html.match(/<path/g) ?? [];
/** 점 하나가 subpath 하나다(`M… h.01`). */
const stars = html.match(/h\.01/g) ?? [];

describe('가입 무대 별밭', () => {
  // 움직임을 canvas·rAF로 만들면 화질 거버너(`cosmos-quality.ts`)가 재는 프레임 예산
  // 안으로 들어와 랜딩의 화질 계약을 흔든다. 이 화면의 움직임은 CSS만으로 만든다.
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

  // 별 655개에 요소를 하나씩 두면 비싸다. 층을 위상 갈래로만 쪼개고 애니메이션은
  // 그 갈래(path)에 건다 — 별이 몇 개든 움직이는 요소는 한 자릿수다.
  it('움직이는 요소는 별 수와 무관하게 열 개 미만이다', () => {
    expect(stars).toHaveLength(655);
    expect(paths.length).toBeLessThan(10);
    // 애니메이션 클래스는 그 path에만 붙는다(자국은 소스로 본다 — vitest는 CSS
    // 모듈을 처리하지 않아 렌더 결과에 클래스 이름이 남지 않는다).
    expect(code.split('className={styles.layer}')).toHaveLength(2);
  });

  // 정지 상태의 그림이 예전과 같아야 `reduce`에서 되돌아갈 자리가 생긴다. CSS가
  // `opacity`를 놓는 순간 이 presentation 속성이 그대로 드러난다.
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

  // 흐름이 만드는 빈 가장자리는 SVG 안쪽 확대로 덮는다. 무대 요소에 transform을 걸면
  // 그 넘침이 가로 스크롤이 된다.
  it('흐름의 최대 진폭이 확대로 벌어 둔 여유 안에 있다', () => {
    const scale = Number(
      /transform: scale\((\d+(?:\.\d+)?)\)/.exec(stylesheet)?.[1],
    );
    const drifts = [...source.matchAll(/drift: (\d+)/g)].map((match) =>
      Number(match[1]),
    );

    expect(drifts.length).toBeGreaterThan(0);
    // viewBox 1000 기준. 확대가 각 변에 남기는 여유는 1000 * (scale - 1) / 2다.
    expect(Math.max(...drifts)).toBeLessThan((1000 * (scale - 1)) / 2);
  });
});
