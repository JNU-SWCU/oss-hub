import { TeamInvitationsRepository } from './team-invitations.repository';
import { AffiliationKind, MemberKind, ProgramCategory } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { AuditLogRepository } from '../platform/audit-log.repository';
import { AuditLogService } from '../platform/audit-log.service';
import { UsersAuthorityRepository } from '../users/independent-authority.repository';
import { UsersAuthorityService } from '../users/users-authority.service';
import { ApplicationsRepository } from './applications.repository';
import { ApplicationPreparationsRepository } from './application-preparations.repository';
import {
  ApplicationPreparationsService,
  ApplicationJoinCodeService,
} from './application-preparations.service';
import { ApplicationsService } from './applications.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { JoinCodeSecretService } from '../platform/join-code-secret.service';
import { ApplicationAnswersService } from './application-answers.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prisma = new PrismaService();
const inbox = new TeamInvitationsRepository(prisma);
const audit = new AuditLogService(
  new AuditLogRepository(prisma),
  new AuditLogMetadataService(),
);
const preparations = new ApplicationPreparationsService(
  new ApplicationPreparationsRepository(prisma),
);
const applications = new ApplicationsService(
  new ApplicationsRepository(prisma),
  audit,
  new UsersAuthorityService(new UsersAuthorityRepository(prisma)),
  new ApplicationJoinCodeService(
    {
      TEAM_JOIN_CODE_SECRET: 'synthetic-preparation-secret',
    },
    new JoinCodeSecretService(),
  ),
  new AuditLogMetadataService(),
  new RepositoryUrlService(),
  new ApplicationAnswersService(),
);
const now = new Date('2026-10-01T00:00:00Z');
const leader = { id: 'synthetic-preparation-leader', githubId: 8_600_000_001n };
const member = { id: 'synthetic-preparation-member', githubId: 8_600_000_002n };
const other = { id: 'synthetic-preparation-other', githubId: 8_600_000_003n };
const input = {
  answers: { title: 'synthetic project' },
  teamName: null,
  applicationTemplateVersion: 1,
  isRepositoryPublicationPlanned: false,
};
let sequence = 0;
let programId: string;

async function prepare(minimum = 2) {
  await prisma.program.update({
    where: { id: programId },
    data: { teamMinSize: minimum },
  });
  return preparations.create(
    leader.githubId,
    programId,
    'synthetic preparation',
    now,
  );
}
async function inviteAndAccept(preparationId: string) {
  const invitation = await preparations.invite(
    leader.githubId,
    preparationId,
    member.id,
    now,
  );
  await preparations.respond(member.githubId, invitation.id, 'accept', now);
  return invitation;
}
async function expectNoOfficialRows() {
  await expect(prisma.team.count({ where: { programId } })).resolves.toBe(0);
  await expect(
    prisma.application.count({ where: { programId } }),
  ).resolves.toBe(0);
}

describe('application preparation integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    for (const actor of [leader, member, other]) {
      await prisma.user.create({
        data: {
          ...actor,
          nickname: actor.id,
          selectedMemberKind: MemberKind.STUDENT,
          profile: {
            create: {
              name: actor.id,
              memberKind: MemberKind.STUDENT,
              studentId: actor.githubId.toString(),
              department: 'synthetic',
              affiliationKind: AffiliationKind.DEPARTMENT,
              affiliationName: 'synthetic',
            },
          },
        },
      });
    }
  });
  beforeEach(async () => {
    programId = `synthetic-preparation-program-${++sequence}`;
    await prisma.program.create({
      data: {
        id: programId,
        name: programId,
        organizer: 'synthetic',
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'basic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01'),
        applicationEndAt: new Date('2026-12-31'),
        description: 'synthetic',
        teamMinSize: 2,
        teamMaxSize: 3,
      },
    });
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.user.update({
      where: { id: member.id },
      data: { accountStatus: 'ACTIVE' },
    });
    await prisma.application.deleteMany({ where: { programId } });
    await prisma.teamMember.deleteMany({ where: { programId } });
    await prisma.team.deleteMany({ where: { programId } });
    await prisma.program.delete({ where: { id: programId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('keeps accepted invitations temporary until one atomic final application', async () => {
    const preparation = await prepare();
    const accepted = await inviteAndAccept(preparation.id);
    await preparations.invite(leader.githubId, preparation.id, other.id, now);
    await expectNoOfficialRows();
    await expect(
      preparations.get(member.githubId, programId),
    ).resolves.toMatchObject({
      id: preparation.id,
      memberCount: 2,
      isLeader: false,
    });
    await expect(inbox.findByInviteeId(other.id)).resolves.toEqual([
      expect.objectContaining({ teamId: preparation.id, status: 'PENDING' }),
    ]);
    const beforeAudit = await prisma.auditLog.count();

    const application = await applications.create(
      leader.githubId,
      programId,
      input,
      now,
    );

    const team = await prisma.team.findUniqueOrThrow({
      where: { id: application.teamId },
      include: { members: true },
    });
    expect(team.name).toBe('synthetic preparation');
    expect(team.members.map((row) => row.userId).sort()).toEqual(
      [leader.id, member.id].sort(),
    );
    await expect(
      prisma.application.count({ where: { programId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.applicationPreparation.count({ where: { programId } }),
    ).resolves.toBe(0);
    await expect(prisma.auditLog.count()).resolves.toBe(beforeAudit + 2);
    await expect(
      prisma.applicationReviewHistory.count({
        where: { applicationId: application.id },
      }),
    ).resolves.toBe(1);
    await expect(
      preparations.respond(member.githubId, accepted.id, 'accept', now),
    ).rejects.toMatchObject({ errorCode: { code: 'APP_030' } });
  });

  it('rejects minimum and current eligibility changes without creating an official team', async () => {
    const preparation = await prepare();
    await expect(
      applications.create(leader.githubId, programId, input, now),
    ).rejects.toMatchObject({ errorCode: { code: 'APP_019' } });
    await inviteAndAccept(preparation.id);
    await prisma.user.update({
      where: { id: member.id },
      data: { accountStatus: 'DEACTIVATED' },
    });

    await expect(
      applications.create(leader.githubId, programId, input, now),
    ).rejects.toMatchObject({ errorCode: { code: 'APP_031' } });

    await expectNoOfficialRows();
    await expect(
      preparations.get(leader.githubId, programId),
    ).resolves.toMatchObject({ memberCount: 2 });
  });

  it('rolls back official rows and keeps preparation when final audit write fails', async () => {
    const preparation = await prepare();
    await inviteAndAccept(preparation.id);
    const beforeAudit = await prisma.auditLog.count();
    jest
      .spyOn(audit, 'record')
      .mockRejectedValueOnce(new Error('synthetic transaction failure'));

    await expect(
      applications.create(leader.githubId, programId, input, now),
    ).rejects.toThrow('synthetic transaction failure');

    await expectNoOfficialRows();
    await expect(prisma.auditLog.count()).resolves.toBe(beforeAudit);
    await expect(
      preparations.get(leader.githubId, programId),
    ).resolves.toMatchObject({ id: preparation.id, memberCount: 2 });
  });

  it('serializes invitation acceptance with final submission', async () => {
    const preparation = await prepare(1);
    const invitation = await preparations.invite(
      leader.githubId,
      preparation.id,
      member.id,
      now,
    );

    const [acceptance, submission] = await Promise.allSettled([
      preparations.respond(member.githubId, invitation.id, 'accept', now),
      applications.create(leader.githubId, programId, input, now),
    ]);

    expect(submission.status).toBe('fulfilled');
    await expect(prisma.team.count({ where: { programId } })).resolves.toBe(1);
    await expect(
      prisma.application.count({ where: { programId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.teamMember.count({ where: { programId } }),
    ).resolves.toBe(acceptance.status === 'fulfilled' ? 2 : 1);
    await expect(
      prisma.applicationPreparation.count({ where: { programId } }),
    ).resolves.toBe(0);
  });

  it('denies outsiders, permits invitee departure, and deletes abandoned preparation', async () => {
    const preparation = await prepare();
    const invitation = await preparations.invite(
      leader.githubId,
      preparation.id,
      member.id,
      now,
    );
    await expect(
      preparations.respond(other.githubId, invitation.id, 'accept', now),
    ).rejects.toMatchObject({ errorCode: { status: 403 } });
    await expect(
      preparations.invite(other.githubId, preparation.id, member.id, now),
    ).rejects.toMatchObject({ errorCode: { status: 403 } });
    await preparations.respond(member.githubId, invitation.id, 'accept', now);
    await preparations.leave(member.githubId, programId);
    await expect(
      preparations.get(member.githubId, programId),
    ).resolves.toBeNull();
    await preparations.invite(leader.githubId, preparation.id, member.id, now);

    await preparations.leave(leader.githubId, programId);

    await expectNoOfficialRows();
    await expect(inbox.findByInviteeId(member.id)).resolves.toEqual([]);
    await expect(
      preparations.get(leader.githubId, programId),
    ).resolves.toBeNull();
  });

  it('allows only one accepted preparation per program and preserves existing official teams', async () => {
    const preparation = await prepare(1);
    await inviteAndAccept(preparation.id);
    await expect(
      preparations.create(member.githubId, programId, 'second', now),
    ).rejects.toMatchObject({ errorCode: { code: 'TIV_007' } });
    const submitted = await applications.create(
      leader.githubId,
      programId,
      input,
      now,
    );
    await expect(
      preparations.create(member.githubId, programId, 'second', now),
    ).rejects.toMatchObject({ errorCode: { code: 'TIV_007' } });
    await expect(
      prisma.team.findUnique({ where: { id: submitted.teamId } }),
    ).resolves.toMatchObject({ name: 'synthetic preparation' });
  });
  it('rechecks maximum size and rejects a non-leader final submit', async () => {
    const preparation = await prepare();
    await inviteAndAccept(preparation.id);
    await expect(
      applications.create(member.githubId, programId, input, now),
    ).rejects.toMatchObject({ errorCode: { code: 'APP_028' } });
    await prisma.program.update({
      where: { id: programId },
      data: { teamMinSize: 1, teamMaxSize: 1 },
    });

    await expect(
      applications.create(leader.githubId, programId, input, now),
    ).rejects.toMatchObject({ errorCode: { code: 'APP_031' } });

    await expectNoOfficialRows();
    await expect(
      preparations.get(leader.githubId, programId),
    ).resolves.toMatchObject({ memberCount: 2 });
  });

  it('accepts only one of two concurrent preparation invitations in a program', async () => {
    const first = await prepare();
    const second = await preparations.create(
      other.githubId,
      programId,
      'synthetic second preparation',
      now,
    );
    const firstInvite = await preparations.invite(
      leader.githubId,
      first.id,
      member.id,
      now,
    );
    const secondInvite = await preparations.invite(
      other.githubId,
      second.id,
      member.id,
      now,
    );

    const outcomes = await Promise.allSettled([
      preparations.respond(member.githubId, firstInvite.id, 'accept', now),
      preparations.respond(member.githubId, secondInvite.id, 'accept', now),
    ]);

    expect(
      outcomes.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    await expect(
      prisma.applicationPreparationParticipant.count({
        where: { programId, userId: member.id, status: 'ACCEPTED' },
      }),
    ).resolves.toBe(1);
    await expectNoOfficialRows();
  });
});
