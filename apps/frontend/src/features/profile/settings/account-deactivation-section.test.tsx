// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ deactivateMyAccount: vi.fn() }));
vi.mock('./account-deactivation-api', async () => {
  const actual = await vi.importActual<
    typeof import('./account-deactivation-api')
  >('./account-deactivation-api');
  return { ...actual, deactivateMyAccount: api.deactivateMyAccount };
});

import { AccountDeactivationSection } from './components/account-deactivation-section';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

afterEach(() => {
  api.deactivateMyAccount.mockReset();
  vi.restoreAllMocks();
});

describe('AccountDeactivationSection', () => {
  it('explains the immediate block, retained records, and admin-only recovery', () => {
    const html = renderToStaticMarkup(
      <AccountDeactivationSection hasAdminAccess={false} />,
    );
    const rendered = document.createElement('div');
    rendered.innerHTML = html;

    expect(html).toContain('계정 관리');
    expect(html).toContain('계정 비활성화');
    expect(rendered.textContent).toContain(
      '제출물과 동의·활동 이력은 삭제되지 않습니다',
    );
    expect(html).toContain('재로그인이 차단됩니다');
    expect(html).toContain('관리자에게 재활성화를 요청');
  });

  it('warns an admin about the final-admin safety guard', () => {
    const html = renderToStaticMarkup(
      <AccountDeactivationSection hasAdminAccess />,
    );

    expect(html).toContain('마지막 활성 관리자');
  });

  it('requires confirmation, blocks duplicate submission, and leaves only after success', async () => {
    let finish!: () => void;
    api.deactivateMyAccount.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({ accountStatus: 'DEACTIVATED' });
      }),
    );
    const onDeactivated = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AccountDeactivationSection
          hasAdminAccess={false}
          onDeactivated={onDeactivated}
        />,
      );
    });
    const trigger = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '계정 비활성화',
    );
    if (!trigger) throw new TypeError('deactivation trigger not found');
    await act(async () => trigger.click());

    const confirm = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '비활성화하고 로그아웃',
    );
    if (!confirm) throw new TypeError('deactivation confirmation not found');
    await act(async () => confirm.click());

    expect(api.deactivateMyAccount).toHaveBeenCalledOnce();
    expect(onDeactivated).not.toHaveBeenCalled();
    expect(confirm.disabled).toBe(true);
    expect(document.body.textContent).toContain('비활성화 중…');

    await act(async () => confirm.click());
    expect(api.deactivateMyAccount).toHaveBeenCalledOnce();

    await act(async () => finish());
    expect(onDeactivated).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });
});
