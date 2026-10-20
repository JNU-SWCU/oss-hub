import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import {
  fetchUnreadTeamDeletionNotices,
  markTeamDeletionNoticeRead,
} from './team-deletion-notices-api';

const notice = {
  id: 'deleted-notice',
  teamId: 'deleted-team',
  teamName: '합성 팀',
  programId: 'seed:e2e:deadline-digest:program',
  programName: '합성 프로그램',
  message: '중복 팀 정리',
  deletedAt: '2026-08-09T00:00:00.000Z',
};
afterEach(() => vi.unstubAllGlobals());

describe('team deletion notice API', () => {
  it('reads the historical payload without requiring a live team lookup', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify([notice]), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchUnreadTeamDeletionNotices()).toEqual([notice]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      apiPath('users/me/notifications/team-deletions'),
    );
  });

  it.each([
    { ...notice, programId: '' },
    { ...notice, programId: '.' },
    { ...notice, programId: '..' },
    { ...notice, deletedAt: 'invalid-date' },
    { ...notice, message: 1 },
  ])('rejects an unsafe or malformed notice', async (invalid) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify([invalid]), { status: 200 }),
        ),
    );

    await expect(fetchUnreadTeamDeletionNotices()).rejects.toThrow(TypeError);
  });

  it('acknowledges only the selected notification id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await markTeamDeletionNoticeRead('selected/notice');

    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('users/me/notifications/team-deletions/selected%2Fnotice/read'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
