import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adminDetail,
  adminHistory,
  adminMutation,
} from './admin-access-detail-test-fixture';
import type { AccessWorkspace } from './admin-access-list-query';
import { AdminAccessDetailContentForState } from './components/admin-access-detail-content';
import type { AdminAccessDetailLayoutContext } from './components/admin-access-detail-layout';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function ready(
  props: {
    readonly layoutContext?: AdminAccessDetailLayoutContext;
    readonly workspace?: AccessWorkspace;
    readonly listHref?: string;
  } = {},
) {
  return (
    <AdminAccessDetailContentForState
      state={{
        kind: 'ready',
        detail: adminDetail(),
        history: adminHistory(),
      }}
      onRetry={() => {}}
      mutation={adminMutation()}
      {...props}
    />
  );
}

function button(name: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(found instanceof HTMLButtonElement)) {
    throw new TypeError(`버튼을 찾지 못했습니다: ${name}`);
  }
  return found;
}

describe('레이아웃 컨텍스트(standalone/overlay) — landmark·제목 레벨·폭 계약', () => {
  it.each([
    { workspace: 'queue', kind: 'loading', subject: '가입 신청' },
    { workspace: 'queue', kind: 'error', subject: '가입 신청' },
    { workspace: 'directory', kind: 'loading', subject: '사용자 정보' },
    { workspace: 'directory', kind: 'error', subject: '사용자 정보' },
  ] as const)(
    '$workspace의 $kind 상태를 해당 업무 이름으로 안내한다',
    ({ workspace, kind, subject }) => {
      const html = renderToStaticMarkup(
        <AdminAccessDetailContentForState
          state={{ kind }}
          onRetry={() => {}}
          mutation={adminMutation()}
          workspace={workspace}
        />,
      );
      expect(html).toContain(subject);
    },
  );

  it('standalone은 <main> landmark와 이름 접근 가능한 이름을 갖는다(로딩 상태)', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'loading' }}
        onRetry={() => {}}
        mutation={adminMutation()}
        layoutContext="standalone"
      />,
    );
    expect(html).toContain('<main');
    expect(html).toContain('role="status"');
    expect(html).toContain('사용자 정보를 불러오는 중');
  });

  it('overlay는 <main>이 아닌 <div>를 쓰고 landmark 이름을 붙이지 않는다(로딩 상태)', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'loading' }}
        onRetry={() => {}}
        mutation={adminMutation()}
        layoutContext="overlay"
      />,
    );
    expect(html).not.toContain('<main');
    expect(html).not.toContain('aria-label="사용자 정보를 불러오는 중"');
  });

  it('standalone 사용자 상세는 h1 제목과 목록 링크를 두고 이름·섹션은 h2로 쓴다', () => {
    const html = renderToStaticMarkup(ready({ layoutContext: 'standalone' }));

    expect(html).toMatch(/<h1[^>]*>사용자 상세<\/h1>/);
    expect(html).toMatch(
      /<a[^>]*href="\/dashboard\/users"[^>]*>.*사용자 목록<\/a>/,
    );
    expect(html).toMatch(/<h2[^>]*>홍길동<\/h2>/);
    expect(
      html.match(/<h2[^>]*id="admin-access-role-request-history"/),
    ).not.toBeNull();
    expect(
      html.match(/<h2[^>]*id="admin-access-login-history"/),
    ).not.toBeNull();
  });

  it('목록 링크는 받은 주소로 목록이 서 있던 질의를 유지한다', () => {
    const html = renderToStaticMarkup(
      ready({ listHref: '/dashboard/users?role=STAFF&page=2' }),
    );
    expect(html).toContain('href="/dashboard/users?role=STAFF&amp;page=2"');
  });

  it('standalone 가입 신청 상세는 가입 신청 제목과 목록 링크를 쓴다', () => {
    const html = renderToStaticMarkup(ready({ workspace: 'queue' }));

    expect(html).toMatch(/<h1[^>]*>가입 신청 상세<\/h1>/);
    expect(html).toMatch(
      /<a[^>]*href="\/dashboard\/applicants"[^>]*>.*가입 신청<\/a>/,
    );
    expect(html).not.toContain('사용자 상세');
  });

  it('overlay는 제목과 목록 링크 없이 이름 h2 + 섹션 h3를 써서 제목 레벨 역행을 피한다', () => {
    const html = renderToStaticMarkup(
      ready({ layoutContext: 'overlay', workspace: 'queue' }),
    );

    expect(html).not.toContain('<h1');
    expect(html).not.toContain('href="/dashboard/applicants"');
    expect(html).toMatch(/<h2[^>]*>홍길동<\/h2>/);
    expect(
      html.match(/<h3[^>]*id="admin-access-role-request-history"/),
    ).not.toBeNull();
    expect(
      html.match(/<h3[^>]*id="admin-access-login-history"/),
    ).not.toBeNull();
  });

  it('standalone은 1단 폭을 쓰고 2열 분할을 쓰지 않는다', () => {
    const html = renderToStaticMarkup(ready({ layoutContext: 'standalone' }));

    expect(html).toContain('max-w-3xl');
    expect(html).not.toContain('max-w-6xl');
    expect(html).not.toContain('md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]');
  });

  it('overlay는 뷰포트 기준 폭 대신 컨테이너를 채우는 전용 클래스를 쓴다', () => {
    const html = renderToStaticMarkup(
      ready({ layoutContext: 'overlay', workspace: 'queue' }),
    );

    expect(html).toContain('min-w-0');
    expect(html).not.toContain('max-w-3xl');
  });

  it('프로필 항목은 뷰포트가 아닌 카드 폭을 기준으로 2열이 되어 좁은 오버레이에서 눌리지 않는다', () => {
    const html = renderToStaticMarkup(
      ready({ layoutContext: 'overlay', workspace: 'queue' }),
    );

    expect(html).toContain('@container');
    expect(html).toContain('@md:grid-cols-2');
    expect(html).not.toContain('sm:grid-cols-2');
  });
});

describe('관리자 전용 구역 — 프로필 카드 아래에 관리자 동작만 모은다', () => {
  it('사용자 상세는 프로필 카드, 관리자 전용 구역, 접근 변경, 이력 순으로 한 줄로 쌓는다', () => {
    const html = renderToStaticMarkup(ready());
    const order = [
      'data-slot="user-profile-card"',
      'aria-label="관리자 전용"',
      '프로필 수정',
      '접근 변경',
      '요청 이력',
      '로그인 이력',
    ].map((marker) => html.indexOf(marker));

    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('프로필 카드 안에는 관리자 동작을 두지 않는다', () => {
    const html = renderToStaticMarkup(ready());
    const card = html.slice(
      html.indexOf('data-slot="user-profile-card"'),
      html.indexOf('aria-label="관리자 전용"'),
    );

    expect(card).toContain('홍길동');
    expect(card).not.toContain('<button');
    expect(card).not.toContain('접근 변경');
    expect(card).not.toContain('프로필 수정');
  });

  it('가입 신청 상세는 관리자 전용 구역과 프로필 수정 없이 이력만 둔다', () => {
    const html = renderToStaticMarkup(ready({ workspace: 'queue' }));

    expect(html).toContain('data-slot="user-profile-card"');
    expect(html).not.toContain('관리자 전용');
    expect(html).not.toContain('프로필 수정');
    expect(html).not.toContain('접근 변경');
    expect(html).toContain('로그인 이력');
  });

  it('프로필 수정을 누르면 구역 안에 폼이 열리고 취소하면 닫히며 포커스가 버튼으로 돌아온다', () => {
    act(() => root.render(ready()));
    const trigger = button('프로필 수정');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#admin-profile-name')).toBeNull();

    act(() => trigger.click());
    const zone = container.querySelector('aside[aria-label="관리자 전용"]');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(zone?.querySelector('#admin-profile-name')).not.toBeNull();

    act(() => button('취소').click());
    expect(container.querySelector('#admin-profile-name')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('열린 폼은 프로필 수정을 다시 눌러도 닫힌다', () => {
    act(() => root.render(ready()));
    const trigger = button('프로필 수정');

    act(() => trigger.click());
    act(() => trigger.click());

    expect(container.querySelector('#admin-profile-name')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
