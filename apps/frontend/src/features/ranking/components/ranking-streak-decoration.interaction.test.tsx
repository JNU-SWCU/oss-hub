import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  IkseongwanHeadwear,
  RankingStreakDecoration,
} from './ranking-streak-decoration';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

let container: HTMLDivElement;
let root: Root;

function installReducedMotion(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

beforeEach(() => {
  installReducedMotion(false);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderName(name: string, days = 120) {
  await act(async () => {
    root.render(
      <RankingStreakDecoration
        rank={1}
        title="임금"
        days={days}
        tier="celebration"
        name={name}
        href={`https://github.com/${name}`}
        linkAriaLabel={`${name} 프로필`}
        headwear={<IkseongwanHeadwear />}
      />,
    );
  });
}

test.each([
  ['김', '김', ''],
  ['Latin', 'L', 'atin'],
  ['👩‍💻coder', '👩‍💻', 'coder'],
])('첫 grapheme %s에만 모자를 고정한다', async (name, first, remainder) => {
  await renderName(name);

  const firstCharacter = container.querySelector(
    '[data-streak-first-character]',
  );
  const link = container.querySelector('a');

  expect(firstCharacter?.childNodes[0]?.textContent).toBe(first);
  expect(link?.textContent).toBe(`${first}${remainder}`);
  const nameText = container.querySelector('[data-streak-name-text]');
  const hat = container.querySelector('[data-streak-headwear]');
  expect(firstCharacter?.querySelector('svg')).toBeNull();
  expect(nameText?.contains(hat)).toBe(false);
  expect(link?.contains(hat)).toBe(true);
  expect(
    container.querySelector('[data-streak-entered="true"]'),
  ).not.toBeNull();
});

test('별도 태그 버튼이 이름 링크와 분리되고 100일 상호작용에서 confetti를 만든다', async () => {
  await renderName('leader');
  const link = container.querySelector('a');
  const button = container.querySelector('button');

  expect(link?.contains(button)).toBe(false);
  expect(button?.getAttribute('aria-label')).toBe('임금 장식 효과 재생');
  expect(
    container
      .querySelector('[data-ranking-streak-tier]')
      ?.getAttribute('data-ranking-streak-tier'),
  ).toBe('celebration');

  await act(async () => button?.click());

  expect(container.querySelector('[data-streak-confetti]')).not.toBeNull();
  expect(
    container.querySelector('[data-streak-interaction="1"]'),
  ).not.toBeNull();
});
