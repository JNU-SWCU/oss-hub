import { ProgramCategory } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from './prisma.service';
import { AuditLogReadRepository } from './audit-log-read.repository';
import { AuditLogReadService } from './audit-log-read.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:audit-history-read:';
const ADMIN_ID = `${TEST_PREFIX}admin`;
const STAFF_ID = `${TEST_PREFIX}staff`;
const PROGRAM_ID = `${TEST_PREFIX}program`;
const TEAM_ID = `${TEST_PREFIX}team`;
const REPOSITORY_ID = `${TEST_PREFIX}repository`;
const PROGRAM_NAME = 'Audit history program';
const TEAM_NAME = 'Audit history team';
const REPOSITORY_NAME = 'audit-history/repository';
const RECORD_KEYS = [
  'action',
  'actor',
  'actorHandle',
  'id',
  'legacy',
  'metadata',
  'occurredAt',
  'target',
  'targetHandle',
  'targetId',
  'targetType',
];

describe('Audit history feed', () => {
  const prisma = new PrismaService();
  const service = new AuditLogReadService(new AuditLogReadRepository(prisma));

  function seedUserHistory(row: {
    readonly id: string;
    readonly actorId?: string | null;
    readonly action: string;
    readonly targetId?: string;
    readonly occurredAt: string;
    readonly table?: 'UserHistory' | 'AdminHistory';
  }) {
    const data = JSON.stringify({
      schemaVersion: 1,
      recordKind: 'DOMAIN_EVENT',
      action: row.action,
      targetType: 'ROLE_REQUEST',
      targetId: row.targetId ?? row.id,
      metadata: {},
      request: null,
    });
    const history =
      row.table === 'AdminHistory'
        ? prisma.$executeRaw`
            INSERT INTO "AdminHistory" ("id", "userId", "actorId", "event", "occurredAt", "recordedAt", "source", "data")
            VALUES (${row.id}, ${STAFF_ID}, ${row.actorId ?? ADMIN_ID}, 'GRANTED', ${new Date(row.occurredAt)}, now(), 'APPLICATION', ${data}::jsonb)`
        : prisma.$executeRaw`
            INSERT INTO "UserHistory" ("id", "userId", "actorId", "event", "occurredAt", "recordedAt", "source", "data")
            VALUES (${row.id}, ${STAFF_ID}, ${row.actorId === undefined ? ADMIN_ID : row.actorId}, 'APPROVAL_REQUESTED', ${new Date(row.occurredAt)}, now(), 'APPLICATION', ${data}::jsonb)`;
    return history;
  }

  function seedTeamHistory(row: {
    readonly id: string;
    readonly actorId?: string | null;
    readonly event: Parameters<
      PrismaService['teamHistory']['create']
    >[0]['data']['event'];
    readonly occurredAt: string;
    readonly data: Record<string, unknown>;
    readonly teamId?: string;
    readonly programId?: string;
  }) {
    return prisma.teamHistory.create({
      data: {
        id: row.id,
        teamId: row.teamId ?? TEAM_ID,
        programId: row.programId ?? PROGRAM_ID,
        actorId: row.actorId === undefined ? ADMIN_ID : row.actorId,
        event: row.event,
        occurredAt: new Date(row.occurredAt),
        source: 'APPLICATION',
        data: { schemaVersion: 1, ...row.data },
      },
    });
  }

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: [
        {
          id: ADMIN_ID,
          githubId: 9_233_000_001n,
          nickname: 'synthetic-233-Admin',
        },
        {
          id: STAFF_ID,
          githubId: 9_233_000_002n,
          nickname: 'synthetic-233-staff',
        },
      ],
    });
    await prisma.program.create({
      data: {
        id: PROGRAM_ID,
        name: PROGRAM_NAME,
        startAt: new Date('2026-12-31T00:00:00.000Z'),
        endAt: new Date('2027-12-31T00:00:00.000Z'),
        organizer: 'synthetic',
        trackType: 'EXTRACURRICULAR',
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'synthetic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
        description: 'synthetic',
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        programId: PROGRAM_ID,
        name: TEAM_NAME,
        leaderId: ADMIN_ID,
        applicantId: ADMIN_ID,
        answers: {},
        applicationTemplateVersion: 1,
      },
    });
    await prisma.githubRepository.create({
      data: {
        id: REPOSITORY_ID,
        githubRepositoryId: 9_233_000_003n,
        nameWithOwner: REPOSITORY_NAME,
        source: 'EXTERNAL_PUBLIC',
      },
    });
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('네 이력 테이블의 행을 시간순으로 합치고 응답 필드 계약을 지킨다', async () => {
    await seedUserHistory({
      id: `${TEST_PREFIX}union-user`,
      action: 'UNION_FEED',
      occurredAt: '2080-01-01T01:00:00.000Z',
    });
    await seedUserHistory({
      id: `${TEST_PREFIX}union-admin`,
      action: 'UNION_FEED',
      occurredAt: '2080-01-01T04:00:00.000Z',
      table: 'AdminHistory',
    });
    await seedTeamHistory({
      id: `${TEST_PREFIX}union-team`,
      event: 'JOINED',
      occurredAt: '2080-01-01T02:00:00.000Z',
      data: {
        action: 'UNION_FEED',
        targetType: 'TEAM',
        targetId: TEAM_ID,
        metadata: { schemaVersion: 1, programName: 'Original', teamName: 'T' },
      },
    });
    await prisma.programHistory.create({
      data: {
        id: `${TEST_PREFIX}union-program`,
        programId: PROGRAM_ID,
        actorId: ADMIN_ID,
        event: 'CREATED',
        occurredAt: new Date('2080-01-01T03:00:00.000Z'),
        source: 'APPLICATION',
        data: {
          schemaVersion: 1,
          metadata: { schemaVersion: 1, programName: 'Original program' },
        },
      },
    });

    const result = await service.list({
      from: '2080-01-01',
      to: '2080-01-01',
      page: 1,
      limit: 20,
    });

    expect(result.items.map((record) => record.id)).toEqual([
      `${TEST_PREFIX}union-admin`,
      `${TEST_PREFIX}union-program`,
      `${TEST_PREFIX}union-team`,
      `${TEST_PREFIX}union-user`,
    ]);
    expect(result.items[1]).toMatchObject({
      action: 'PROGRAM_CREATED',
      targetType: 'PROGRAM',
      targetId: PROGRAM_ID,
      target: 'Original program',
      legacy: false,
    });
    expect(result.items[2]).toMatchObject({
      target: 'Original · T',
      legacy: false,
    });
    for (const record of result.items) {
      expect(Object.keys(record).sort()).toEqual(RECORD_KEYS);
      expect(record.legacy).toBe(record.metadata === null);
    }
  });

  it('actor 필터는 로그인 일부를 대소문자 없이 찾고 행위자 없는 행은 필터가 없을 때만 남긴다', async () => {
    await seedUserHistory({
      id: `${TEST_PREFIX}actor-admin`,
      action: 'ACTOR_FILTER',
      occurredAt: '2080-02-01T02:00:00.000Z',
    });
    await seedUserHistory({
      id: `${TEST_PREFIX}actor-staff`,
      actorId: STAFF_ID,
      action: 'ACTOR_FILTER',
      occurredAt: '2080-02-01T01:00:00.000Z',
    });
    await seedUserHistory({
      id: `${TEST_PREFIX}actor-none`,
      actorId: null,
      action: 'ACTOR_FILTER',
      occurredAt: '2080-02-01T00:00:00.000Z',
    });

    const unfiltered = await service.list({
      action: 'ACTOR_FILTER',
      page: 1,
      limit: 20,
    });
    const filtered = await service.list({
      actor: '233-ADMIN',
      action: 'ACTOR_FILTER',
      page: 1,
      limit: 20,
    });

    expect(unfiltered.items.map((record) => record.actor)).toEqual([
      'synthetic-233-Admin',
      'synthetic-233-staff',
      'SYSTEM',
    ]);
    expect(filtered.items.map((record) => record.id)).toEqual([
      `${TEST_PREFIX}actor-admin`,
    ]);
    expect(filtered.total).toBe(1);
  });

  it('ADMIN 필터 조회는 조건을 모두 적용하고 최신순으로 정렬한다', async () => {
    await seedUserHistory({
      id: `${TEST_PREFIX}older`,
      action: 'STAFF_ROLE_REQUEST_APPROVED',
      occurredAt: '2080-07-24T01:00:00.000Z',
    });
    await seedUserHistory({
      id: `${TEST_PREFIX}newer`,
      action: 'STAFF_ROLE_REQUEST_APPROVED',
      occurredAt: '2080-07-24T02:00:00.000Z',
    });
    await seedUserHistory({
      id: `${TEST_PREFIX}excluded`,
      action: 'STAFF_ROLE_REQUEST_REJECTED',
      occurredAt: '2080-07-24T03:00:00.000Z',
    });

    const result = await service.list({
      actor: '233-admin',
      action: 'STAFF_ROLE_REQUEST_APPROVED',
      from: '2080-07-24',
      to: '2080-07-24',
      page: 1,
      limit: 20,
    });

    expect(result.items.map((record) => record.id)).toEqual([
      `${TEST_PREFIX}newer`,
      `${TEST_PREFIX}older`,
    ]);
    expect(result.items).toEqual([
      expect.objectContaining({ legacy: true, metadata: null }),
      expect.objectContaining({ legacy: true, metadata: null }),
    ]);
    expect(result.total).toBe(2);
  });

  it('동일한 발생 시각의 행을 두 페이지에서 누락·중복 없이 id 역순으로 조회한다', async () => {
    const insertedIds = [1, 2, 3, 4].map((tie) => `${TEST_PREFIX}tie-${tie}`);
    for (const id of insertedIds) {
      await seedUserHistory({
        id,
        action: 'TIED_TIMESTAMP_PAGINATION',
        occurredAt: '2080-07-25T03:00:00.000Z',
      });
    }

    const firstPage = await service.list({
      action: 'TIED_TIMESTAMP_PAGINATION',
      page: 1,
      limit: 2,
    });
    const secondPage = await service.list({
      action: 'TIED_TIMESTAMP_PAGINATION',
      page: 2,
      limit: 2,
    });
    const emptyPage = await service.list({
      action: 'TIED_TIMESTAMP_PAGINATION',
      page: 3,
      limit: 2,
    });

    expect(
      [...firstPage.items, ...secondPage.items].map((record) => record.id),
    ).toEqual([...insertedIds].reverse());
    expect([firstPage.total, secondPage.total, emptyPage.total]).toEqual([
      4, 4, 4,
    ]);
    expect(emptyPage.items).toEqual([]);
  });

  it('선택한 한국 날짜의 00:00부터 23:59:59.999까지만 조회한다', async () => {
    const boundaries = [
      ['before', '2080-07-23T14:59:59.999Z'],
      ['start', '2080-07-23T15:00:00.000Z'],
      ['end', '2080-07-24T14:59:59.999Z'],
      ['after', '2080-07-24T15:00:00.000Z'],
    ] as const;
    for (const [name, occurredAt] of boundaries) {
      await seedUserHistory({
        id: `${TEST_PREFIX}boundary-${name}`,
        action: 'BOUNDARY',
        targetId: name,
        occurredAt,
      });
    }

    const result = await service.list({
      action: 'BOUNDARY',
      from: '2080-07-24',
      to: '2080-07-24',
      page: 1,
      limit: 20,
    });

    expect(result.items.map((record) => record.targetId)).toEqual([
      'end',
      'start',
    ]);
  });

  it('팀 이력은 표시에 필요한 값만 내보내고 초대 이벤트는 피드에서 뺀다', async () => {
    const day = '2080-03-01';
    await seedTeamHistory({
      id: `${TEST_PREFIX}native-renamed`,
      event: 'RENAMED',
      occurredAt: `${day}T05:00:00.000Z`,
      data: { previousName: 'Before', name: 'After' },
    });
    await seedTeamHistory({
      id: `${TEST_PREFIX}native-removed`,
      event: 'MEMBER_REMOVED',
      occurredAt: `${day}T04:00:00.000Z`,
      data: {
        name: TEAM_NAME,
        removedUserId: STAFF_ID,
        previousLeaderId: ADMIN_ID,
        nextLeaderId: null,
      },
    });
    await seedTeamHistory({
      id: `${TEST_PREFIX}native-deleted`,
      actorId: null,
      event: 'DELETED',
      occurredAt: `${day}T03:00:00.000Z`,
      data: {
        reason: 'APPLICATIONLESS_TEAM',
        name: 'Deleted team',
        leaderId: ADMIN_ID,
        status: 'DRAFT',
        members: [{ userId: STAFF_ID }],
        deletedCounts: { members: 1 },
      },
    });
    await seedTeamHistory({
      id: `${TEST_PREFIX}native-review`,
      event: 'REJECTED',
      occurredAt: `${day}T02:00:00.000Z`,
      data: { revision: 2, rejectionReason: 'private review reason' },
    });
    await seedTeamHistory({
      id: `${TEST_PREFIX}native-invitation`,
      event: 'INVITATION_ACCEPTED',
      occurredAt: `${day}T01:00:00.000Z`,
      data: {
        invitation: {
          id: 'invitation',
          inviteeId: STAFF_ID,
          invitedById: ADMIN_ID,
          createdAt: `${day}T00:00:00.000Z`,
        },
      },
    });

    const result = await service.list({
      from: day,
      to: day,
      page: 1,
      limit: 20,
    });

    const program = PROGRAM_NAME;
    expect(
      result.items.map((record) => [
        record.action,
        record.actor,
        record.target,
        record.metadata,
      ]),
    ).toEqual([
      [
        'TEAM_RENAMED',
        'synthetic-233-Admin',
        `${program} · After`,
        {
          schemaVersion: 1,
          programName: program,
          teamName: 'After',
          previousName: 'Before',
        },
      ],
      [
        'TEAM_MEMBERSHIP_CHANGED',
        'synthetic-233-Admin',
        `${program} · ${TEAM_NAME}`,
        {
          schemaVersion: 1,
          programName: program,
          teamName: TEAM_NAME,
          operation: 'REMOVE',
          removedUserId: STAFF_ID,
          previousLeaderId: ADMIN_ID,
          nextLeaderId: null,
        },
      ],
      [
        'TEAM_DELETED',
        'SYSTEM',
        `${program} · Deleted team`,
        { schemaVersion: 1, programName: program, teamName: 'Deleted team' },
      ],
      [
        'APPLICATION_REJECTED',
        'synthetic-233-Admin',
        `${program} · ${TEAM_NAME}`,
        { schemaVersion: 1, programName: program, teamName: TEAM_NAME },
      ],
    ]);
    expect(result.total).toBe(4);
  });

  it('대상 라벨은 이벤트 시점 값이 없으면 현재 이름으로 대체하고 사라진 대상은 식별자로 표시한다', async () => {
    const day = '2080-04-01';
    await seedTeamHistory({
      id: `${TEST_PREFIX}label-repository`,
      event: 'REPOSITORY_PUBLISHED',
      occurredAt: `${day}T03:00:00.000Z`,
      data: {
        targetType: 'REPOSITORY',
        targetId: REPOSITORY_ID,
        metadata: { schemaVersion: 1, repositoryId: REPOSITORY_ID },
      },
    });
    await prisma.programHistory.create({
      data: {
        id: `${TEST_PREFIX}label-program`,
        programId: PROGRAM_ID,
        actorId: ADMIN_ID,
        event: 'CREATED',
        occurredAt: new Date(`${day}T02:00:00.000Z`),
        source: 'APPLICATION',
        data: { schemaVersion: 1, metadata: {} },
      },
    });
    await prisma.programHistory.create({
      data: {
        id: `${TEST_PREFIX}label-gone`,
        programId: `${TEST_PREFIX}gone-program`,
        actorId: ADMIN_ID,
        event: 'DELETED',
        occurredAt: new Date(`${day}T01:00:00.000Z`),
        source: 'APPLICATION',
        data: { schemaVersion: 1, metadata: {} },
      },
    });

    const result = await service.list({
      from: day,
      to: day,
      page: 1,
      limit: 20,
    });

    expect(result.items.map((record) => record.target)).toEqual([
      REPOSITORY_NAME,
      PROGRAM_NAME,
      `PROGRAM / ${TEST_PREFIX}gone-program`,
    ]);
  });
});
