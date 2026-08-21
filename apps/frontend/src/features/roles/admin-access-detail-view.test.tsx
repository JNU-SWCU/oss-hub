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

describe('상태별 기본 렌더링', () => {
  it('로딩 상태는 재시도 버튼 없이 스켈레톤을 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'loading' }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );
    expect(html).toContain('animate-pulse');
  });

  it('에러 상태는 재시도 버튼을 그리고 클릭하면 onRetry가 불린다', () => {
    const onRetry = vi.fn();
    act(() => {
      root.render(
        <AdminAccessDetailContentForState
          state={{ kind: 'error' }}
          onRetry={onRetry}
          mutation={adminMutation()}
        />,
      );
    });

    const retryButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('다시 시도'),
    );
    expect(retryButton).toBeDefined();
    act(() => {
      retryButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('찾을 수 없음 상태는 목록으로 돌아가는 링크를 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'not-found' }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );
    expect(html).toContain('사용자를 찾을 수 없습니다');
    expect(html).toContain('href="/admin/access"');
  });

  it('가입 신청 찾을 수 없음은 가입 신청 목록으로 돌아간다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'not-found' }}
        onRetry={() => {}}
        mutation={adminMutation()}
        workspace="queue"
      />,
    );
    expect(html).toContain('href="/dashboard/applicants"');
    expect(html).toContain('가입 신청으로');
    expect(html).not.toContain('href="/admin/access"');
  });
});

describe('머리말 — 이름·GitHub 링크·역할/상태 배지 (중복 제거된 헤더)', () => {
  it('이름(h1)·@githubLogin·GitHub 외부 링크·역할/상태 배지를 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );

    expect(html).toContain('홍길동');
    expect(html).toContain('@octocat');
    expect(html).toContain('href="https://github.com/octocat"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('교직원');
    expect(html).toContain('활성');
  });

  it('이름이 없으면 "이름 미등록"을 제목으로 쓴다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail({ name: null }),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );
    expect(html).toContain('이름 미등록');
  });

  it('역할이 미지정(null)이면 "미지정" 배지를 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail({ role: null }),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );
    expect(html).toContain('미지정');
  });
});

describe('프로필 섹션 — "기본 정보 입력" dt/dd 제거, 미완료 경고로 대체', () => {
  it('이름/학번/학과만 dt/dd로 그리고, 완료 상태면 경고가 없다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );

    expect(html).toContain('학번');
    expect(html).toContain('202601');
    expect(html).toContain('학과');
    expect(html).toContain('인공지능학부');
    expect(html).not.toContain('기본 정보 입력');
    expect(html).not.toContain('프로필 미완성');
  });

  it('프로필이 미완료면 섹션 상단에 경고 문구를 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail({
            profile: {
              name: null,
              studentId: null,
              department: null,
              isComplete: false,
            },
          }),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );

    expect(html).toContain('프로필 미완성 — 교직원 승인·부여 불가');
    expect(html).toContain('미등록');
  });
});

describe('"자격 상태"·"마지막 로그인" 카드 제거', () => {
  it('더 이상 자격 상태 카드를 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );
    expect(html).not.toContain('자격 상태');
  });

  it('로그인 이력 제목 옆에 마지막 로그인을 다시 쓰지 않는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail({ lastLoginAt: '2026-07-30T01:00:00.000Z' }),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );
    expect(html).toContain('로그인 이력');
    expect(html).not.toContain('마지막 로그인');
    expect(html).not.toContain('기록 없음');
  });
});
