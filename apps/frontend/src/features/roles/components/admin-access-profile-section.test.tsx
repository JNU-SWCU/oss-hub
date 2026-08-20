// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';

import type { AdminAccessProfile } from '../admin-access-api';
import { AdminAccessProfileSection } from './admin-access-profile-section';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const { patchAdminUserProfileMock } = vi.hoisted(() => ({
  patchAdminUserProfileMock: vi.fn(),
}));

vi.mock('../admin-access-api', () => ({
  patchAdminUserProfile: patchAdminUserProfileMock,
}));

/**
 * PR — 관리자용 프로필(이름·학번·학과) 보기/수정 섹션. CAS가 없는 단순 PATCH라
 * `admin-access-detail-view.test.tsx`(정적 마크업 스냅샷)와 달리 여기서는
 * 실제 편집 흐름(보기→수정→저장/취소, 검증 실패, API 실패)을 DOM 상호작용으로
 * 확인한다.
 */

function profile(
  overrides: Partial<AdminAccessProfile> = {},
): AdminAccessProfile {
  return {
    name: '합성 사용자',
    studentId: '260001',
    department: '소프트웨어공학과',
    isComplete: true,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  patchAdminUserProfileMock.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function button(name: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(found instanceof HTMLButtonElement)) {
    throw new TypeError(`버튼을 찾지 못했습니다: ${name}`);
  }
  return found;
}

async function render(
  overrides: Partial<AdminAccessProfile> = {},
  props: { readonly isOverlay?: boolean } = {},
) {
  const onSaved = vi.fn();
  await act(async () => {
    root.render(
      <AdminAccessProfileSection
        userId="target"
        profile={profile(overrides)}
        headingTag="h2"
        isOverlay={props.isOverlay ?? false}
        allowEdit={true}
        onSaved={onSaved}
      />,
    );
  });
  return { onSaved };
}

async function type(selector: string, value: string) {
  const input = container.querySelector(selector);
  if (!(input instanceof HTMLInputElement)) {
    throw new TypeError(`입력란을 찾지 못했습니다: ${selector}`);
  }
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(name: string) {
  await act(async () => {
    button(name).click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('보기 모드', () => {
  it('이름·학번·학과를 보여주고 "수정" 버튼을 그린다', async () => {
    await render();
    expect(container.textContent).toContain('합성 사용자');
    expect(container.textContent).toContain('260001');
    expect(container.textContent).toContain('소프트웨어공학과');
    expect(() => button('수정')).not.toThrow();
  });

  it('값이 없는 필드는 "미등록"으로 보여준다', async () => {
    await render({ name: null, studentId: null, department: null });
    expect(container.querySelectorAll('dd')[0]?.textContent).toBe('미등록');
  });

  it('프로필이 미완료면 경고 문구를 보여준다', async () => {
    await render({ isComplete: false });
    expect(container.textContent).toContain(
      '프로필 미완성 — 교직원 승인·부여 불가',
    );
  });

  it('완료된 프로필은 경고 문구가 없다', async () => {
    await render({ isComplete: true });
    expect(container.textContent).not.toContain('프로필 미완성');
  });
});

describe('수정 모드 진입/취소', () => {
  it('"수정" 클릭은 저장된 값으로 채워진 입력란을 연다', async () => {
    await render();
    await click('수정');
    const name = container.querySelector('#admin-profile-name');
    const studentId = container.querySelector('#admin-profile-student-id');
    expect(name).toBeInstanceOf(HTMLInputElement);
    expect((name as HTMLInputElement).value).toBe('합성 사용자');
    expect((studentId as HTMLInputElement).value).toBe('260001');
  });

  it('"취소"는 API를 부르지 않고 보기 모드로 되돌아간다', async () => {
    await render();
    await click('수정');
    await type('#admin-profile-name', '바뀐 이름');
    await click('취소');
    expect(container.textContent).toContain('합성 사용자');
    expect(patchAdminUserProfileMock).not.toHaveBeenCalled();
  });
});

describe('검증 — 백엔드가 null로 지울 수 없는 필드를 미리 막는다', () => {
  it('이름을 비우고 저장하면 인라인 오류를 보여주고 API를 부르지 않는다', async () => {
    await render();
    await click('수정');
    await type('#admin-profile-name', '');
    await click('저장');
    expect(container.textContent).toContain('이름을 입력해 주세요.');
    expect(patchAdminUserProfileMock).not.toHaveBeenCalled();
  });

  it('이미 저장된 학번을 비우고 저장하면 인라인 오류를 보여준다', async () => {
    await render();
    await click('수정');
    await type('#admin-profile-student-id', '');
    await click('저장');
    expect(container.textContent).toContain(
      '이미 저장된 학번은 비워둘 수 없습니다.',
    );
    expect(patchAdminUserProfileMock).not.toHaveBeenCalled();
  });
});

describe('저장 — 바뀐 필드만 담아 patchAdminUserProfile을 부른다', () => {
  it('바뀐 게 없으면 API를 부르지 않고 바로 보기 모드로 돌아간다', async () => {
    await render();
    await click('수정');
    await click('저장');
    expect(patchAdminUserProfileMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('합성 사용자');
  });

  it('학번만 바꾸면 studentId만 담아 호출하고, 성공하면 onSaved를 부른다(관리자는 이미 저장된 학번도 고칠 수 있다)', async () => {
    patchAdminUserProfileMock.mockResolvedValue({
      id: 'target',
      name: '합성 사용자',
      studentId: '260099',
      department: '소프트웨어공학과',
    });
    const { onSaved } = await render();
    await click('수정');
    await type('#admin-profile-student-id', '260099');
    await click('저장');

    expect(patchAdminUserProfileMock).toHaveBeenCalledWith('target', {
      studentId: '260099',
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('저장 실패(학번 중복)는 problem.detail을 그대로 보여주고 수정 모드를 유지한다', async () => {
    patchAdminUserProfileMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'CONFLICT',
        status: 409,
        detail: '이미 다른 사용자가 사용 중인 학번이라 수정할 수 없습니다.',
        instance: '/users/target/profile',
        code: 'USR_008',
      }),
    );
    const { onSaved } = await render();
    await click('수정');
    await type('#admin-profile-student-id', '269999');
    await click('저장');

    expect(container.textContent).toContain(
      '이미 다른 사용자가 사용 중인 학번이라 수정할 수 없습니다.',
    );
    expect(onSaved).not.toHaveBeenCalled();
    // 실패 후에도 여전히 편집 중이므로 입력란이 남아 있다.
    expect(container.querySelector('#admin-profile-student-id')).not.toBeNull();
  });
});

describe('오버레이 레이아웃', () => {
  it('오버레이에서는 보기 모드 dl이 sm:grid-cols-1을 쓴다', async () => {
    await render({}, { isOverlay: true });
    const dl = container.querySelector('dl');
    expect(dl?.className).toContain('sm:grid-cols-1');
  });

  it('표준 레이아웃에서는 보기 모드 dl이 sm:grid-cols-2를 쓴다', async () => {
    await render({}, { isOverlay: false });
    const dl = container.querySelector('dl');
    expect(dl?.className).toContain('sm:grid-cols-2');
  });
});
