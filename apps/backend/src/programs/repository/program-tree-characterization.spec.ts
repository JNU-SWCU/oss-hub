import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgramEditorRepository } from './program-editor.repository';

describe('program tree early returns', () => {
  it.each([
    'findMilestoneForUpdate',
    'lockMilestoneEdit',
    'findMilestoneForDelete',
  ] as const)(
    '%s preserves ownership discovery and missing-row exits',
    async (method) => {
      for (const missing of [
        'ownership',
        'program',
        'milestone',
        'read',
        'mismatch',
      ]) {
        const events: string[] = [];
        const queries: Prisma.Sql[] = [];
        const transaction = {
          $queryRaw: jest.fn((query: Prisma.Sql) => {
            queries.push(query);
            const table = queries.length === 1 ? 'Program' : 'Milestone';
            events.push(table);
            if (missing === table.toLowerCase()) return Promise.resolve([]);
            return Promise.resolve([
              { id: table === 'Program' ? 'p' : 'm', programId: 'p' },
            ]);
          }),
          milestone: {
            findUnique: jest.fn(() => {
              events.push('read');
              if (events.length === 1)
                return Promise.resolve(
                  missing === 'ownership' ? null : { programId: 'p' },
                );
              return Promise.resolve(
                missing === 'read' ? null : { programId: 'other' },
              );
            }),
          },
        };
        const repository = new ProgramEditorRepository({
          $transaction: async (
            operation: (tx: typeof transaction) => Promise<unknown>,
          ) => operation(transaction),
        } as unknown as PrismaService);
        await expect(
          repository.withTransaction<unknown>((store) => store[method]('m')),
        ).resolves.toBeNull();
        expect(events.slice(0, 3)).toEqual(
          missing === 'ownership'
            ? ['read']
            : missing === 'program'
              ? ['read', 'Program']
              : ['read', 'Program', 'Milestone'],
        );
        expect(queries[0]?.values).toEqual(
          missing === 'ownership' ? undefined : ['p'],
        );
        if (queries.length > 1) expect(queries[1]?.values).toEqual(['m']);
        expect(
          queries.filter((query) =>
            query.strings.join('').includes('MilestoneDocument'),
          ),
        ).toHaveLength(
          method === 'findMilestoneForDelete' &&
            ['read', 'mismatch'].includes(missing)
            ? 1
            : 0,
        );
      }
    },
  );
});
