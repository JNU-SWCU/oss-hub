import {
  LOGIN_HISTORY_EVENTS,
  type LoginHistoryPage,
} from './domain/login-history';
import { LoginHistoryRepository } from './login-history.repository';
import { LoginHistoryService } from './login-history.service';

const emptyPage: LoginHistoryPage = {
  items: [],
  page: 1,
  size: 20,
  total: 0,
};

describe('LoginHistoryService', () => {
  const create = jest.fn();
  const findPage = jest.fn();
  const service = new LoginHistoryService({
    create,
    findPage,
  } as unknown as LoginHistoryRepository);

  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue(undefined);
    findPage.mockReset();
    findPage.mockResolvedValue(emptyPage);
  });

  it('로그인 성공을 GitHub provider의 LOGIN 이벤트로 기록한다', async () => {
    // Given: 로그인에 성공한 사용자 ID가 있다.

    // When: 성공 로그인을 기록한다.
    await service.recordLogin('synthetic-user-id');

    // Then: LOGIN 이벤트 한 건을 저장한다.
    expect(create).toHaveBeenCalledWith(
      'synthetic-user-id',
      LOGIN_HISTORY_EVENTS.LOGIN,
    );
  });

  it('로그아웃을 LOGOUT 이벤트로 기록한다', async () => {
    // Given: 로그아웃한 사용자 ID가 있다.

    // When: 로그아웃을 기록한다.
    await service.recordLogout('synthetic-user-id');

    // Then: LOGOUT 이벤트 한 건을 저장한다.
    expect(create).toHaveBeenCalledWith(
      'synthetic-user-id',
      LOGIN_HISTORY_EVENTS.LOGOUT,
    );
  });

  it('본인 이력 조회의 페이지 조건을 저장소에 전달한다', async () => {
    // Given: 인증된 사용자의 페이지 요청이 있다.

    // When: 본인 이력을 조회한다.
    const result = await service.findMine('synthetic-user-id', 2, 10);

    // Then: 사용자 ID와 페이지 조건이 그대로 적용된다.
    expect(findPage).toHaveBeenCalledWith('synthetic-user-id', 2, 10);
    expect(result).toBe(emptyPage);
  });
});
