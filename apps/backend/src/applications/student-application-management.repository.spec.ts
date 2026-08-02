import { AccountStatus, ApplicationStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StudentApplicationManagementRepository } from './student-application-management.repository';
const EXPECTED_APPLICATION_SELECT = {
  id: true,
  programId: true,
  status: true,
  teamId: true,
  applicant: {
    select: {
      id: true,
      name: true,
      nickname: true,
      profile: { select: { name: true } },
    },
  },
  answers: true,
  submittedAt: true,
  updatedAt: true,
  isRepositoryPublicationPlanned: true,
} as const;

describe('StudentApplicationManagementRepository ownership', () => {
  it('includes team participation when finding the owned application', async () => {
    // Given
    const findFirst = jest.fn().mockResolvedValue(
      applicationRow({
        applicant: {
          id: 'applicant-1',
          name: 'Legacy Applicant',
          nickname: 'synthetic-applicant',
          profile: null,
        },
      }),
    );
    const prisma = createPrisma({ application: { findFirst } });
    const repository = new StudentApplicationManagementRepository(prisma);

    // When
    await repository.findOwnedApplication('program-1', 'student-1');

    // Then
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

  it('returns null when the student does not own the application', async () => {
    // Given
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = createPrisma({ application: { findFirst } });
    const repository = new StudentApplicationManagementRepository(prisma);

    // When / Then
    await expect(
      repository.findOwnedApplication('program-1', 'outsider-1'),
    ).resolves.toBeNull();
  });

  it('uses profile name for owned application applicant when profile exists', async () => {
    // Given
    const row = applicationRow({
      applicant: {
        id: 'applicant-1',
        name: 'Legacy Applicant',
        nickname: 'synthetic-applicant',
        profile: { name: 'Profile Applicant' },
      },
    });
    const findFirst = jest.fn().mockResolvedValue(row);
    const prisma = createPrisma({ application: { findFirst } });
    const repository = new StudentApplicationManagementRepository(prisma);

    // When
    const result = await repository.findOwnedApplication(
      'program-1',
      'student-1',
    );

    // Then
    expect(result?.applicant).toEqual({
      id: 'applicant-1',
      name: 'Profile Applicant',
      nickname: 'synthetic-applicant',
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: EXPECTED_APPLICATION_SELECT,
      }),
    );
  });

  it('keeps legacy name for owned application applicant when profile is absent', async () => {
    // Given
    const row = applicationRow({
      applicant: {
        id: 'applicant-1',
        name: 'Legacy Applicant',
        nickname: 'synthetic-applicant',
        profile: null,
      },
    });
    const findFirst = jest.fn().mockResolvedValue(row);
    const prisma = createPrisma({ application: { findFirst } });
    const repository = new StudentApplicationManagementRepository(prisma);

    // When
    const result = await repository.findOwnedApplication(
      'program-1',
      'student-1',
    );

    // Then
    expect(result?.applicant.name).toBe('Legacy Applicant');
  });

  it('uses profile name for updated pending application applicant when profile exists', async () => {
    // Given
    const row = applicationRow({
      applicant: {
        id: 'applicant-1',
        name: null,
        nickname: 'synthetic-applicant',
        profile: { name: 'Profile Applicant' },
      },
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest.fn().mockResolvedValue(row);
    const transaction = { application: { updateMany, findUnique } };
    const transactionRunner: PrismaTransactionRunner = (operation) =>
      operation(transaction);
    const prisma = createPrisma({ $transaction: transactionRunner });
    const repository = new StudentApplicationManagementRepository(prisma);

    // When
    const result = await repository.updatePendingApplication({
      applicationId: 'application-1',
      answers: { title: 'Updated title', summary: 'Updated summary' },
      applicationTemplateVersion: 1,
    });

    // Then
    expect(result?.applicant.name).toBe('Profile Applicant');
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'application-1' },
      select: EXPECTED_APPLICATION_SELECT,
    });
  });

  it('resolves active student names from profile before legacy columns', async () => {
    // Given
    const findFirst = jest.fn().mockResolvedValue({
      id: 'student-1',
      name: 'Legacy Student',
      nickname: 'synthetic-student',
      profile: { name: 'Profile Student' },
    });
    const prisma = createPrisma({ user: { findFirst } });
    const repository = new StudentApplicationManagementRepository(prisma);

    // When
    const result = await repository.findActiveStudentByGithubId(4242n);

    // Then
    expect(result).toEqual({
      id: 'student-1',
      name: 'Profile Student',
      nickname: 'synthetic-student',
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        githubId: 4242n,
        accountStatus: AccountStatus.ACTIVE,
        role: Role.STUDENT,
      },
      select: {
        id: true,
        nickname: true,
        name: true,
        profile: { select: { name: true } },
      },
    });
  });
});

type ApplicationRowOptions = {
  readonly applicant: {
    readonly id: string;
    readonly name: string | null;
    readonly nickname: string;
    readonly profile: { readonly name: string } | null;
  };
};

function applicationRow(options: ApplicationRowOptions) {
  return {
    id: 'application-1',
    programId: 'program-1',
    status: ApplicationStatus.SUBMITTED,
    teamId: null,
    applicant: options.applicant,
    answers: {
      applicantName: 'Original Applicant',
      title: 'Original title',
      summary: 'Original summary',
    },
    submittedAt: new Date('2026-07-10T00:00:00.000Z'),
    updatedAt: new Date('2026-07-10T00:00:00.000Z'),
    isRepositoryPublicationPlanned: true,
  };
}

type TransactionStub = {
  readonly application: {
    readonly findUnique: jest.Mock;
    readonly updateMany: jest.Mock;
  };
};

type PrismaTransactionRunner = <T>(
  operation: (transaction: TransactionStub) => Promise<T>,
) => Promise<T>;

type PrismaStubInput = {
  readonly user?: { readonly findFirst?: jest.Mock };
  readonly application?: {
    readonly findFirst?: jest.Mock;
    readonly findUnique?: jest.Mock;
    readonly updateMany?: jest.Mock;
    readonly deleteMany?: jest.Mock;
  };
  readonly program?: { readonly findUnique?: jest.Mock };
  readonly $transaction?: PrismaTransactionRunner;
};

function createPrisma(input: PrismaStubInput): PrismaService {
  const application = {
    findFirst: input.application?.findFirst ?? jest.fn(),
    findUnique: input.application?.findUnique ?? jest.fn(),
    updateMany: input.application?.updateMany ?? jest.fn(),
    deleteMany: input.application?.deleteMany ?? jest.fn(),
  };
  const fallbackTransaction: PrismaTransactionRunner = (operation) =>
    operation({ application });
  const prisma = new PrismaService();
  Object.defineProperties(prisma, {
    user: { value: { findFirst: input.user?.findFirst ?? jest.fn() } },
    application: { value: application },
    program: { value: { findUnique: input.program?.findUnique ?? jest.fn() } },
    $transaction: { value: input.$transaction ?? fallbackTransaction },
  });
  return prisma;
}
