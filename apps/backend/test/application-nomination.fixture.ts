import { TeamHistoryRepository } from '../src/programs/team-history.repository';
import { assertIsolatedIntegrationDatabase } from './integration-database.guard';
import { PrismaService } from '../src/platform/prisma.service';
import { PlatformRepository } from '../src/platform/platform.repository';
import { AuditLogRepository } from '../src/platform/audit-log.repository';
import { AuditLogReadService } from '../src/platform/audit-log-read.service';
import { AuditLogMetadataService } from '../src/platform/audit-log-metadata.service';
import { AuditLogService } from '../src/platform/audit-log.service';
import { RepositoryProvisionGenerationRepository } from '../src/platform/repository-provision-generation.repository';
import { RepositoryProvisionEventService } from '../src/github/repository-provision-event.service';
import { RepositoryUrlService } from '../src/github/repository-url.service';
import { canonicalUserCreateFromLabel } from '../src/users/canonical-user-fixture';
import { ApplicationsRepository } from '../src/programs/team.repository';
import { TeamApplicationService } from '../src/programs/team-application.service';
import { ApplicationAnswersService } from '../src/programs/team-application.service';
import { TeamInvitationsRepository } from '../src/programs/team-invitations.repository';
import { TeamInvitationsService } from '../src/programs/team-invitations.service';
import { UserProfileService } from '../src/users/user-profile.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prisma = new PrismaService();
const prefix = 'synthetic-named:';
const now = new Date('2026-08-15T00:00:00Z');
const leader = prefix + 'leader';
const member = prefix + 'member';
const replacement = prefix + 'replacement';
const extra = prefix + 'extra';
const staff = prefix + 'staff';
const audit = new AuditLogService(
  new AuditLogRepository(prisma),
  new AuditLogReadService(new AuditLogMetadataService()),
);
const service = new TeamApplicationService(new ApplicationsRepository(prisma, new TeamHistoryRepository(), new RepositoryProvisionGenerationRepository(), new PlatformRepository()), new RepositoryUrlService(), new ApplicationAnswersService(), new RepositoryProvisionEventService());
const invitations = new TeamInvitationsRepository(
  new TeamHistoryRepository(),
  prisma,
  new PlatformRepository(),
);
const invitationService = new TeamInvitationsService(
  invitations,
  audit,
  new AuditLogMetadataService(),
  new UserProfileService(),
);

async function seedNamedStudents() {
  await prisma.$connect();
  for (const [index, id] of [
    leader,
    member,
    replacement,
    extra,
    staff,
  ].entries()) {
    await prisma.user.create({
      data: canonicalUserCreateFromLabel(id === staff ? 'STAFF' : 'STUDENT', {
        id,
        githubId: 9_100_001n + BigInt(index),
        nickname: id,
        name: 'Synthetic student',
      }),
    });
  }
}

export {
  prisma,
  prefix,
  now,
  leader,
  member,
  replacement,
  extra,
  staff,
  audit,
  service,
  invitations,
  invitationService,
  seedNamedStudents,
};
