import { PrismaService } from '../prisma/prisma.service';
import { StudentApplicationManagementRepository } from './student-application-management.repository';

describe('StudentApplicationManagementRepository ownership', () => {
  it('???? ??? ??? ?? ?? ???? ????', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'application-1' });
    const prisma = { application: { findFirst } };
    const repository = new StudentApplicationManagementRepository(
      prisma as unknown as PrismaService,
    );

    await repository.findOwnedApplication('program-1', 'student-1');

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          programId: 'program-1',
          OR: [
            { applicantId: 'student-1' },
            { team: { leaderId: 'student-1' } },
            { team: { members: { some: { userId: 'student-1' } } } },
          ],
        },
      }),
    );
  });

  it('?? ??? ??? null? ????', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = { application: { findFirst } };
    const repository = new StudentApplicationManagementRepository(
      prisma as unknown as PrismaService,
    );

    await expect(
      repository.findOwnedApplication('program-1', 'outsider-1'),
    ).resolves.toBeNull();
  });
});
