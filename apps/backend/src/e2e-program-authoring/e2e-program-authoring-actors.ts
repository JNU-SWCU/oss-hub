import { AccountStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type E2eProgramAuthoringActors = {
  readonly staffId: string;
  readonly staffGithubId: bigint;
  readonly studentId: string;
  readonly studentGithubId: bigint;
  readonly foreignStudentId: string;
  readonly foreignStudentGithubId: bigint;
  readonly prefix: string;
};

export async function ensureE2eProgramAuthoringActors(
  prisma: PrismaService,
  actors: E2eProgramAuthoringActors,
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.user.upsert({
      where: { id: actors.staffId },
      create: {
        id: actors.staffId,
        githubId: actors.staffGithubId,
        nickname: 'e2e-program-authoring-staff',
        accountStatus: AccountStatus.ACTIVE,
        role: Role.STAFF,
      },
      update: {
        nickname: 'e2e-program-authoring-staff',
        accountStatus: AccountStatus.ACTIVE,
        role: Role.STAFF,
      },
    });
    await transaction.user.upsert({
      where: { id: actors.studentId },
      create: {
        id: actors.studentId,
        githubId: actors.studentGithubId,
        nickname: 'e2e-program-authoring-student',
        name: 'E2E Student',
        studentId: '260001',
        department: 'E2E Department',
        notificationEmail: 'e2e-program-authoring-student@fixture.invalid',
        notifyEnabled: true,
        accountStatus: AccountStatus.ACTIVE,
        role: Role.STUDENT,
      },
      update: {
        nickname: 'e2e-program-authoring-student',
        name: 'E2E Student',
        studentId: '260001',
        department: 'E2E Department',
        notificationEmail: 'e2e-program-authoring-student@fixture.invalid',
        notifyEnabled: true,
        accountStatus: AccountStatus.ACTIVE,
      },
    });
    await transaction.user.upsert({
      where: { id: actors.foreignStudentId },
      create: {
        id: actors.foreignStudentId,
        githubId: actors.foreignStudentGithubId,
        nickname: 'e2e-program-authoring-foreign-student',
        name: 'E2E Foreign Student',
        studentId: '260002',
        department: 'E2E Department',
        notificationEmail:
          'e2e-program-authoring-foreign-student@fixture.invalid',
        notifyEnabled: true,
        accountStatus: AccountStatus.ACTIVE,
        role: Role.STUDENT,
      },
      update: {
        nickname: 'e2e-program-authoring-foreign-student',
        name: 'E2E Foreign Student',
        studentId: '260002',
        department: 'E2E Department',
        notificationEmail:
          'e2e-program-authoring-foreign-student@fixture.invalid',
        notifyEnabled: true,
        accountStatus: AccountStatus.ACTIVE,
      },
    });
  });
}
