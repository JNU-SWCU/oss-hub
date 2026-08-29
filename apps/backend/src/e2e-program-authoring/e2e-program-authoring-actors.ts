import { AccountStatus, AffiliationKind, MemberKind } from '@prisma/client';
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
        notificationEmail: 'e2e-program-authoring-staff@fixture.invalid',
        notifyEnabled: true,
        accountStatus: AccountStatus.ACTIVE,
        selectedMemberKind: MemberKind.STAFF,
        hasStaffAccess: true,
        profile: {
          create: {
            name: 'E2E Staff',
            studentId: null,
            department: 'E2E Program Office',
            memberKind: MemberKind.STAFF,
            affiliationKind: AffiliationKind.PROGRAM_OFFICE,
            affiliationName: 'E2E Program Office',
          },
        },
      },
      update: {
        nickname: 'e2e-program-authoring-staff',
        notificationEmail: 'e2e-program-authoring-staff@fixture.invalid',
        notifyEnabled: true,
        accountStatus: AccountStatus.ACTIVE,
        selectedMemberKind: MemberKind.STAFF,
        hasStaffAccess: true,
      },
    });
    await transaction.user.upsert({
      where: { id: actors.studentId },
      create: {
        id: actors.studentId,
        githubId: actors.studentGithubId,
        nickname: 'e2e-program-authoring-student',
        notificationEmail: 'e2e-program-authoring-student@fixture.invalid',
        notifyEnabled: true,
        accountStatus: AccountStatus.ACTIVE,
        selectedMemberKind: MemberKind.STUDENT,
        profile: {
          create: {
            name: 'E2E Student',
            studentId: '260001',
            department: 'E2E Department',
            memberKind: MemberKind.STUDENT,
            affiliationKind: AffiliationKind.DEPARTMENT,
            affiliationName: 'E2E Department',
          },
        },
      },
      update: {
        nickname: 'e2e-program-authoring-student',
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
        notificationEmail:
          'e2e-program-authoring-foreign-student@fixture.invalid',
        notifyEnabled: true,
        accountStatus: AccountStatus.ACTIVE,
        selectedMemberKind: MemberKind.STUDENT,
        profile: {
          create: {
            name: 'E2E Foreign Student',
            studentId: '260002',
            department: 'E2E Department',
            memberKind: MemberKind.STUDENT,
            affiliationKind: AffiliationKind.DEPARTMENT,
            affiliationName: 'E2E Department',
          },
        },
      },
      update: {
        nickname: 'e2e-program-authoring-foreign-student',
        notificationEmail:
          'e2e-program-authoring-foreign-student@fixture.invalid',
        notifyEnabled: true,
        accountStatus: AccountStatus.ACTIVE,
      },
    });
  });
}
