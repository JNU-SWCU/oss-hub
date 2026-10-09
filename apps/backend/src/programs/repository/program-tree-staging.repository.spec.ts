import { Prisma } from '@prisma/client';
import { ProgramEditorRepository } from './program-editor.repository';
import { PrismaService } from '../../prisma/prisma.service';

it.each([
  'findMilestoneForUpdate',
  'lockMilestoneEdit',
  'findMilestoneForDelete',
] as const)('%s preserves staged SQL and intervening reads', async (method) => {
  const events: string[] = [];
  const queries: Prisma.Sql[] = [];
  const tx = {
    $queryRaw: jest.fn((sql: Prisma.Sql) => {
      queries.push(sql);
      const table = sql.strings.join('').includes('MilestoneDocument')
        ? 'documents'
        : sql.strings.join('').includes('"Program"')
          ? 'program'
          : 'milestone';
      events.push(table);
      return Promise.resolve([
        { id: table === 'program' ? 'p' : 'm', programId: 'p' },
      ]);
    }),
    milestone: {
      findUnique: jest.fn(() => {
        events.push('read');
        return Promise.resolve({
          id: 'm',
          programId: 'p',
          name: 'Final',
          startAt: null,
          dueAt: new Date('2026-08-20T00:00:00Z'),
          submissionType: null,
          instructions: null,
          updatedAt: new Date('2026-08-16T00:00:00Z'),
          program: {
            startAt: null,
            endAt: new Date('2026-08-31T00:00:00Z'),
            repositoryProvisioningEnabled: false,
            _count: { milestones: 2 },
          },
        });
      }),
    },
    milestoneDocument: {
      findMany: jest.fn(() => {
        events.push('document-read');
        return Promise.resolve([]);
      }),
    },
    milestoneDocumentSubmission: {
      count: jest.fn(() => {
        events.push('count');
        return Promise.resolve(0);
      }),
    },
  };
  const repository = new ProgramEditorRepository({
    $transaction: (operation: (client: typeof tx) => Promise<unknown>) =>
      operation(tx),
  } as unknown as PrismaService);
  const result = await repository.withTransaction<unknown>((store) =>
    store[method]('m'),
  );
  expect(result).toMatchObject({ programId: 'p' });
  expect(events).toEqual(
    method === 'findMilestoneForUpdate'
      ? ['read', 'program', 'milestone', 'read']
      : method === 'lockMilestoneEdit'
        ? ['read', 'program', 'milestone', 'read', 'documents', 'document-read']
        : ['read', 'program', 'milestone', 'documents', 'read', 'count'],
  );
  expect(queries.map((sql) => sql.values)).toEqual(
    method === 'findMilestoneForUpdate'
      ? [['p'], ['m']]
      : method === 'lockMilestoneEdit'
        ? [['p'], ['m'], ['m', 'DOCUMENT']]
        : [['p'], ['m'], ['m']],
  );
});

it.each([
  'findEditableProgramForUpdate',
  'findProgramScheduleForMilestoneCreate',
] as const)('%s locks only Program before its read', async (method) => {
  const tx = {
    $queryRaw: jest
      .fn<Promise<readonly { id: string }[]>, [Prisma.Sql]>()
      .mockResolvedValue([{ id: 'p' }]),
    program: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const repository = new ProgramEditorRepository({
    $transaction: (operation: (client: typeof tx) => Promise<unknown>) =>
      operation(tx),
  } as unknown as PrismaService);
  if (method === 'findEditableProgramForUpdate') {
    tx.$queryRaw.mockResolvedValue([]);
  }
  await expect(
    repository.withTransaction<unknown>((store) => store[method]('p')),
  ).resolves.toBeNull();
  expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  const sql = tx.$queryRaw.mock.calls[0]?.[0];
  if (sql === undefined) throw new Error('Expected parent lock SQL.');
  expect(sql.strings.join('')).toContain('FROM "Program"');
  expect(sql.values).toEqual(['p']);
  expect(tx.program.findUnique).toHaveBeenCalledTimes(
    method === 'findEditableProgramForUpdate' ? 0 : 1,
  );
});
