import type { AuthenticatedRequest } from '../auth/session.guard';
import { LOGIN_HISTORY_EVENTS } from './domain/login-history';
import { LoginHistoryController } from './login-history.controller';
import { LoginHistoryService } from './login-history.service';

const syntheticUser = {
  id: 'synthetic-user-id',
  githubId: 424242n,
  nickname: 'synthetic-login',
  name: null,
  avatarUrl: null,
  role: null,
};

describe('LoginHistoryController', () => {
  const findMine = jest.fn();
  const controller = new LoginHistoryController({
    findMine,
  } as unknown as LoginHistoryService);
  const request = {
    principal: syntheticUser,
    sessionGithubId: syntheticUser.githubId,
  } as unknown as AuthenticatedRequest;

  beforeEach(() => {
    findMine.mockReset();
    findMine.mockResolvedValue({
      items: [
        {
          id: 'synthetic-history-id',
          event: LOGIN_HISTORY_EVENTS.LOGIN,
          provider: 'github',
          success: true,
          loginAt: new Date('2026-07-21T00:00:00.000Z'),
        },
      ],
      page: 1,
      size: 20,
      total: 1,
    });
  });

  it('세션 사용자의 DB ID로만 페이지 조회한다', async () => {
    // Given: 인증 경계가 active principal을 붙인 요청이다.
    // When: 본인 로그인 이력을 조회한다.
    const result = await controller.findMine(request, { page: 1, size: 20 });

    // Then: principal의 DB 사용자 ID만 서비스에 전달한다.
    expect(findMine).toHaveBeenCalledWith(syntheticUser.id, 1, 20);
    expect(result).toEqual({
      items: [
        {
          id: 'synthetic-history-id',
          event: LOGIN_HISTORY_EVENTS.LOGIN,
          provider: 'github',
          success: true,
          loginAt: '2026-07-21T00:00:00.000Z',
        },
      ],
      page: 1,
      size: 20,
      total: 1,
    });
  });

  it('feature controller에서 쿠키나 계정을 다시 해석하지 않는다', async () => {
    // Given: 세션 cookie 없이 typed principal만 있는 요청이다.
    // When: 본인 로그인 이력을 조회한다.
    await controller.findMine(request, { page: 1, size: 20 });

    // Then: principal의 내부 ID로 서비스 호출이 완료된다.
    expect(findMine).toHaveBeenCalledWith(syntheticUser.id, 1, 20);
  });
});
