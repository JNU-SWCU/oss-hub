import type { PrismaService } from '../prisma/prisma.service';
import { UsersRepository } from './users.repository';

function harness() {
  const findUnique = jest.fn();
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  return {
    findUnique,
    repository: new UsersRepository(prisma),
  };
}

describe('UsersRepository profile compatibility reads', () => {
  it('prefers UserProfile fields over stale legacy User fields', async () => {
    // Given
    const { findUnique, repository } = harness();
    findUnique.mockResolvedValue({
      id: 'user-profile-first',
      name: 'Legacy Name',
      studentId: '111111',
      department: 'Legacy Department',
      profile: {
        name: 'Profile Name',
        studentId: '222222',
        department: 'Profile Department',
      },
    });

    // When
    const result = await repository.findByGithubId(9_600_000_000_153_101n);

    // Then
    expect(result).toEqual({
      id: 'user-profile-first',
      name: 'Profile Name',
      studentId: '222222',
      department: 'Profile Department',
    });
  });

  it('falls back to legacy User fields while no UserProfile row exists', async () => {
    // Given
    const { findUnique, repository } = harness();
    findUnique.mockResolvedValue({
      id: 'user-legacy-fallback',
      name: 'Legacy Name',
      studentId: null,
      department: null,
      profile: null,
    });

    // When
    const result = await repository.findByGithubId(9_600_000_000_153_102n);

    // Then
    expect(result).toEqual({
      id: 'user-legacy-fallback',
      name: 'Legacy Name',
      studentId: null,
      department: null,
    });
  });
});
