import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { focusManager } from '@tanstack/react-query';
import { renderWithQuery } from '../../../../test-support/render-with-query';
import { useReceivedInvitationsQuery } from './queries';
import { listReceivedInvitations } from './team-invitation-api';

vi.mock('./team-invitation-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./team-invitation-api')>()),
  listReceivedInvitations: vi.fn(),
}));

let view: Awaited<ReturnType<typeof renderWithQuery>> | undefined;

function Invitations() {
  const query = useReceivedInvitationsQuery('student');
  return <span>{query.data?.length ?? 'loading'}</span>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(listReceivedInvitations).mockReset().mockResolvedValue([]);
  focusManager.setFocused(true);
});

afterEach(async () => {
  await view?.unmount();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

it('같은 계정의 동시 구독은 받은 초대를 한 번만 조회한다', async () => {
  view = await renderWithQuery(
    <>
      <Invitations />
      <Invitations />
    </>,
  );
  expect(listReceivedInvitations).toHaveBeenCalledTimes(1);
});

it('포커스 복귀와 60초 주기로 받은 초대를 갱신한다', async () => {
  view = await renderWithQuery(<Invitations />);
  expect(listReceivedInvitations).toHaveBeenCalledTimes(1);

  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  expect(listReceivedInvitations).toHaveBeenCalledTimes(2);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(listReceivedInvitations).toHaveBeenCalledTimes(3);
});

it('백그라운드에서는 초대 폴링을 멈춘다', async () => {
  view = await renderWithQuery(<Invitations />);

  await act(async () => {
    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(listReceivedInvitations).toHaveBeenCalledTimes(1);
});
