import { Prisma } from '@prisma/client';
import { LockProgramTreeRepository } from './lock-program-tree.repository';

const locks = new LockProgramTreeRepository();

function transaction() {
  const query = jest.fn((sql: Prisma.Sql) =>
    Promise.resolve(
      sql.strings.join('').includes('MilestoneDocument')
        ? [{ id: 'd' }]
        : [{ id: sql.values[0], programId: 'p' }],
    ),
  );
  return {
    tx: { $queryRaw: query } as unknown as Prisma.TransactionClient,
    query,
  };
}

describe('lockProgramTree', () => {
  it.each(['DOCUMENT', 'ALL'] as const)(
    'preserves ordered %s scope without reacquisition',
    async (documentKind) => {
      const { tx, query } = transaction();
      const p = await locks.lockProgramTree(tx, {
        stage: 'program',
        programId: 'p',
      });
      if (!p) throw new Error('missing program');
      const m = await locks.lockProgramTree(tx, {
        stage: 'milestone',
        milestoneId: 'm',
        after: p,
      });
      if (!m) throw new Error('missing milestone');
      expect(
        await locks.lockProgramTree(tx, {
          stage: 'documents',
          after: m,
          documentKind,
        }),
      ).toEqual({ documentIds: ['d'] });
      const sql = query.mock.calls[2]?.[0];
      expect(sql?.values).toEqual(
        documentKind === 'DOCUMENT' ? ['m', 'DOCUMENT'] : ['m'],
      );
      expect(sql?.strings.join('')).toContain('ORDER BY "id"');
      await expect(
        locks.lockProgramTree(tx, {
          stage: 'program',
          programId: 'p',
        }),
      ).rejects.toHaveProperty('name', 'LockOrderError');
      await expect(
        locks.lockProgramTree(tx, {
          stage: 'milestone',
          milestoneId: 'm',
          after: p,
        }),
      ).rejects.toHaveProperty('name', 'LockOrderError');
      await expect(
        locks.lockProgramTree(tx, {
          stage: 'documents',
          after: m,
          documentKind,
        }),
      ).rejects.toHaveProperty('name', 'LockOrderError');
      expect(query).toHaveBeenCalledTimes(3);
    },
  );

  it('rejects repeats and foreign witnesses before issuing SQL', async () => {
    const first = transaction();
    const second = transaction();
    const p = await locks.lockProgramTree(first.tx, {
      stage: 'program',
      programId: 'p',
    });
    if (!p) throw new Error('missing program');
    await expect(
      locks.lockProgramTree(first.tx, {
        stage: 'program',
        programId: 'other',
      }),
    ).rejects.toHaveProperty('name', 'LockOrderError');
    await expect(
      locks.lockProgramTree(second.tx, {
        stage: 'milestone',
        milestoneId: 'm',
        after: p,
      }),
    ).rejects.toHaveProperty('name', 'LockOrderError');
    const m = await locks.lockProgramTree(first.tx, {
      stage: 'milestone',
      milestoneId: 'm',
      after: p,
    });
    if (!m) throw new Error('missing milestone');
    await expect(
      locks.lockProgramTree(first.tx, {
        stage: 'milestone',
        milestoneId: 'other',
        after: p,
      }),
    ).rejects.toHaveProperty('name', 'LockOrderError');
    await expect(
      locks.lockProgramTree(second.tx, {
        stage: 'documents',
        after: m,
        documentKind: 'ALL',
      }),
    ).rejects.toHaveProperty('name', 'LockOrderError');
    expect(second.query).not.toHaveBeenCalled();
  });

  it('permits milestone-only flows but refuses later parent locks', async () => {
    const { tx, query } = transaction();
    const m = await locks.lockProgramTree(tx, {
      stage: 'milestone',
      milestoneId: 'm',
    });
    if (!m) throw new Error('missing milestone');
    await expect(
      locks.lockProgramTree(tx, {
        stage: 'program',
        programId: 'p',
      }),
    ).rejects.toHaveProperty('name', 'LockOrderError');
    await locks.lockProgramTree(tx, {
      stage: 'documents',
      after: m,
      documentKind: 'DOCUMENT',
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('preserves missing row results', async () => {
    const { tx, query } = transaction();
    query.mockResolvedValue([]);
    await expect(
      locks.lockProgramTree(tx, {
        stage: 'program',
        programId: 'missing',
      }),
    ).resolves.toBeNull();
    const other = transaction();
    other.query.mockResolvedValue([]);
    await expect(
      locks.lockProgramTree(other.tx, {
        stage: 'milestone',
        milestoneId: 'missing',
      }),
    ).resolves.toBeNull();
  });
});
