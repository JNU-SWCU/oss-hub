import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { RankHeadwear } from './ranking-rank-headwear';
import { RankingStreakDecoration } from './ranking-streak-decoration';

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
        accessibleTierName="금빛 날개관"
        days={days}
        tenureLabel="1위"
        tier="celebration"
        name={name}
        href={`https://github.com/${name}`}
        linkAriaLabel={`${name} 프로필`}
        headwear={<RankHeadwear rank={1} />}
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

test('TOP 10 모자는 각각 고유한 정적 실루엣을 가진다', async () => {
  await act(async () => {
    root.render(
      <>
        {Array.from({ length: 10 }, (_, index) => (
          <RankHeadwear key={index} rank={index + 1} />
        ))}
      </>,
    );
  });

  const kinds = [...container.querySelectorAll('[data-headwear-kind]')].map(
    (element) => element.getAttribute('data-headwear-kind'),
  );
  expect(new Set(kinds).size).toBe(10);
});

test('reduced motion에서는 효과 버튼이 상호작용 상태를 만들지 않는다', async () => {
  installReducedMotion(true);
  await renderName('leader');
  const button = container.querySelector('button');

  await act(async () => button?.click());

  expect(
    container.querySelector('[data-streak-reduced-motion="true"]'),
  ).not.toBeNull();
  expect(container.querySelector('[data-streak-interaction="1"]')).toBeNull();
  expect(container.querySelector('[data-streak-confetti]')).toBeNull();
});

test('2위부터는 현재 순위가 아니라 TOP 10 유지 기간을 표시한다', async () => {
  await act(async () => {
    root.render(
      <RankingStreakDecoration
        rank={2}
        accessibleTierName="남빛 삼봉관"
        days={100}
        tenureLabel="TOP 10"
        tier="celebration"
        name="second-place"
        href="https://github.com/second-place"
        linkAriaLabel="second-place 프로필"
      />,
    );
  });

  const button = container.querySelector('button');
  expect(button?.querySelector('[data-tenure-label]')?.textContent).toBe(
    'TOP 10',
  );
  expect(button?.querySelector('[data-day-count]')?.textContent).toBe(
    '100일째',
  );
  expect(container.textContent).toContain('남빛 삼봉관 · TOP 10 100일째 유지');
  expect(container.textContent).not.toContain('2위 100일째 유지');
});

test('별도 태그 버튼이 이름 링크와 분리되고 100일 상호작용에서 confetti를 만든다', async () => {
  await renderName('leader');
  const link = container.querySelector('a');
  const button = container.querySelector('button');

  expect(link?.contains(button)).toBe(false);
  expect(button?.getAttribute('aria-label')).toBe(
    '금빛 날개관 1위 장식 효과 재생',
  );
  expect(button?.querySelector('[data-tenure-label]')?.textContent).toBe('1위');
  expect(button?.querySelector('[data-day-count]')?.textContent).toBe(
    '120일째',
  );
  expect(container.textContent).toContain('금빛 날개관 · 1위 120일째 유지');
  expect(button?.textContent).not.toContain('임금');

  await act(async () => button?.click());

  expect(container.querySelector('[data-streak-confetti]')).not.toBeNull();
  expect(
    container.querySelector('[data-streak-interaction="1"]'),
  ).not.toBeNull();
});
