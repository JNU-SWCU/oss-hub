import { ApplicationStatus, Prisma, ProgramCategory } from '@prisma/client';
import {
  applicationTemplateKey,
  offsetDays,
  prisma,
  seedId,
  SeedStats,
  upsertTracked,
} from './helpers';
import { upsertSeedUser } from './user';

function placeholderAnswers(scenarioId: string): Prisma.InputJsonObject {
  return {
    applicantName: `seed-applicant-${scenarioId}`,
    title: `seed-title-${scenarioId}`,
    summary: `seed-summary-${scenarioId}`,
  };
}

const ALL_CATEGORIES: readonly ProgramCategory[] = [
  ProgramCategory.BASIC,
  ProgramCategory.SW_VALUE_SPREAD,
  ProgramCategory.OSS_CONTEST,
  ProgramCategory.CAPSTONE,
  ProgramCategory.SW_CONVERGENCE,
  ProgramCategory.GLOBAL_MAKERTHON,
  ProgramCategory.CORPORATE_INTERNSHIP,
];

async function upsertProgram(
  stats: SeedStats,
  params: {
    id: string;
    name: string;
    category: ProgramCategory;
    applicationStartAt: Date;
    applicationEndAt: Date;
    teamMinSize?: number;
    teamMaxSize?: number;
    repositoryProvisioningEnabled?: boolean;
  },
) {
  const { id, ...rest } = params;
  const startAt = rest.applicationEndAt;
  const endAt = new Date(startAt.getTime() + 365 * 24 * 60 * 60 * 1_000);
  const teamMinSize = rest.teamMinSize ?? 1;
  const teamMaxSize = rest.teamMaxSize ?? 1;
  return upsertTracked(
    stats,
    'Program',
    () => prisma.program.findUnique({ where: { id } }),
    () =>
      prisma.program.upsert({
        where: { id },
        update: {
          name: rest.name,
          category: rest.category,
          applicationStartAt: rest.applicationStartAt,
          applicationEndAt: rest.applicationEndAt,
          startAt,
          endAt,
          teamMinSize,
          teamMaxSize,
          repositoryProvisioningEnabled:
            rest.repositoryProvisioningEnabled ?? false,
        },
        create: {
          id,
          organizer: 'seed-organizer',
          applicationTemplateKey: applicationTemplateKey(rest.category),
          applicationTemplateVersion: 1,
          description: `#110 시드 fixture — ${rest.name}`,
          name: rest.name,
          category: rest.category,
          applicationStartAt: rest.applicationStartAt,
          applicationEndAt: rest.applicationEndAt,
          startAt,
          endAt,
          teamMinSize,
          teamMaxSize,
          repositoryProvisioningEnabled:
            rest.repositoryProvisioningEnabled ?? false,
        },
      }),
  );
}

async function upsertApplication(
  stats: SeedStats,
  params: {
    id: string;
    programId: string;
    applicantId: string;
    teamId?: string;
    status: ApplicationStatus;
    rejectionReason?: string;
    processedById?: string;
    processedAt?: Date;
    scenarioId: string;
  },
) {
  const answers = placeholderAnswers(params.scenarioId);

  const teamId =
    params.teamId ??
    (
      await upsertTeam(stats, {
        id: seedId('intake', params.scenarioId, 'solo-team'),
        programId: params.programId,
        name: `${params.scenarioId} 1인 팀`,
        leaderId: params.applicantId,
      })
    ).id;
  if (!params.teamId) {
    await upsertTeamMember(stats, {
      teamId,
      programId: params.programId,
      userId: params.applicantId,
    });
  }
  return upsertTracked(
    stats,
    'Team',
    () => prisma.team.findUnique({ where: { id: teamId } }),
    () =>
      prisma.team.update({
        where: { id: teamId },
        data: {
          programId: params.programId,
          applicantId: params.applicantId,
          answers,
          applicationTemplateVersion: 1,
          status: params.status,
          rejectionReason: params.rejectionReason,
          processedById: params.processedById,
          processedAt: params.processedAt,
        },
      }),
  );
}

async function upsertTeam(
  stats: SeedStats,
  params: {
    id: string;
    programId: string;
    name: string;
    leaderId: string;
  },
) {
  return upsertTracked(
    stats,
    'Team',
    () => prisma.team.findUnique({ where: { id: params.id } }),
    () =>
      prisma.team.upsert({
        where: { id: params.id },
        update: { name: params.name },
        create: {
          id: params.id,
          programId: params.programId,
          name: params.name,
          leaderId: params.leaderId,
          applicantId: params.leaderId,
          answers: { title: params.name },
          applicationTemplateVersion: 1,
        },
      }),
  );
}

async function upsertTeamMember(
  stats: SeedStats,
  params: { teamId: string; programId: string; userId: string },
) {
  await upsertTracked(
    stats,
    'TeamMember',
    () =>
      prisma.teamMember.findUnique({
        where: {
          teamId_userId: { teamId: params.teamId, userId: params.userId },
        },
      }),
    () =>
      prisma.teamMember.upsert({
        where: {
          teamId_userId: { teamId: params.teamId, userId: params.userId },
        },
        update: {},
        create: {
          teamId: params.teamId,
          programId: params.programId,
          userId: params.userId,
        },
      }),
  );
}

async function createTeamWithApplication(
  stats: SeedStats,
  params: {
    scenarioId: string;
    programId: string;
    leaderId: string;
    memberIds: readonly string[];
  },
): Promise<{ teamId: string }> {
  const teamId = seedId('intake', params.scenarioId, 'team');
  await upsertTeam(stats, {
    id: teamId,
    programId: params.programId,
    name: `seed-${params.scenarioId}-team`,
    leaderId: params.leaderId,
  });
  await upsertTeamMember(stats, {
    teamId,
    programId: params.programId,
    userId: params.leaderId,
  });
  for (const memberId of params.memberIds) {
    await upsertTeamMember(stats, {
      teamId,
      programId: params.programId,
      userId: memberId,
    });
  }
  await upsertApplication(stats, {
    id: teamId,
    programId: params.programId,
    applicantId: params.leaderId,
    teamId,
    status: ApplicationStatus.SUBMITTED,
    scenarioId: params.scenarioId,
  });
  return { teamId };
}

const PROGRAM_WITH_APPLICATIONS_ID = seedId(
  'intake',
  'program-with-applications',
);
const PROGRAM_TEAM_TRACK_ID = seedId('intake', 'program-team-track');

export async function seedIntake(stats: SeedStats): Promise<void> {
  stats.noteFixtureOnly('empty-programs');

  for (const category of ALL_CATEGORIES) {
    await upsertProgram(stats, {
      id: seedId('intake', 'program-seven-templates', category),
      name: `seed-program-${category.toLowerCase()}`,
      category,
      applicationStartAt: offsetDays(-20),
      applicationEndAt: offsetDays(20),
    });
  }

  await upsertProgram(stats, {
    id: seedId('intake', 'program-overdue'),
    name: 'seed-program-overdue',
    category: ProgramCategory.BASIC,
    applicationStartAt: offsetDays(-30),
    applicationEndAt: offsetDays(-5),
  });

  await upsertProgram(stats, {
    id: PROGRAM_WITH_APPLICATIONS_ID,
    name: 'seed-program-with-applications',
    category: ProgramCategory.OSS_CONTEST,
    applicationStartAt: offsetDays(-20),
    applicationEndAt: offsetDays(20),
  });

  await upsertProgram(stats, {
    id: seedId('intake', 'program-no-repository'),
    name: 'seed-program-no-repository',
    category: ProgramCategory.CAPSTONE,
    applicationStartAt: offsetDays(-20),
    applicationEndAt: offsetDays(20),
    repositoryProvisioningEnabled: false,
  });

  await upsertProgram(stats, {
    id: seedId('intake', 'empty-applications'),
    name: 'seed-program-empty-applications',
    category: ProgramCategory.SW_CONVERGENCE,
    applicationStartAt: offsetDays(-20),
    applicationEndAt: offsetDays(20),
  });

  await upsertProgram(stats, {
    id: PROGRAM_TEAM_TRACK_ID,
    name: 'seed-program-team-track',
    category: ProgramCategory.GLOBAL_MAKERTHON,
    applicationStartAt: offsetDays(-20),
    applicationEndAt: offsetDays(20),
    teamMinSize: 2,
    teamMaxSize: 4,
  });

  const applicantPersonal = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'applicant-personal'),
    role: 'STUDENT',
  });
  const applicantPending = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'applicant-pending'),
    role: 'STUDENT',
  });
  const applicantApproved = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'applicant-approved'),
    role: 'STUDENT',
  });
  const applicantRejected = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'applicant-rejected'),
    role: 'STUDENT',
  });
  const processor = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'processor'),
    role: 'STAFF',
  });

  await upsertApplication(stats, {
    id: seedId('intake', 'application-personal', 'team'),
    programId: PROGRAM_WITH_APPLICATIONS_ID,
    applicantId: applicantPersonal.id,
    status: ApplicationStatus.SUBMITTED,
    scenarioId: 'application-personal',
  });

  await upsertApplication(stats, {
    id: seedId('intake', 'application-pending', 'team'),
    programId: PROGRAM_WITH_APPLICATIONS_ID,
    applicantId: applicantPending.id,
    status: ApplicationStatus.SUBMITTED,
    scenarioId: 'application-pending',
  });

  await upsertApplication(stats, {
    id: seedId('intake', 'application-approved', 'team'),
    programId: PROGRAM_WITH_APPLICATIONS_ID,
    applicantId: applicantApproved.id,
    status: ApplicationStatus.APPROVED,
    processedById: processor.id,
    processedAt: offsetDays(-1),
    scenarioId: 'application-approved',
  });

  await upsertApplication(stats, {
    id: seedId('intake', 'application-rejected', 'team'),
    programId: PROGRAM_WITH_APPLICATIONS_ID,
    applicantId: applicantRejected.id,
    status: ApplicationStatus.REJECTED,
    rejectionReason: '지원 자격 요건 미충족 (seed fixture)',
    processedById: processor.id,
    processedAt: offsetDays(-1),
    scenarioId: 'application-rejected',
  });

  stats.noteFixtureOnly('application-validation-error');

  const teamEmptyUser = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'team-empty-applicant'),
    role: 'STUDENT',
  });

  void teamEmptyUser;

  const teamLeaderFull = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'team-full-leader'),
    role: 'STUDENT',
  });
  const teamFullMembers = await Promise.all(
    [0, 1, 2].map((index) =>
      upsertSeedUser(stats, {
        id: seedId('intake', 'user', 'team-full-member', String(index)),
        role: 'STUDENT',
      }),
    ),
  );

  const teamFullId = seedId('intake', 'team-full', 'team');
  await upsertTeam(stats, {
    id: teamFullId,
    programId: PROGRAM_TEAM_TRACK_ID,
    name: 'seed-team-full',
    leaderId: teamLeaderFull.id,
  });
  await upsertTeamMember(stats, {
    teamId: teamFullId,
    programId: PROGRAM_TEAM_TRACK_ID,
    userId: teamLeaderFull.id,
  });
  for (const member of teamFullMembers) {
    await upsertTeamMember(stats, {
      teamId: teamFullId,
      programId: PROGRAM_TEAM_TRACK_ID,
      userId: member.id,
    });
  }

  const teamLeaderApp = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'application-team-leader'),
    role: 'STUDENT',
  });
  const teamMemberApp = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'application-team-member'),
    role: 'STUDENT',
  });
  await createTeamWithApplication(stats, {
    scenarioId: 'application-team',
    programId: PROGRAM_TEAM_TRACK_ID,
    leaderId: teamLeaderApp.id,
    memberIds: [teamMemberApp.id],
  });

  const teamLeaderLocked = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'team-locked-leader'),
    role: 'STUDENT',
  });
  const teamMemberLocked = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'team-locked-member'),
    role: 'STUDENT',
  });

  await createTeamWithApplication(stats, {
    scenarioId: 'team-locked',
    programId: PROGRAM_TEAM_TRACK_ID,
    leaderId: teamLeaderLocked.id,
    memberIds: [teamMemberLocked.id],
  });
}
