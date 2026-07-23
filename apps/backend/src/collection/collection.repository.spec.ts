import { AccountStatus, Role, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionRepository } from './collection.repository';

function userRow(): User {
  return {
    id: 'synthetic-188-collection-user',
    githubId: 424242n,
    login: 'synthetic-188-collection',
    name: null,
    studentId: null,
    department: null,
    avatarUrl: null,
    accountStatus: AccountStatus.ACTIVE,
    role: Role.STUDENT,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('CollectionRepository.findUserByGithubId', () => {
  it('SELF 수집 사용자는 ACTIVE 계정만 조회한다', async () => {
    const findUnique = jest.fn().mockResolvedValue(userRow());
    const repository = new CollectionRepository({
      user: { findUnique },
    } as unknown as PrismaService);

    await expect(repository.findUserByGithubId(424242n)).resolves.toEqual({
      githubId: 424242n,
      login: 'synthetic-188-collection',
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        githubId: 424242n,
        accountStatus: AccountStatus.ACTIVE,
      },
    });
  });

  it('비활성 계정은 SELF 수집 주체로 해석하지 않는다', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const repository = new CollectionRepository({
      user: { findUnique },
    } as unknown as PrismaService);

    await expect(repository.findUserByGithubId(424242n)).resolves.toBeNull();
  });
});
