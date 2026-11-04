import { ApplicationPreparationsService } from './application-preparations.service';
import type { ApplicationsRepository } from './applications.repository';

describe('retired Preparation fallback', () => {
  function serviceWith(actor: { id: string } | null) {
    const findUnique = jest.fn().mockResolvedValue(actor);
    const repository = {
      findActiveStudentByGithubId: findUnique,
    } as unknown as ApplicationsRepository;
    return {
      service: new ApplicationPreparationsService(repository),
      findUnique,
    };
  }

  it('returns no preparation without accessing either retired table', async () => {
    const { service, findUnique } = serviceWith({ id: 'student' });
    await expect(service.get(4242n)).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalledWith(4242n);
  });

  it('rejects an account outside the active student boundary', async () => {
    await expect(serviceWith(null).service.get(4242n)).rejects.toMatchObject({
      errorCode: { status: 403, code: 'APP_008' },
    });
  });
});
