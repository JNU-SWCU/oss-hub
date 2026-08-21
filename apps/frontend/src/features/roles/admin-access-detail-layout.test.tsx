// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adminDetail,
  adminHistory,
  adminMutation,
} from './admin-access-detail-test-fixture';
import { AdminAccessDetailContentForState } from './components/admin-access-detail-view';

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

describe('레이아웃 컨텍스트(standalone/overlay) — landmark·제목 레벨·448px 오버레이 폭 계약', () => {
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
    expect(html).toContain('aria-label="관리자 접근 상세를 불러오는 중"');
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
    expect(html).not.toContain('aria-label="관리자 접근 상세를 불러오는 중"');
  });

  it('standalone은 제목 h1 + 섹션 h2를 쓴다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
        layoutContext="standalone"
      />,
    );
    expect(html).toContain('<h1');
    expect(html).toContain('id="admin-access-profile"');
    expect(html.match(/<h2[^>]*id="admin-access-profile"/)).not.toBeNull();
  });

  it('overlay는 제목 h2 + 섹션 h3를 써서 제목 레벨 역행을 피한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
        layoutContext="overlay"
      />,
    );
    expect(html).not.toContain('<h1');
    expect(html.match(/<h3[^>]*id="admin-access-profile"/)).not.toBeNull();
    expect(
      html.match(/<h3[^>]*id="admin-access-role-request-history"/),
    ).not.toBeNull();
    expect(
      html.match(/<h3[^>]*id="admin-access-login-history"/),
    ).not.toBeNull();
  });

  it('overlay는 DetailPanelLayout의 md: 2열 분할을 끄고(stacked) 항상 세로로 쌓는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
        layoutContext="overlay"
      />,
    );
    expect(html).not.toContain('md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]');
  });

  it('overlay는 접근 변경을 이력보다 앞에 두고 이력 라벨로 구분한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
        layoutContext="overlay"
      />,
    );
    const accessChangeAt = html.indexOf('접근 변경');
    const historyLabelAt = html.indexOf('>이력</');
    const loginHistoryAt = html.indexOf('로그인 이력');
    expect(accessChangeAt).toBeGreaterThan(-1);
    expect(historyLabelAt).toBeGreaterThan(accessChangeAt);
    expect(loginHistoryAt).toBeGreaterThan(historyLabelAt);
  });

  it('standalone 왼쪽은 이력, 오른쪽은 편집이다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
        layoutContext="standalone"
      />,
    );
    const primary =
      html.match(
        /data-slot="detail-panel-primary"[^>]*>([\s\S]*?)data-slot="detail-panel-secondary"/,
      )?.[1] ?? '';
    const secondary =
      html.match(/data-slot="detail-panel-secondary"[^>]*>([\s\S]*)$/)?.[1] ??
      '';
    expect(primary).toContain('로그인 이력');
    expect(primary).not.toContain('접근 변경');
    expect(secondary).toContain('접근 변경');
  });

  it('standalone은 DetailPanelLayout을 2열로 유지한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
        layoutContext="standalone"
      />,
    );
    expect(html).toContain('md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]');
  });

  it('overlay는 뷰포트 기준 sm: 계단 대신 고정 폭 전용 클래스를 쓴다(448px 컨테이너 대응)', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
        layoutContext="overlay"
      />,
    );
    expect(html).toContain('min-w-0');
    expect(html).not.toContain('max-w-6xl');
    expect(html).toContain('sm:justify-start');
    expect(html).toContain('sm:text-section');
  });

  it('standalone은 뷰포트 폭 전체를 쓰는 계단식 클래스를 쓴다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
        layoutContext="standalone"
      />,
    );
    expect(html).toContain('max-w-6xl');
    expect(html).not.toContain('sm:justify-start');
  });

  it('overlay는 프로필 dl을 sm:grid-cols-1로 강제해 좁은 렌더 폭에서 눌리지 않게 한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
        layoutContext="overlay"
      />,
    );
    expect(html).toContain('sm:grid-cols-1');
  });

  it('standalone은 프로필 dl을 기본 sm:grid-cols-2로 둔다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
        layoutContext="standalone"
      />,
    );
    expect(html).toContain('sm:grid-cols-2');
  });
});
