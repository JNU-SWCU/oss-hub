import { AccountStatus } from '@prisma/client';
import { PrismaService } from '../../src/platform/prisma.service';
import { canonicalUserCreate } from '../../src/users/canonical-user-fixture';

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
        ...canonicalUserCreate({
          id: actors.staffId,
          githubId: actors.staffGithubId,
          nickname: 'e2e-program-authoring-staff',
          name: 'E2E Staff',
          department: 'E2E Program Office',
          memberKind: 'STAFF',
          hasStaffAccess: true,
        }),
        notificationEmail: 'e2e-program-authoring-staff@fixture.invalid',
        notifyEnabled: true,
        accountStatus: AccountStatus.ACTIVE,
      },
      update: {
        nickname: 'e2e-program-authoring-staff',
        notificationEmail: 'e2e-program-authoring-staff@fixture.invalid',
        notifyEnabled: true,
        accountStatus: AccountStatus.ACTIVE,
        type: 'STAFF',
        approvalStatus: 'APPROVED',
        name: 'E2E Staff',
        studentId: null,
        department: 'E2E Program Office',
        departmentType: 'PROGRAM_OFFICE',
        profileCreatedAt: new Date(),
        profileUpdatedAt: new Date(),
      },
    });
    await transaction.user.upsert({
      where: { id: actors.studentId },
      create: {
        ...canonicalUserCreate({
          id: actors.studentId,
          githubId: actors.studentGithubId,
          nickname: 'e2e-program-authoring-student',
          name: 'E2E Student',
          studentId: '260001',
          department: 'E2E Department',
          memberKind: 'STUDENT',
        }),
        notificationEmail: 'e2e-program-authoring-student@fixture.invalid',
        notifyEnabled: true,
        accountStatus: AccountStatus.ACTIVE,
      },
      update: {
        nickname: 'e2e-program-authoring-student',
        notificationEmail: 'e2e-program-authoring-student@fixture.invalid',
        notifyEnabled: true,
        accountStatus: AccountStatus.ACTIVE,
        type: 'STUDENT',
        approvalStatus: 'NOT_REQUIRED',
      },
    });
    await transaction.user.upsert({
      where: { id: actors.foreignStudentId },
      create: {
        ...canonicalUserCreate({
          id: actors.foreignStudentId,
          githubId: actors.foreignStudentGithubId,
          nickname: 'e2e-program-authoring-foreign-student',
          name: 'E2E Foreign Student',
          studentId: '260002',
          department: 'E2E Department',
          memberKind: 'STUDENT',
        }),
        notificationEmail:
          'e2e-program-authoring-foreign-student@fixture.invalid',
        notifyEnabled: true,
        accountStatus: AccountStatus.ACTIVE,
      },
      update: {
        nickname: 'e2e-program-authoring-foreign-student',
        notificationEmail:
          'e2e-program-authoring-foreign-student@fixture.invalid',
        notifyEnabled: true,
        accountStatus: AccountStatus.ACTIVE,
        type: 'STUDENT',
        approvalStatus: 'NOT_REQUIRED',
      },
    });
  });
}
