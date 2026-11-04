import { ApplicationPreparationsService } from './application-preparations.service';
import type { ApplicationPreparationsRepository } from './application-preparations.repository';

describe('ApplicationPreparationsService.get', () => {
  function serviceWith(found: unknown) {
    const get = jest.fn().mockResolvedValue(found);
    const repository = {
      findActor: jest.fn().mockResolvedValue('user-1'),
      get,
    } as unknown as ApplicationPreparationsRepository;
    return { service: new ApplicationPreparationsService(repository), get };
  }

  it('준비가 없으면 없음(null)을 컨트롤러에 넘긴다', async () => {
    const { service, get } = serviceWith(null);

    await expect(service.get(4242n, 'program-1')).resolves.toBeNull();
    expect(get).toHaveBeenCalledWith('program-1', 'user-1');
  });

  it('준비가 있으면 조회 결과를 그대로 넘긴다', async () => {
    const preparation = { id: 'team-1' };
    const { service } = serviceWith(preparation);

    await expect(service.get(4242n, 'program-1')).resolves.toBe(preparation);
  });
});
