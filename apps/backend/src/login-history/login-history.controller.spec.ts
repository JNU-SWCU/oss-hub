import { DomainException } from '../common/error-code';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.enum';
import { AuthService } from '../auth/auth.service';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { LOGIN_HISTORY_EVENTS } from './domain/login-history';
import { LoginHistoryController } from './login-history.controller';
import { LoginHistoryService } from './login-history.service';

const syntheticUser = {
  id: 'synthetic-user-id',
  githubId: 424242n,
  login: 'synthetic-login',
  name: null,
  avatarUrl: null,
  role: null,
};

describe('LoginHistoryController', () => {
  const getMe = jest.fn();
  const findMine = jest.fn();
  const controller = new LoginHistoryController(
    { getMe } as unknown as AuthService,
    { findMine } as unknown as LoginHistoryService,
  );
  const request = {
    sessionGithubId: syntheticUser.githubId,
  } as AuthenticatedRequest;

  beforeEach(() => {
    getMe.mockReset();
    findMine.mockReset();
    getMe.mockResolvedValue(syntheticUser);
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
    // Given: 인증된 사용자가 첫 페이지를 요청한다.

    // When: 본인 로그인 이력을 조회한다.
    const result = await controller.findMine(request, { page: 1, size: 20 });

    // Then: 세션 신원을 DB 사용자로 해석해 그 ID만 조회한다.
    expect(getMe).toHaveBeenCalledWith(syntheticUser.githubId);
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

  it('세션 사용자 레코드가 없으면 401을 유지하고 이력을 조회하지 않는다', async () => {
    // Given: 토큰의 사용자가 DB에 없다.
    getMe.mockRejectedValue(
      new DomainException(AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED]),
    );

    // When: 본인 로그인 이력을 조회한다.
    const action = controller.findMine(request, { page: 1, size: 20 });

    // Then: 기존 인증 오류를 그대로 반환한다.
    await expect(action).rejects.toMatchObject({
      errorCode: { code: AuthErrorCode.UNAUTHENTICATED, status: 401 },
    });
    expect(findMine).not.toHaveBeenCalled();
  });
});
