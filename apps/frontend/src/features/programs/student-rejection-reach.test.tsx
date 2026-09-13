// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiPath } from '@/lib/api-client';
import { REJECTION_REASON_MAX_LINES } from '@/lib/display-text';
import type { StudentApplication } from './student-application-api';
import type { ProgramDetail } from './types';

/**
 * 반려 사유가 **화면에 실제로 나타나는가**(#722·#733).
 *
 * `program-apply-page.test.tsx`는 `BlockedView`에 신청서를 직접 넘긴다.
 * `load-program-apply-context.test.ts`는 로더가 사유를 보존하는지만 본다.
 * 불러오기가 내 신청서 조회를 그만두거나 막힘 화면에 신청서를 넘기지 않아도
 * 그 둘은 초록불이다. 이 파일은 `/programs/{id}/apply`를 불러오기째 마운트하고
 * 네트워크 경계만 가짜로 둔다.
 */

const PROGRAM_ID = 'program-rejected-reach';
const SESSION_USER = {
  name: '합성 학생',
  nickname: 'synthetic-student',
} as const;

const REJECTION_REASON = [
  '합성 반려: 제출 요약이 프로그램 주제와 맞지 않습니다.',
  '',
  '보완할 점',
  '1. 해결하려는 문제를 한 문장으로 정리해 주세요.',
  '2. 기여할 오픈소스 저장소와 예상 작업 범위를 적어 주세요.',
  '3. 팀원 역할 분담을 적어 주세요.',
  '4. 일정 계획을 적어 주세요.',
  '',
  '재신청 마감은 9월 1일입니다.',
].join('\n');

const REJECTED_PROGRAM = {
  id: PROGRAM_ID,
  name: '합성 반려 도달 프로그램',
  organizer: '합성 운영기관',
  trackType: 'EXTRACURRICULAR',
  applicationTemplateKey: 'basic',
  lifecycle: 'PUBLISHED',
  description: '반려 사유 도달을 보기 위한 합성 프로그램.',
  repositoryProvisioningEnabled: false,
  applicationPeriod: {
    startsAt: '2020-01-01T00:00:00.000Z',
    endsAt: '2099-12-31T23:59:59.000Z',
  },
  viewer: { role: 'STUDENT', applicationStatus: 'REJECTED' },
  milestones: [],
} as const satisfies ProgramDetail;

const REJECTED_APPLICATION = {
  id: 'application-rejected-reach',
  programId: PROGRAM_ID,
  status: 'REJECTED',
  teamId: 'team-rejected-reach',
  answers: { applicantName: '합성 학생', title: '합성 제목' },
  submittedAt: '2026-06-20T00:00:00.000Z',
  updatedAt: '2026-06-28T00:00:00.000Z',
  isRepositoryPublicationPlanned: false,
  rejectionReason: REJECTION_REASON,
  isManager: true,
  canManage: false,
  canEdit: false,
  canCancel: false,
} as const satisfies StudentApplication;

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.ComponentProps<'a'> & { readonly href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}));

import { ProgramApplyPage } from './program-apply-page';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function rejectionFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(String(input), 'http://127.0.0.1');
  const method = init?.method ?? 'GET';
  if (method !== 'GET') {
    throw new Error(`unexpected ${method} ${url.pathname}`);
  }
  if (url.pathname === apiPath(`programs/${PROGRAM_ID}/viewer`)) {
    return Promise.resolve(jsonResponse(REJECTED_PROGRAM));
  }
  if (url.pathname === apiPath('programs/application-templates')) {
    return Promise.resolve(jsonResponse({ items: [] }));
  }
  if (url.pathname === apiPath(`programs/${PROGRAM_ID}/applications/me`)) {
    return Promise.resolve(jsonResponse(REJECTED_APPLICATION));
  }
  throw new Error(`unexpected request ${url.pathname}`);
}

describe('반려된 신청의 사유가 신청 상세 화면에 도달한다', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal('fetch', vi.fn(rejectionFetch));
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('신청 상세 화면이 사유 원문을 한 글자도 잃지 않고 보여 준다', async () => {
    const lines = REJECTION_REASON.split('\n');
    expect(lines.length).toBeGreaterThan(REJECTION_REASON_MAX_LINES);

    await act(async () => {
      root.render(
        <ProgramApplyPage programId={PROGRAM_ID} sessionUser={SESSION_USER} />,
      );
    });
    await vi.waitFor(() => {
      expect(container.textContent ?? '').toContain('반려 사유');
    });

    const text = container.textContent ?? '';
    expect(text).toContain('반려 사유');
    expect(text).toContain(REJECTION_REASON);
    expect(text).toContain(lines[lines.length - 1]);
    expect(text).not.toContain('…');
  });

  it('판정이 끝난 신청이라 수정·취소로 갈리지 않는다', async () => {
    await act(async () => {
      root.render(
        <ProgramApplyPage programId={PROGRAM_ID} sessionUser={SESSION_USER} />,
      );
    });
    await vi.waitFor(() => {
      expect(container.textContent ?? '').toContain(
        '수정할 수 없는 신청입니다',
      );
    });

    const text = container.textContent ?? '';
    expect(text).toContain('수정할 수 없는 신청입니다');
    expect(text).not.toContain('신청서 수정·취소 안내');
  });
});
