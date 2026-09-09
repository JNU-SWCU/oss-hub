import { MemberKind } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

const prefix = 'qa152-document-flow';
export const flowIds = {
  program: `${prefix}-program`,
  milestone: `${prefix}-milestone`,
  document: `${prefix}-document`,
  application: `${prefix}-application`,
  team: `${prefix}-team`,
  student: `${prefix}-student`,
  staff: `${prefix}-staff`,
} as const;
export const flowGithubIds = {
  student: 960000001135001n,
  staff: 960000001135002n,
} as const;

export async function seedMilestoneDocumentFlow(
  prisma: PrismaService,
): Promise<void> {
  await prisma.user.createMany({
    data: [
      {
        id: flowIds.student,
        githubId: flowGithubIds.student,
        nickname: flowIds.student,
        selectedMemberKind: MemberKind.STUDENT,
      },
      {
        id: flowIds.staff,
        githubId: flowGithubIds.staff,
        nickname: flowIds.staff,
        hasStaffAccess: true,
      },
    ],
  });
  await prisma.program.create({
    data: {
      id: flowIds.program,
      name: '합성 프로그램',
      organizer: 'OSS Hub',
      category: 'CAPSTONE',
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2000-01-01'),
      applicationEndAt: new Date('2000-01-02'),
      startAt: new Date('2000-01-03'),
      endAt: new Date('2099-12-31'),
      description: 'synthetic integration fixture',
      milestones: {
        create: {
          id: flowIds.milestone,
          name: '합성 제출 단계',
          dueAt: new Date('2099-01-01'),
          submissionType: 'FILE',
          documents: {
            create: {
              id: flowIds.document,
              name: '합성 계획서',
              required: true,
              sortOrder: 1,
            },
          },
        },
      },
    },
  });
  await prisma.team.create({
    data: {
      id: flowIds.team,
      programId: flowIds.program,
      name: '합성 팀',
      joinCodeDigest: `${prefix}-digest`,
      leaderId: flowIds.student,
      members: { create: { userId: flowIds.student } },
    },
  });
  await prisma.application.create({
    data: {
      id: flowIds.application,
      programId: flowIds.program,
      teamId: flowIds.team,
      applicantId: flowIds.student,
      status: 'APPROVED',
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
    },
  });
}
