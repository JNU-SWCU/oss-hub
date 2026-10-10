import {
  LOGIN_HISTORY_EVENTS,
  type LoginHistoryPage,
} from '../domain/login-history';
import { LoginHistoryRepository } from '../repository/login-history.repository';
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
    await service.recordLogin('synthetic-user-id');

    expect(create).toHaveBeenCalledWith(
      'synthetic-user-id',
      LOGIN_HISTORY_EVENTS.LOGIN,
    );
  });

  it('로그아웃을 LOGOUT 이벤트로 기록한다', async () => {
    await service.recordLogout('synthetic-user-id');

    expect(create).toHaveBeenCalledWith(
      'synthetic-user-id',
      LOGIN_HISTORY_EVENTS.LOGOUT,
    );
  });

  it('본인 이력 조회의 페이지 조건을 저장소에 전달한다', async () => {
    const result = await service.findMine('synthetic-user-id', 2, 10);

    expect(findPage).toHaveBeenCalledWith('synthetic-user-id', 2, 10);
    expect(result).toBe(emptyPage);
  });
});
