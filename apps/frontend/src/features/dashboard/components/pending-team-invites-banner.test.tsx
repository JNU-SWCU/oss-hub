// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PendingTeamInvitesBanner } from './pending-team-invites-banner';
import type { PendingTeamInviteView } from '../types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const invite: PendingTeamInviteView = {
  invitationId: 'invitation-1',
  teamId: 'team-1',
  programId: 'program-1',
  programName: '캡스톤 2026',
  teamName: '오픈소스팀',
};

describe('PendingTeamInvitesBanner', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('항목이 없으면 아무것도 렌더하지 않는다', async () => {
    await act(async () =>
      root.render(
        <PendingTeamInvitesBanner
          items={[]}
          respondingInvitationId={null}
          actionError={null}
          onAccept={() => {}}
          onDecline={() => {}}
        />,
      ),
    );

    expect(container.textContent).toBe('');
  });

  it('수락 버튼을 누르면 해당 초대 id로 onAccept를 호출한다', async () => {
    const onAccept = vi.fn();

    await act(async () =>
      root.render(
        <PendingTeamInvitesBanner
          items={[invite]}
          respondingInvitationId={null}
          actionError={null}
          onAccept={onAccept}
          onDecline={() => {}}
        />,
      ),
    );

    const acceptButton = container.querySelector(
      '[aria-label="오픈소스팀 팀 초대 수락"]',
    );
    expect(acceptButton).not.toBeNull();
    await act(async () => {
      acceptButton?.dispatchEvent(
        new Event('click', { bubbles: true, cancelable: true }),
      );
    });

    expect(onAccept).toHaveBeenCalledWith('invitation-1');
  });

  it('거절 버튼을 누르면 해당 초대 id로 onDecline을 호출한다', async () => {
    const onDecline = vi.fn();

    await act(async () =>
      root.render(
        <PendingTeamInvitesBanner
          items={[invite]}
          respondingInvitationId={null}
          actionError={null}
          onAccept={() => {}}
          onDecline={onDecline}
        />,
      ),
    );

    const declineButton = container.querySelector(
      '[aria-label="오픈소스팀 팀 초대 거절"]',
    );
    await act(async () => {
      declineButton?.dispatchEvent(
        new Event('click', { bubbles: true, cancelable: true }),
      );
    });

    expect(onDecline).toHaveBeenCalledWith('invitation-1');
  });

  it('처리 중인 초대는 두 버튼 모두 비활성화한다', async () => {
    await act(async () =>
      root.render(
        <PendingTeamInvitesBanner
          items={[invite]}
          respondingInvitationId="invitation-1"
          actionError={null}
          onAccept={() => {}}
          onDecline={() => {}}
        />,
      ),
    );

    const acceptButton = container.querySelector(
      '[aria-label="오픈소스팀 팀 초대 수락"]',
    );
    const declineButton = container.querySelector(
      '[aria-label="오픈소스팀 팀 초대 거절"]',
    );
    expect(acceptButton?.hasAttribute('disabled')).toBe(true);
    expect(declineButton?.hasAttribute('disabled')).toBe(true);
  });

  it('요청 실패 메시지를 보여준다', async () => {
    await act(async () =>
      root.render(
        <PendingTeamInvitesBanner
          items={[invite]}
          respondingInvitationId={null}
          actionError="합성 오류 메시지"
          onAccept={() => {}}
          onDecline={() => {}}
        />,
      ),
    );

    expect(container.textContent).toContain('합성 오류 메시지');
  });
});
