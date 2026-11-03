import { PrismaService } from '../platform/prisma.service';
import { AdminRepository } from './admin.repository';

function harness(
  options: {
    readonly admins?: number;
    readonly histories?: number;
    readonly active?: boolean;
  } = {},
) {
  const grant = jest.fn().mockResolvedValue({});
  const history = jest.fn().mockResolvedValue({});
  const prisma = Object.assign(new PrismaService(), {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    admin: {
      count: jest.fn().mockResolvedValue(options.admins ?? 0),
      create: grant,
    },
    adminHistory: {
      count: jest.fn().mockResolvedValue(options.histories ?? 0),
      create: history,
    },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'bootstrap-user',
        accountStatus: options.active === false ? 'DEACTIVATED' : 'ACTIVE',
      }),
    },
  });
  Object.assign(prisma, {
    $transaction: <T>(operation: (transaction: PrismaService) => Promise<T>) =>
      operation(prisma),
  });
  return { repository: new AdminRepository(prisma), grant, history };
}

describe('explicit administrator bootstrap', () => {
  it('grants independent Admin and records the operator receipt without modifying identity', async () => {
    const { repository, grant, history } = harness();
    const receipt = await repository.bootstrap({
      githubId: 123n,
      operatorReceipt: 'change:123',
    });
    expect(receipt.userId).toBe('bootstrap-user');
    const timestamp: unknown = expect.any(Date);
    expect(grant).toHaveBeenCalledWith({
      data: {
        userId: 'bootstrap-user',
        origin: 'BOOTSTRAP',
        grantedAt: timestamp,
      },
    });
    expect(history).toHaveBeenCalledWith({
      data: {
        id: receipt.historyId,
        userId: 'bootstrap-user',
        event: 'GRANTED',
        source: 'BOOTSTRAP',
        occurredAt: timestamp,
        data: {
          schemaVersion: 1,
          recordKind: 'BOOTSTRAP',
          operatorReceipt: 'change:123',
        },
      },
    });
  });

  it.each([
    { admins: 1, histories: 0 },
    { admins: 0, histories: 1 },
  ])('rejects a second bootstrap with existing state %j', async (options) => {
    const { repository, grant, history } = harness(options);
    await expect(
      repository.bootstrap({ githubId: 123n, operatorReceipt: 'change:124' }),
    ).rejects.toThrow(
      'Bootstrap requires no administrator or administrator history',
    );
    expect(grant).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });

  it('does not bootstrap a deactivated account', async () => {
    const { repository, grant } = harness({ active: false });
    await expect(
      repository.bootstrap({ githubId: 123n, operatorReceipt: 'change:125' }),
    ).rejects.toThrow('Bootstrap requires an active account');
    expect(grant).not.toHaveBeenCalled();
  });

  it('propagates history failure through the transaction instead of returning a grant receipt', async () => {
    const { repository, history } = harness();
    history.mockRejectedValue(new Error('synthetic history failure'));
    await expect(
      repository.bootstrap({ githubId: 123n, operatorReceipt: 'change:126' }),
    ).rejects.toThrow('synthetic history failure');
  });
});
