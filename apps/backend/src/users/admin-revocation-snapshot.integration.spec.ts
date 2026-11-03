import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import {
  deferred,
  backendPid,
  pidCapturingPrisma,
  waitUntilBlockedBy,
} from './admin-actor-toctou.integration-support';
import { AdminRepository } from './admin.repository';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { AdminProfileRepository } from './admin-profile.repository';
import { AdminProfileService } from './admin-profile.service';
import { AdminProfileMutationService } from './admin-profile-mutation.service';
import { IndependentAuthorityRepository } from './independent-authority.repository';
import { IndependentAuthorityService } from './independent-authority.service';
import { MemberRegistrationResetRepository } from './member-registration-reset.repository';
import { MemberRegistrationResetService } from './member-registration-reset.service';
import { UserProfileService } from './user-profile.service';
import { UserHistoryRepository } from './user-history.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { ADMIN_ACCESS_COMMANDS } from './admin-access-query.config';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const transitions = new UserTransitionRepository();
const profiles = new UserProfileService();
const metadata = new AuditLogMetadataService();
const mutations = new AdminAccessMutationService(metadata, profiles);
const history = new UserHistoryRepository(transitions);
let sequence = 0;

beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());

type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

function observe<T>(promise: Promise<T>): Promise<Outcome<T>> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

function accessRepository(client: PrismaService) {
  return new AdminAccessRepository(
    client,
    new AdminAccessHistoryRepository(),
    new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
    new AdminRepository(client),
    transitions,
  );
}

function createUser(label: string, admin: boolean) {
  sequence += 1;
  const at = new Date('2026-01-01');
  return prisma.user.create({
    data: {
      id: `test:admin-revoke-snapshot:${label}:${sequence}`,
      githubId: 9700900000n + BigInt(sequence),
      nickname: `synthetic-${label}-${sequence}`,
      type: 'STUDENT',
      name: label,
      studentId: String(976000 + sequence),
      department: 'Department',
      departmentType: 'DEPARTMENT',
      profileCreatedAt: at,
      profileUpdatedAt: at,
      ...(admin ? { admin: { create: { origin: 'BOOTSTRAP' } } } : {}),
    },
  });
}

it.each(['profile', 'kind'] as const)(
  'rejects a revoked administrator %s mutation after waiting in Repeatable Read, without touching target or history',
  async (kind) => {
    const actor = await createUser(`${kind}-actor`, true);
    const revoker = await createUser(`${kind}-revoker`, true);
    const target = await createUser(`${kind}-target`, false);
    const revokeBackend = backendPid();
    const mutationBackend = backendPid();
    const written = deferred();
    const commitRevocation = deferred();
    const revokeClient = pidCapturingPrisma(prisma, revokeBackend.capture);
    const mutationClient = pidCapturingPrisma(prisma, mutationBackend.capture);
    const authority = new IndependentAuthorityService(
      new IndependentAuthorityRepository(
        revokeClient,
        new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
        accessRepository(revokeClient),
        new AdminRepository(revokeClient),
      ),
      {
        record: async (input, transaction) => {
          await history.record(input, transaction);
          written.resolve();
          await commitRevocation.promise;
        },
      },
      metadata,
      mutations,
      profiles,
    );
    const revocation = observe(
      authority.patchAdminAccess(revoker.githubId, actor.id, {
        command: ADMIN_ACCESS_COMMANDS.REVOKE,
      }),
    );
    let mutation: Promise<Outcome<unknown>> | undefined;
    try {
      await Promise.race([
        written.promise,
        revocation.then((result) => {
          if (!result.ok) throw result.error;
          throw new Error(
            'Revocation committed before its transaction barrier',
          );
        }),
      ]);
      switch (kind) {
        case 'profile':
          mutation = observe(
            new AdminProfileService(
              new AdminProfileRepository(
                mutationClient,
                accessRepository(mutationClient),
                new PrismaSerializationRetryRepository(),
                transitions,
              ),
              history,
              new AdminProfileMutationService(metadata, profiles, mutations),
              mutations,
            ).patchProfile(actor.githubId, target.id, {
              name: 'Unauthorized change',
            }),
          );
          break;
        case 'kind':
          mutation = observe(
            new MemberRegistrationResetService(
              new MemberRegistrationResetRepository(
                mutationClient,
                accessRepository(mutationClient),
                new PrismaSerializationRetryRepository(),
                transitions,
              ),
              history,
              metadata,
              profiles,
              mutations,
            ).resetFromRequest(actor.githubId, target.id, {
              expectedMemberKind: 'STUDENT',
              expectedApprovalStatus: 'NOT_REQUIRED',
              expectedApprovalRequestId: null,
            }),
          );
          break;
      }
      const waiterPid = await Promise.race([
        mutationBackend.pid,
        mutation.then((result) => {
          if (!result.ok) throw result.error;
          throw new Error('Mutation completed before its transaction lock');
        }),
      ]);
      await waitUntilBlockedBy(prisma, {
        waiterPid,
        blockerPid: await revokeBackend.pid,
        description: `Independent revoke blocks ${kind} mutation`,
      });
    } finally {
      commitRevocation.resolve();
      await revocation;
      if (mutation !== undefined) await mutation;
    }
    expect(await revocation).toMatchObject({ ok: true });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: actor.id } }),
    ).toEqual(actor);
    expect(
      await prisma.admin.findUnique({ where: { userId: actor.id } }),
    ).toBeNull();
    expect(
      await prisma.adminHistory.count({
        where: { userId: actor.id, event: 'REVOKED' },
      }),
    ).toBe(1);
    if (mutation === undefined)
      throw new TypeError('The mutation must have started');
    expect(await mutation).toMatchObject({
      ok: false,
      error: { errorCode: { code: 'ROL_004', status: 403 } },
    });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).toEqual(target);
    expect(
      await prisma.userHistory.count({ where: { userId: target.id } }),
    ).toBe(0);
    expect(
      await prisma.adminHistory.count({ where: { userId: target.id } }),
    ).toBe(0);
  },
  90000,
);
