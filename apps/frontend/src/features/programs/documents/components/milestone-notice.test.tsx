import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { MilestoneNotice } from './milestone-notice';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const THREE_LINES = 63;
const SIX_LINES = 126;
const MEASURED = ['scrollHeight', 'clientHeight'] as const;
const nativeMeasures = MEASURED.map(
  (name) =>
    [
      name,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
    ] as const,
);

function layOutNotice(contentHeight: number): void {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => contentHeight,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => Math.min(contentHeight, THREE_LINES),
  });
}

const mountedRoots: Root[] = [];

function renderNotice(description: string): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  act(() => {
    root.render(
      <>
        <span id="milestone-name">중간 발표 자료</span>
        <MilestoneNotice
          description={description}
          milestoneNameId="milestone-name"
        />
      </>,
    );
  });
  const notice = container.querySelector<HTMLElement>('[role="note"]');
  if (notice === null) throw new TypeError('공지 구역을 찾지 못했습니다.');
  return notice;
}

function bodyOf(notice: HTMLElement): HTMLElement {
  const body = notice.querySelector('p');
  if (body === null) throw new TypeError('공지 본문을 찾지 못했습니다.');
  return body;
}

function toggleOf(notice: HTMLElement): HTMLButtonElement | null {
  return notice.querySelector('button');
}

function linksOf(notice: HTMLElement): readonly (readonly string[])[] {
  return [...notice.querySelectorAll('a')].map((link) => [
    link.textContent ?? '',
    link.getAttribute('href') ?? '',
    link.target,
  ]);
}

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  document.body.replaceChildren();
  for (const [name, descriptor] of nativeMeasures) {
    if (descriptor === undefined) {
      Reflect.deleteProperty(HTMLElement.prototype, name);
    } else {
      Object.defineProperty(HTMLElement.prototype, name, descriptor);
    }
  }
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('마일스톤 공지', () => {
  it('공지 구역에 이름을 붙이고 본문을 줄바꿈까지 그대로 적는다', () => {
    const notice = renderNotice(
      '발표 자료는 PDF로 제출합니다.\n분량은 10쪽 이내입니다.',
    );

    expect(notice.getAttribute('aria-label')).toBe('운영자 공지');
    expect(bodyOf(notice).textContent).toBe(
      '발표 자료는 PDF로 제출합니다.\n분량은 10쪽 이내입니다.',
    );
    expect(linksOf(notice)).toEqual([]);
  });

  it('본문의 주소를 새 탭으로 여는 링크로 바꾸고 뒤따르는 조사와 문장 부호는 본문에 남긴다', () => {
    const notice = renderNotice(
      '양식은 https://example.com/forms/midterm에서 받습니다. 문의: https://www.example.org/help.',
    );

    expect(linksOf(notice)).toEqual([
      [
        'example.com/forms/midterm',
        'https://example.com/forms/midterm',
        '_blank',
      ],
      ['example.org/help', 'https://www.example.org/help', '_blank'],
    ]);
    expect(bodyOf(notice).textContent).toBe(
      '양식은 example.com/forms/midterm에서 받습니다. 문의: example.org/help.',
    );
  });

  it.each([
    [
      '참고 (https://example.com/guide) 문서',
      'https://example.com/guide',
      '참고 (example.com/guide) 문서',
    ],
    [
      '용어는 https://example.com/wiki/OSS_(software) 를 따릅니다.',
      'https://example.com/wiki/OSS_(software)',
      '용어는 example.com/wiki/OSS_(software) 를 따릅니다.',
    ],
  ])(
    '괄호와 함께 적은 주소 %s 는 주소에 속한 괄호만 링크에 넣는다',
    (description, href, text) => {
      const notice = renderNotice(description);

      expect(linksOf(notice).map(([, target]) => target)).toEqual([href]);
      expect(bodyOf(notice).textContent).toBe(text);
    },
  );

  it('세 줄 안에 드는 공지에는 더 보기를 두지 않는다', () => {
    layOutNotice(THREE_LINES);
    const notice = renderNotice('짧은 공지입니다.');

    expect(toggleOf(notice)).toBeNull();
    expect(bodyOf(notice).classList).toContain('line-clamp-3');
  });

  it('세 줄을 넘는 공지는 접어 두고 더 보기로 펼쳤다가 접기로 되돌린다', () => {
    layOutNotice(SIX_LINES);
    const notice = renderNotice('여섯 줄짜리 공지입니다.');
    const body = bodyOf(notice);
    const toggle = toggleOf(notice);
    if (toggle === null) throw new TypeError('더 보기 버튼을 찾지 못했습니다.');

    expect(toggle.textContent).toBe('더 보기');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(body.id);
    expect(toggle.getAttribute('aria-describedby')).toBe('milestone-name');
    expect(body.classList).toContain('line-clamp-3');

    act(() => {
      toggle.click();
    });

    expect(toggle.textContent).toBe('접기');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body.classList).not.toContain('line-clamp-3');

    act(() => {
      toggle.click();
    });

    expect(toggle.textContent).toBe('더 보기');
    expect(body.classList).toContain('line-clamp-3');
  });

  it('접힌 공지 안의 링크로 초점이 가면 가려진 줄이 보이도록 공지를 펼친다', () => {
    layOutNotice(SIX_LINES);
    const notice = renderNotice(
      '여섯 줄짜리 공지입니다.\n참고: https://example.com/guide',
    );
    const link = notice.querySelector('a');
    if (link === null) throw new TypeError('공지 링크를 찾지 못했습니다.');

    act(() => {
      link.focus();
    });

    expect(toggleOf(notice)?.getAttribute('aria-expanded')).toBe('true');
    expect(bodyOf(notice).classList).not.toContain('line-clamp-3');
  });
});
