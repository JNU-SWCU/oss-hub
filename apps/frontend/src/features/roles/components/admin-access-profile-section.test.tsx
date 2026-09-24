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
  it('이름·학번·학과를 보여주고 연필 버튼을 그린다', async () => {
    await render();
    expect(container.textContent).toContain('합성 사용자');
    expect(container.textContent).toContain('260001');
    expect(container.textContent).toContain('소프트웨어공학과');
    expect(() => button('프로필 수정')).not.toThrow();
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
  it('연필 클릭은 저장된 값으로 채워진 입력란을 연다', async () => {
    await render();
    await click('프로필 수정');
    const name = container.querySelector('#admin-profile-name');
    const studentId = container.querySelector('#admin-profile-student-id');
    expect(name).toBeInstanceOf(HTMLInputElement);
    expect((name as HTMLInputElement).value).toBe('합성 사용자');
    expect((studentId as HTMLInputElement).value).toBe('260001');
  });

  it('"취소"는 API를 부르지 않고 보기 모드로 되돌아간다', async () => {
    await render();
    await click('프로필 수정');
    await type('#admin-profile-name', '바뀐 이름');
    await click('취소');
    expect(container.textContent).toContain('합성 사용자');
    expect(patchAdminUserProfileMock).not.toHaveBeenCalled();
  });
});

describe('검증 — 백엔드가 null로 지울 수 없는 필드를 미리 막는다', () => {
  it('이름을 비우고 저장하면 인라인 오류를 보여주고 API를 부르지 않는다', async () => {
    await render();
    await click('프로필 수정');
    await type('#admin-profile-name', '');
    await click('저장');
    expect(container.textContent).toContain('이름을 입력해 주세요.');
    expect(patchAdminUserProfileMock).not.toHaveBeenCalled();
  });

  it('이미 저장된 학번을 비우고 저장하면 인라인 오류를 보여준다', async () => {
    await render();
    await click('프로필 수정');
    await type('#admin-profile-student-id', '');
    await click('저장');
    expect(container.textContent).toContain(
      '이미 저장된 학번은 비워둘 수 없습니다.',
    );
    expect(patchAdminUserProfileMock).not.toHaveBeenCalled();
  });
});

async function choose(selector: string, value: string) {
  const select = container.querySelector(selector);
  if (!(select instanceof HTMLSelectElement)) {
    throw new TypeError(`선택 상자를 찾지 못했습니다: ${selector}`);
  }
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function summary(): Element | null {
  return container.querySelector('[data-slot="form-error-summary"]');
}

function visibleFieldErrorCount(): number {
  return container.querySelectorAll('[data-slot="field-error"]').length;
}

describe('상단 오류 요약과 첫 오류 칸 포커스(R-16)', () => {
  it('칸 오류가 둘이면 폼 맨 위에 보이는 오류 줄 수만큼 알리고 커서는 첫 오류 칸에 둔다', async () => {
    await render();
    await click('프로필 수정');
    await type('#admin-profile-name', '');
    await type('#admin-profile-student-id', '');
    await click('저장');

    expect(visibleFieldErrorCount()).toBe(2);
    expect(summary()?.textContent).toBe(
      `고칠 칸이 ${visibleFieldErrorCount()}개 있습니다`,
    );
    // 요약은 폼의 첫 칸보다 앞에 서고 칸 옆 문구를 다시 적지 않는다.
    const html = container.innerHTML;
    expect(summary()?.parentElement?.tagName).toBe('FORM');
    expect(html.indexOf('data-slot="form-error-summary"')).toBeLessThan(
      html.indexOf('id="admin-profile-name"'),
    );
    expect(summary()?.textContent).not.toContain('이름을 입력해 주세요.');
    // 요약은 포커스를 가져가지 않는다.
    expect(document.activeElement?.id).toBe('admin-profile-name');
  });

  it('학과의 선택 상자와 「기타」 입력이 함께 틀려도 오류 한 줄로 센다', async () => {
    await render();
    await click('프로필 수정');
    await type('#admin-profile-name', '');
    await choose('#admin-profile-department', '__OTHER__');
    await click('저장');

    // aria-invalid 칸은 셋(이름·학과 선택·기타 입력)이지만 보이는 오류 줄은 둘이다.
    expect(container.querySelectorAll('[aria-invalid="true"]')).toHaveLength(3);
    expect(visibleFieldErrorCount()).toBe(2);
    expect(summary()?.textContent).toBe('고칠 칸이 2개 있습니다');
  });

  it('칸 오류가 하나면 요약 없이 칸 옆 오류와 포커스만 쓴다 — 첫 칸이 아니어도 그 칸으로 간다', async () => {
    await render();
    await click('프로필 수정');
    await type('#admin-profile-student-id', '12');
    await click('저장');

    expect(visibleFieldErrorCount()).toBe(1);
    expect(summary()).toBeNull();
    expect(document.activeElement?.id).toBe('admin-profile-student-id');
  });

  it('이미 오류가 보이는 채로 다시 저장해도 첫 오류 칸으로 돌아간다', async () => {
    await render();
    await click('프로필 수정');
    await type('#admin-profile-student-id', '12');
    await click('저장');
    await act(async () => {
      button('저장').focus();
    });
    await click('저장');

    expect(document.activeElement?.id).toBe('admin-profile-student-id');
  });

  it('저장 버튼 위 서버 실패 경고는 세지 않는다', async () => {
    // 서버가 거절해 경고가 선 채로 이름을 비운다 — 이 폼은 입력마다 다시 판정하므로
    // 이름 오류가 바로 보이고 경고도 남는다. 보이는 칸 오류는 한 줄뿐이라 요약이 없다.
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
    await render();
    await click('프로필 수정');
    await type('#admin-profile-student-id', '269999');
    await click('저장');
    await type('#admin-profile-name', '');

    expect(container.textContent).toContain(
      '이미 다른 사용자가 사용 중인 학번이라 수정할 수 없습니다.',
    );
    expect(visibleFieldErrorCount()).toBe(1);
    expect(summary()).toBeNull();
  });

  it('저장을 누르기 전에는 오류값이 둘이어도 요약을 그리지 않는다', async () => {
    await render();
    await click('프로필 수정');
    await type('#admin-profile-name', '');
    await type('#admin-profile-student-id', '');

    expect(visibleFieldErrorCount()).toBe(0);
    expect(summary()).toBeNull();
  });
});

describe('저장 — 바뀐 필드만 담아 patchAdminUserProfile을 부른다', () => {
  it('바뀐 게 없으면 API를 부르지 않고 바로 보기 모드로 돌아간다', async () => {
    await render();
    await click('프로필 수정');
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
    await click('프로필 수정');
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
    await click('프로필 수정');
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
