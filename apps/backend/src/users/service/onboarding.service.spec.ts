import type {
  OnboardingRepositoryPort,
  OnboardingTransactionStore,
} from '../domain/onboarding-store';
import { UsersOnboardingService } from './onboarding.service';

function harness() {
  const updateSelectedMemberKind = jest.fn();
  const requestStaffAccess = jest.fn();
  const findUserByGithubId = jest.fn();
  const findLatestRequest = jest.fn();
  const store: OnboardingTransactionStore = {
    findUserByGithubId: jest.fn(),
    updateSelectedMemberKind,
    findPendingRequest: jest.fn(),
    findLatestRequest: jest.fn(),
    createPendingRequest: jest.fn(),
    requestStaffAccess,
  };
  const withTransaction = jest.fn();
  const repository: OnboardingRepositoryPort = {
    withTransaction<T>(
      operation: (transaction: OnboardingTransactionStore) => Promise<T>,
    ): Promise<T> {
      withTransaction(operation);
      return operation(store);
    },
    findUserByGithubId,
    findLatestRequest,
  };
  return {
    service: new UsersOnboardingService(repository),
    store,
    updateSelectedMemberKind,
    requestStaffAccess,
    findUserByGithubId,
    findLatestRequest,
    withTransaction,
  };
}

describe('UsersOnboardingService transaction capability', () => {
  it('keeps the caller operation in one repository-owned transaction with the same store', async () => {
    const {
      service,
      store,
      withTransaction,
      updateSelectedMemberKind,
      requestStaffAccess,
    } = harness();
    const operation = jest.fn(
      async (transaction: OnboardingTransactionStore) => {
        await transaction.updateSelectedMemberKind('user-id', 'STAFF');
        return transaction.requestStaffAccess({
          id: 'user-id',
          memberKind: 'STAFF',
          hasStaffAccess: false,
        });
      },
    );
    requestStaffAccess.mockResolvedValue({ requestStatus: 'PENDING' });

    await expect(service.withTransaction(operation)).resolves.toEqual({
      requestStatus: 'PENDING',
    });
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(withTransaction).toHaveBeenCalledWith(operation);
    expect(operation).toHaveBeenCalledWith(store);
    expect(updateSelectedMemberKind.mock.invocationCallOrder[0]).toBeLessThan(
      requestStaffAccess.mock.invocationCallOrder[0]!,
    );
  });

  it('propagates callback failures to the repository transaction without retrying or swallowing', async () => {
    const { service, withTransaction } = harness();
    const error = new Error('request write failed');
    const operation = jest.fn().mockRejectedValue(error);
    await expect(service.withTransaction(operation)).rejects.toBe(error);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('preserves missing-user and request read failures', async () => {
    const { service, findUserByGithubId, findLatestRequest } = harness();
    findUserByGithubId.mockResolvedValue(null);
    const error = new Error('request read failed');
    findLatestRequest.mockRejectedValue(error);
    await expect(service.findUserByGithubId(42n)).resolves.toBeNull();
    expect(findUserByGithubId).toHaveBeenCalledWith(42n);
    await expect(service.findLatestRequest('user-id')).rejects.toBe(error);
    expect(findLatestRequest).toHaveBeenCalledWith('user-id');
  });
});
