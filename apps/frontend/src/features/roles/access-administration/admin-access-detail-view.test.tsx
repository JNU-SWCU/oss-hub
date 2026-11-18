import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adminDetail,
  adminHistory,
  adminMutation,
} from './admin-access-detail-test-fixture';
import { AdminAccessDetailContentForState } from './components/admin-access-detail-content';

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
    expect(html).toContain('href="/dashboard/users"');
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
    expect(html).not.toContain('href="/dashboard/users"');
  });
});

describe('프로필 카드 머리말 — 이름·GitHub 링크·역할/상태 배지', () => {
  it('이름·@githubLogin·GitHub 외부 링크·역할/상태 배지를 그린다', () => {
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

  it('이름이 없으면 "이름 미등록"을 이름 자리에 쓴다', () => {
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

describe('프로필 카드 — 가입 유형별 항목과 미완료 경고', () => {
  it('학생은 학번·학과·참여 프로그램과 팀을 그리고 교직원 번호는 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail({
            role: 'STUDENT',
            memberKind: 'STUDENT',
            participations: [
              {
                programId: 'program-1',
                programName: '합성 프로그램',
                teamName: '합성 팀',
                isLeader: true,
              },
            ],
          }),
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
    expect(html).toMatch(/<h3[^>]*>참여 프로그램<\/h3>/);
    expect(html).toContain('href="/programs/program-1"');
    expect(html).toContain('합성 프로그램');
    expect(html).toContain('합성 팀 · 팀장');
    expect(html).not.toContain('교직원 번호');
    expect(html).not.toContain('기본 정보 입력');
    expect(html).not.toContain('프로필 미완성');
  });

  it('참여 프로그램을 받지 못한 가입 신청 상세는 그 구역 없이 그리고 오류로 보지 않는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail({
            role: 'STUDENT',
            memberKind: 'STUDENT',
            pendingRequest: {
              id: 'request-pending',
              createdAt: '2026-10-27T04:15:00.000Z',
            },
            participations: null,
          }),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
        layoutContext="overlay"
        workspace="queue"
      />,
    );

    expect(html).toContain('학번');
    expect(html).toContain('대기 중인 요청');
    expect(html).toContain('승인');
    expect(html).not.toContain('참여 프로그램');
    expect(html).not.toContain('참여 프로그램이 없습니다.');
    expect(html).not.toContain('불러오지 못했습니다');
  });

  it('교직원은 교직원 번호·소속을 그리고 학번과 참여 프로그램은 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail({
            profile: {
              name: '홍길동',
              studentId: null,
              staffNumber: 'STAFF-42',
              department: 'SW중심대학사업단',
              isComplete: true,
            },
          }),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );

    expect(html).toContain('교직원 번호');
    expect(html).toContain('STAFF-42');
    expect(html).toContain('소속');
    expect(html).toContain('SW중심대학사업단');
    expect(html).not.toContain('학번');
    expect(html).not.toContain('참여 프로그램');
  });

  it('가입 유형이 없으면 가입 유형 미선택으로 알리고 유형별 항목은 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail({ role: null, memberKind: null }),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );

    expect(html).toContain('가입 유형 미선택');
    expect(html).not.toContain('학번');
    expect(html).not.toContain('교직원 번호');
  });

  it('프로필이 미완료면 관리자 전용 구역에 경고 문구를 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail({
            profile: {
              name: null,
              studentId: null,
              staffNumber: null,
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
