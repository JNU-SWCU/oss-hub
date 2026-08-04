import {
  ApplicationStatus,
  Prisma,
  ProgramCategory,
  Role,
} from '@prisma/client';
import {
  offsetDays,
  prisma,
  seedId,
  SeedStats,
  upsertSeedUser,
  upsertTracked,
} from './helpers';
import { computeJoinCodeDigest } from '../../src/common/join-code-digest';

/**
 * v1 신청 answers 예시 payload.
 * 필드 SSOT는 program-template.registry의 V1_APPLICATION_FIELDS이며,
 * 시드는 registry를 복제하지 않고 합성 예시만 넣는다.
 */
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
          teamMinSize: rest.teamMinSize ?? null,
          teamMaxSize: rest.teamMaxSize ?? null,
          repositoryProvisioningEnabled:
            rest.repositoryProvisioningEnabled ?? false,
        },
        create: {
          id,
          organizer: 'seed-organizer',
          applicationTemplateKey: rest.category.toLowerCase(),
          applicationTemplateVersion: 1,
          description: `#110 시드 fixture — ${rest.name}`,
          name: rest.name,
          category: rest.category,
          applicationStartAt: rest.applicationStartAt,
          applicationEndAt: rest.applicationEndAt,
          teamMinSize: rest.teamMinSize ?? null,
          teamMaxSize: rest.teamMaxSize ?? null,
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
  // 모든 신청이 Team을 갖는다(D5). 시나리오가 팀을 지정하지 않으면 프로덕션의 신청
  // 경로와 같은 모양으로 신청자 1인 팀을 만들어 붙인다.
  const teamId =
    params.teamId ??
    (
      await upsertTeam(stats, {
        id: seedId('intake', params.scenarioId, 'solo-team'),
        programId: params.programId,
        name: `${params.scenarioId} 1인 팀`,
        // 시나리오 전체를 써야 digest가 시나리오마다 달라진다. joinCodeDigest는
        // @unique라 앞부분만 자르면 시나리오끼리 충돌한다.
        joinCode: `SEED-SOLO-${params.scenarioId.toUpperCase()}`,
        leaderId: params.applicantId,
      })
    ).id;
  if (!params.teamId) {
    await upsertTeamMember(stats, {
      id: seedId('intake', params.scenarioId, 'solo-team-member'),
      teamId,
      programId: params.programId,
      userId: params.applicantId,
    });
  }
  return upsertTracked(
    stats,
    'Application',
    () => prisma.application.findUnique({ where: { id: params.id } }),
    () =>
      prisma.application.upsert({
        where: { id: params.id },
        update: {
          status: params.status,
          rejectionReason: params.rejectionReason,
          processedById: params.processedById,
          processedAt: params.processedAt,
        },
        create: {
          id: params.id,
          programId: params.programId,
          applicantId: params.applicantId,
          teamId,
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
    joinCode: string;
    leaderId: string;
  },
) {
  const joinCodeDigest = computeJoinCodeDigest(params.joinCode);
  return upsertTracked(
    stats,
    'Team',
    () => prisma.team.findUnique({ where: { id: params.id } }),
    () =>
      prisma.team.upsert({
        where: { id: params.id },
        update: { name: params.name, joinCodeDigest },
        create: {
          id: params.id,
          programId: params.programId,
          name: params.name,
          joinCodeDigest,
          leaderId: params.leaderId,
        },
      }),
  );
}

async function upsertTeamMember(
  stats: SeedStats,
  params: { id: string; teamId: string; programId: string; userId: string },
) {
  await upsertTracked(
    stats,
    'TeamMember',
    () => prisma.teamMember.findUnique({ where: { id: params.id } }),
    () =>
      prisma.teamMember.upsert({
        where: { id: params.id },
        update: {},
        create: {
          id: params.id,
          teamId: params.teamId,
          programId: params.programId,
          userId: params.userId,
        },
      }),
  );
}

/** application-team·team-locked이 공유하는 "팀 생성 + 신청 제출" 재사용 helper. */
async function createTeamWithApplication(
  stats: SeedStats,
  params: {
    scenarioId: string;
    programId: string;
    leaderId: string;
    memberIds: readonly string[];
  },
): Promise<{ teamId: string; applicationId: string }> {
  const teamId = seedId('intake', params.scenarioId, 'team');
  await upsertTeam(stats, {
    id: teamId,
    programId: params.programId,
    name: `seed-${params.scenarioId}-team`,
    joinCode: `SEED-${params.scenarioId.toUpperCase()}`,
    leaderId: params.leaderId,
  });
  await upsertTeamMember(stats, {
    id: seedId('intake', params.scenarioId, 'team-member', 'leader'),
    teamId,
    programId: params.programId,
    userId: params.leaderId,
  });
  for (const [index, memberId] of params.memberIds.entries()) {
    await upsertTeamMember(stats, {
      id: seedId('intake', params.scenarioId, 'team-member', String(index)),
      teamId,
      programId: params.programId,
      userId: memberId,
    });
  }
  const applicationId = seedId('intake', params.scenarioId, 'application');
  await upsertApplication(stats, {
    id: applicationId,
    programId: params.programId,
    applicantId: params.leaderId,
    teamId,
    status: ApplicationStatus.SUBMITTED,
    scenarioId: params.scenarioId,
  });
  return { teamId, applicationId };
}

const PROGRAM_WITH_APPLICATIONS_ID = seedId(
  'intake',
  'program-with-applications',
);
const PROGRAM_TEAM_TRACK_ID = seedId('intake', 'program-team-track');

/** application-validation-error는 DB에 심지 않는다 — API 테스트 입력 전용 fixture다. */
export const APPLICATION_VALIDATION_ERROR_FIXTURE = {
  scenarioId: 'application-validation-error',
  // 필수 answer 누락 — 정상 template 계약을 위반하는 API 입력 예시.
  answers: { title: '' },
};

export async function seedIntake(stats: SeedStats): Promise<void> {
  // --- programs -------------------------------------------------------
  // empty-programs: 이 profile은 어떤 DB row도 만들지 않는다 — 완전히 빈 DB 상태 자체가
  // 이 시나리오다(scenario id는 이 주석과 아래 noteFixtureOnly 기록으로 찾을 수 있다).
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

  // --- 개인형 신청 지원 사용자 ------------------------------------------
  const applicantPersonal = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'applicant-personal'),
    role: Role.STUDENT,
  });
  const applicantPending = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'applicant-pending'),
    role: Role.STUDENT,
  });
  const applicantApproved = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'applicant-approved'),
    role: Role.STUDENT,
  });
  const applicantRejected = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'applicant-rejected'),
    role: Role.STUDENT,
  });
  const processor = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'processor'),
    role: Role.STAFF,
  });

  // application-personal: 개인형, teamId=null, 유효(placeholder) answers.
  await upsertApplication(stats, {
    id: seedId('intake', 'application-personal', 'application'),
    programId: PROGRAM_WITH_APPLICATIONS_ID,
    applicantId: applicantPersonal.id,
    status: ApplicationStatus.SUBMITTED,
    scenarioId: 'application-personal',
  });

  // application-pending: 제출 후 판정 대기(ApplicationStatus enum에 PENDING이 없다 —
  // SUBMITTED가 곧 "판정 대기" 상태다. processedAt=null로 미판정임을 표현한다).
  await upsertApplication(stats, {
    id: seedId('intake', 'application-pending', 'application'),
    programId: PROGRAM_WITH_APPLICATIONS_ID,
    applicantId: applicantPending.id,
    status: ApplicationStatus.SUBMITTED,
    scenarioId: 'application-pending',
  });

  await upsertApplication(stats, {
    id: seedId('intake', 'application-approved', 'application'),
    programId: PROGRAM_WITH_APPLICATIONS_ID,
    applicantId: applicantApproved.id,
    status: ApplicationStatus.APPROVED,
    processedById: processor.id,
    processedAt: offsetDays(-1),
    scenarioId: 'application-approved',
  });

  await upsertApplication(stats, {
    id: seedId('intake', 'application-rejected', 'application'),
    programId: PROGRAM_WITH_APPLICATIONS_ID,
    applicantId: applicantRejected.id,
    status: ApplicationStatus.REJECTED,
    rejectionReason: '지원 자격 요건 미충족 (seed fixture)',
    processedById: processor.id,
    processedAt: offsetDays(-1),
    scenarioId: 'application-rejected',
  });

  // application-validation-error: DB 정상 레코드로 심지 않는다 — 위 export된 fixture만 제공.
  stats.noteFixtureOnly('application-validation-error');

  // --- 팀형 신청 -------------------------------------------------------
  const teamEmptyUser = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'team-empty-applicant'),
    role: Role.STUDENT,
  });
  // team-empty: team-track 프로그램은 있지만 이 사용자는 어떤 Team에도 속하지 않는다
  // (Team/TeamMember row를 만들지 않는다 — 사용자의 "팀 없음" 상태 자체가 시나리오다).
  void teamEmptyUser;

  const teamLeaderFull = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'team-full-leader'),
    role: Role.STUDENT,
  });
  const teamFullMembers = await Promise.all(
    [0, 1, 2].map((index) =>
      upsertSeedUser(stats, {
        id: seedId('intake', 'user', 'team-full-member', String(index)),
        role: Role.STUDENT,
      }),
    ),
  );
  // team-full: teamMaxSize(4) 도달 — leader 1 + member 3.
  const teamFullId = seedId('intake', 'team-full', 'team');
  await upsertTeam(stats, {
    id: teamFullId,
    programId: PROGRAM_TEAM_TRACK_ID,
    name: 'seed-team-full',
    joinCode: 'SEED-TEAM-FULL',
    leaderId: teamLeaderFull.id,
  });
  await upsertTeamMember(stats, {
    id: seedId('intake', 'team-full', 'team-member', 'leader'),
    teamId: teamFullId,
    programId: PROGRAM_TEAM_TRACK_ID,
    userId: teamLeaderFull.id,
  });
  for (const [index, member] of teamFullMembers.entries()) {
    await upsertTeamMember(stats, {
      id: seedId('intake', 'team-full', 'team-member', String(index)),
      teamId: teamFullId,
      programId: PROGRAM_TEAM_TRACK_ID,
      userId: member.id,
    });
  }

  const teamLeaderApp = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'application-team-leader'),
    role: Role.STUDENT,
  });
  const teamMemberApp = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'application-team-member'),
    role: Role.STUDENT,
  });
  await createTeamWithApplication(stats, {
    scenarioId: 'application-team',
    programId: PROGRAM_TEAM_TRACK_ID,
    leaderId: teamLeaderApp.id,
    memberIds: [teamMemberApp.id],
  });

  const teamLeaderLocked = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'team-locked-leader'),
    role: Role.STUDENT,
  });
  const teamMemberLocked = await upsertSeedUser(stats, {
    id: seedId('intake', 'user', 'team-locked-member'),
    role: Role.STUDENT,
  });
  // team-locked: 신청 제출 후 membership이 잠긴 팀 — application-team과 동일한 구성을
  // 재사용 helper로 독립된 팀·신청 행에 적용한다.
  await createTeamWithApplication(stats, {
    scenarioId: 'team-locked',
    programId: PROGRAM_TEAM_TRACK_ID,
    leaderId: teamLeaderLocked.id,
    memberIds: [teamMemberLocked.id],
  });
}
