import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccountStatus,
  AffiliationKind,
  MemberKind,
  Role,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { OriginGuard } from '../auth/origin.guard';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import { LegacyMemberReclassificationController } from './legacy-member-reclassification.controller';
import { LegacyMemberReclassificationRepository } from './legacy-member-reclassification.repository';
import { LegacyMemberReclassificationService } from './legacy-member-reclassification.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const sessionSecret = new Uint8Array(32).fill(31);
const allowedOrigin = 'http://frontend.test';
const prefix = 'test:task10:legacy-reclassification:';
const prisma = new PrismaService();
let application: INestApplication;
let baseUrl = '';
let sequence = 0;

beforeAll(async () => {
  await prisma.$connect();
  await clearFixtures();
  const moduleRef = await Test.createTestingModule({
    controllers: [LegacyMemberReclassificationController],
    providers: [
      LegacyMemberReclassificationService,
      LegacyMemberReclassificationRepository,
      SessionGuard,
      OriginGuard,
      { provide: PrismaService, useValue: prisma },
      {
        provide: AuthConfig,
        useValue: { sessionSecret, allowedOrigin, useSecureCookies: false },
      },
      {
        provide: AuthService,
        useValue: {
          getMe: jest.fn().mockResolvedValue({
            id: 'synthetic-session-user',
            accountStatus: AccountStatus.ACTIVE,
          }),
        },
      },
    ],
  }).compile();
  application = moduleRef.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();
});

afterAll(async () => {
  await application.close();
  await clearFixtures();
  await prisma.$disconnect();
});

it('same-origin and missing-Origin requests follow the existing OriginGuard contract', async () => {
  // Given
  const sameOriginUser = await createLegacyAdmin('same-origin');
  const missingOriginUser = await createLegacyAdmin('missing-origin');

  // When
  const sameOrigin = await request(
    sameOriginUser.githubId,
    studentBody(),
    allowedOrigin,
  );
  const missingOrigin = await request(missingOriginUser.githubId, staffBody());

  // Then
  expect([sameOrigin.status, missingOrigin.status]).toEqual([200, 200]);
  await expect(storedUser(sameOriginUser.id)).resolves.toMatchObject({
    selectedMemberKind: MemberKind.STUDENT,
    hasStaffAccess: false,
    profile: { memberKind: MemberKind.STUDENT, studentId: '750001' },
  });
  await expect(storedUser(missingOriginUser.id)).resolves.toMatchObject({
    selectedMemberKind: MemberKind.STAFF,
    hasStaffAccess: true,
    profile: { memberKind: MemberKind.STAFF, studentId: null },
  });
});

it('present foreign Origin is 403 and leaves the unresolved row unchanged', async () => {
  // Given
  const user = await createLegacyAdmin('foreign-origin');

  // When
  const response = await request(
    user.githubId,
    studentBody(),
    'http://foreign.test',
  );

  // Then
  expect(response.status).toBe(403);
  await expect(storedUser(user.id)).resolves.toMatchObject({
    hasStaffAccess: true,
    profile: { memberKind: null },
  });
});

it('anonymous and nonlegacy callers fail without profile-value leakage', async () => {
  // Given
  const nonlegacy = await createLegacyAdmin('nonlegacy', {
    selectedMemberKind: MemberKind.STUDENT,
  });

  // When
  const anonymous = await request(undefined, studentBody(), allowedOrigin);
  const hidden = await request(
    nonlegacy.githubId,
    studentBody(),
    allowedOrigin,
  );
  const hiddenBody: unknown = await hidden.json();

  // Then
  expect(anonymous.status).toBe(401);
  expect(hidden.status).toBe(404);
  expect(hiddenBody).toEqual(expect.objectContaining({ code: 'USR_011' }));
  expect(JSON.stringify(hiddenBody)).not.toContain('합성');
});

it('same replay is idempotent and conflicting replay returns 409', async () => {
  // Given
  const user = await createLegacyAdmin('replay');
  const body = studentBody('750010');
  const first = await request(user.githubId, body, allowedOrigin);

  // When
  const replay = await request(user.githubId, body, allowedOrigin);
  const conflict = await request(user.githubId, staffBody(), allowedOrigin);

  // Then
  expect([first.status, replay.status, conflict.status]).toEqual([
    200, 200, 409,
  ]);
  await expect(storedUser(user.id)).resolves.toMatchObject({
    selectedMemberKind: MemberKind.STUDENT,
    profile: { memberKind: MemberKind.STUDENT },
  });
});

it.each([
  { ...studentBody(), memberKind: 'UNKNOWN' },
  { ...studentBody(), affiliationKind: AffiliationKind.PROGRAM_OFFICE },
  { ...staffBody(), studentId: '750002' },
] as const)('unknown request combination returns 400', async (body) => {
  // Given
  const user = await createLegacyAdmin(`invalid-${sequence}`);

  // When
  const response = await request(user.githubId, body, allowedOrigin);

  // Then
  expect(response.status).toBe(400);
  await expect(storedUser(user.id)).resolves.toMatchObject({
    profile: { memberKind: null },
  });
});

async function createLegacyAdmin(
  label: string,
  patch: {
    readonly role?: Role;
    readonly selectedMemberKind?: MemberKind;
    readonly hasStaffAccess?: boolean | null;
    readonly hasAdminAccess?: boolean | null;
  } = {},
) {
  sequence += 1;
  return prisma.user.create({
    data: {
      id: `${prefix}${label}:${sequence}`,
      githubId: 9_910_000_000n + BigInt(sequence),
      nickname: `synthetic-task10-${label}-${sequence}`,
      role: patch.role ?? Role.ADMIN,
      selectedMemberKind: patch.selectedMemberKind ?? null,
      hasStaffAccess:
        patch.hasStaffAccess === undefined ? true : patch.hasStaffAccess,
      hasAdminAccess:
        patch.hasAdminAccess === undefined ? true : patch.hasAdminAccess,
      name: '합성 기존 관리자',
      department: '합성 운영학과',
      profile: {
        create: {
          name: '합성 기존 관리자',
          studentId: null,
          department: '합성 운영학과',
          memberKind: null,
        },
      },
    },
    select: { id: true, githubId: true },
  });
}

function storedUser(id: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id },
    include: { profile: true },
  });
}

async function request(
  githubId: bigint | undefined,
  body: Readonly<Record<string, unknown>>,
  origin?: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/users/me/legacy-member-reclassification`, {
    method: 'POST',
    headers: {
      connection: 'close',
      'content-type': 'application/json',
      ...(origin === undefined ? {} : { origin }),
      ...(githubId === undefined
        ? {}
        : {
            cookie: `${sessionCookieName(false)}=${await issueSessionToken(
              sessionSecret,
              githubId,
            )}`,
          }),
    },
    body: JSON.stringify(body),
  });
}

function studentBody(studentId = '750001') {
  return {
    memberKind: MemberKind.STUDENT,
    name: '합성 학생 관리자',
    studentId,
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: '합성 인공지능학부',
  } as const;
}

function staffBody() {
  return {
    memberKind: MemberKind.STAFF,
    name: '합성 교직원 관리자',
    affiliationKind: AffiliationKind.PROGRAM_OFFICE,
    affiliationName: '합성 사업단',
  } as const;
}

async function clearFixtures(): Promise<void> {
  await prisma.roleRequest.deleteMany({
    where: { userId: { startsWith: prefix } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
}
