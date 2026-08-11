import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '@/lib/api-client';
import {
  acceptTeamInvitation,
  declineTeamInvitation,
  fetchPendingTeamInviteViews,
} from './team-invitations-api';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
}));

describe('fetchPendingTeamInviteViews', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  it('0건이면 빈 배열을 돌려준다', async () => {
    vi.mocked(apiClient).mockResolvedValueOnce([]);

    await expect(fetchPendingTeamInviteViews()).resolves.toEqual([]);
    expect(apiClient).toHaveBeenCalledOnce();
    expect(apiClient).toHaveBeenCalledWith('team-invitations/received');
  });

  it('PENDING이 아닌 초대는 걸러내고 나머지는 프로그램·팀 이름을 붙인다', async () => {
    vi.mocked(apiClient).mockImplementation(async (path: string) => {
      if (path === 'team-invitations/received') {
        return [
          {
            id: 'invitation-1',
            teamId: 'team-1',
            programId: 'program-1',
            status: 'PENDING',
          },
          {
            id: 'invitation-2',
            teamId: 'team-2',
            programId: 'program-1',
            status: 'DECLINED',
          },
        ];
      }
      if (path === 'programs/program-1') {
        return { id: 'program-1', name: '캡스톤 2026' };
      }
      if (path === 'programs/program-1/overview/teams') {
        return [
          { teamId: 'team-1', name: '오픈소스팀', memberCount: 2, members: [] },
        ];
      }
      throw new Error(`unexpected path: ${path}`);
    });

    await expect(fetchPendingTeamInviteViews()).resolves.toEqual([
      {
        invitationId: 'invitation-1',
        teamId: 'team-1',
        programId: 'program-1',
        programName: '캡스톤 2026',
        teamName: '오픈소스팀',
      },
    ]);
  });

  it('이름 조회가 실패해도 초대 자체는 null 이름으로 남는다', async () => {
    vi.mocked(apiClient).mockImplementation(async (path: string) => {
      if (path === 'team-invitations/received') {
        return [
          {
            id: 'invitation-1',
            teamId: 'team-1',
            programId: 'program-1',
            status: 'PENDING',
          },
        ];
      }
      throw new Error('synthetic network failure');
    });

    await expect(fetchPendingTeamInviteViews()).resolves.toEqual([
      {
        invitationId: 'invitation-1',
        teamId: 'team-1',
        programId: 'program-1',
        programName: null,
        teamName: null,
      },
    ]);
  });

  it('목록 조회 자체가 실패하면 던진다', async () => {
    vi.mocked(apiClient).mockRejectedValueOnce(
      new Error('synthetic network failure'),
    );

    await expect(fetchPendingTeamInviteViews()).rejects.toThrow(
      'synthetic network failure',
    );
  });

  it('잘못된 응답 형식을 어댑터 경계에서 거부한다', async () => {
    vi.mocked(apiClient).mockResolvedValueOnce([{ id: 'invitation-1' }]);

    await expect(fetchPendingTeamInviteViews()).rejects.toThrow(
      '받은 팀 초대 응답 형식이 올바르지 않습니다.',
    );
  });
});

describe('acceptTeamInvitation / declineTeamInvitation', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  it('수락은 accept endpoint를 POST로 호출한다', async () => {
    vi.mocked(apiClient).mockResolvedValueOnce(undefined);

    await acceptTeamInvitation('invitation-1');

    expect(apiClient).toHaveBeenCalledWith(
      'team-invitations/invitation-1/accept',
      { method: 'POST' },
    );
  });

  it('거절은 decline endpoint를 POST로 호출한다', async () => {
    vi.mocked(apiClient).mockResolvedValueOnce(undefined);

    await declineTeamInvitation('invitation-1');

    expect(apiClient).toHaveBeenCalledWith(
      'team-invitations/invitation-1/decline',
      { method: 'POST' },
    );
  });
});
