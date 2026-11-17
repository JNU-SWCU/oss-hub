import { Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  loadPrismaQueryLintConfig,
  PrismaQueryLintError,
} from './prisma-query-lint.config';

const FILE = 'apps/backend/src/platform/prisma-query-lint.config.spec.ts';
const CALLER = `${FILE}#<module>`;
const clients: PrismaClient[] = [];

function unreachableClient(): PrismaClient {
  const client = new PrismaClient({
    adapter: new PrismaPg({
      connectionString:
        'postgresql://synthetic:synthetic@127.0.0.1:1/synthetic',
    }),
  });
  clients.push(client);
  return client;
}

function lintedClient(): PrismaClient {
  return loadPrismaQueryLintConfig({ nodeEnv: 'test' }).createLintedClient(
    unreachableClient(),
  );
}

async function lintCode(query: Promise<unknown>): Promise<string | undefined> {
  try {
    await query;
  } catch (error) {
    if (error instanceof PrismaQueryLintError) return error.code;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P1001'
    )
      return undefined;
    throw error;
  }
  throw new Error('unreachable database query unexpectedly succeeded');
}

class ProbeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  added() {
    return this.prisma.user.findMany({ where: { name: 'x' } });
  }

  optionalLimit(optionalLimit?: number) {
    return Promise.all([
      this.prisma.user.findMany({ take: 10 }),
      this.prisma.user.findMany({ take: optionalLimit }),
    ]);
  }
}

class ProbeService {
  constructor(private readonly repository: ProbeRepository) {}

  run() {
    return this.repository.added();
  }
}

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
});

describe('loadPrismaQueryLintConfig', () => {
  it('returns the client unchanged in production', () => {
    const client = unreachableClient();
    const extend = jest.spyOn(client, '$extends');

    const linted = loadPrismaQueryLintConfig({
      nodeEnv: 'production',
    }).createLintedClient(client);

    expect(linted).toBe(client);
    expect(extend).not.toHaveBeenCalled();
  });

  it('rejects findMany without take and names the rule and caller', async () => {
    const prisma = lintedClient();

    await expect(prisma.user.findMany({ where: {} })).rejects.toMatchObject({
      code: 'LINT.NO_LIMIT',
      key: `User.findMany@${CALLER}`,
    });
    expect(await lintCode(prisma.user.findMany())).toBe('LINT.NO_LIMIT');
    expect(
      await lintCode(prisma.teamMember.findMany({ where: { teamId: 'team' } })),
    ).toBe('LINT.NO_LIMIT');
    expect(
      await lintCode(
        prisma.user.findMany({ where: { OR: [{ id: 'a' }, { id: 'b' }] } }),
      ),
    ).toBe('LINT.NO_LIMIT');
  });

  it('passes findMany bounded by take or by a primary or unique key', async () => {
    const prisma = lintedClient();

    expect(await lintCode(prisma.user.findMany({ take: 10 }))).toBeUndefined();
    expect(
      await lintCode(
        prisma.user.findMany({ where: { id: { in: ['a', 'b'] } } }),
      ),
    ).toBeUndefined();
    expect(
      await lintCode(prisma.user.findMany({ where: { githubId: 7n } })),
    ).toBeUndefined();
    expect(
      await lintCode(
        prisma.teamMember.findMany({
          where: { AND: [{ teamId: 'team' }, { userId: { in: ['a'] } }] },
        }),
      ),
    ).toBeUndefined();
  });

  it('rejects deleteMany and updateMany without a where filter', async () => {
    const prisma = lintedClient();

    expect(await lintCode(prisma.user.deleteMany({}))).toBe(
      'LINT.DELETE_WITHOUT_WHERE',
    );
    expect(await lintCode(prisma.user.deleteMany())).toBe(
      'LINT.DELETE_WITHOUT_WHERE',
    );
    expect(
      await lintCode(
        prisma.user.updateMany({ data: { name: 'x' }, where: {} }),
      ),
    ).toBe('LINT.UPDATE_WITHOUT_WHERE');
    expect(
      await lintCode(prisma.user.deleteMany({ where: { id: 'a' } })),
    ).toBeUndefined();
  });

  it('names the enclosing method as the caller', async () => {
    const prisma = lintedClient();
    const repository = new ProbeRepository(prisma);

    await expect(repository.added()).rejects.toMatchObject({
      code: 'LINT.NO_LIMIT',
      key: `User.findMany@${FILE}#ProbeRepository.added`,
    });
    await expect(new ProbeService(repository).run()).rejects.toMatchObject({
      key: `User.findMany@${FILE}#ProbeRepository.added`,
    });
    await expect(prisma.user.findMany()).rejects.toMatchObject({
      key: `User.findMany@${CALLER}`,
    });
  });

  it('warns once for reads without select and never throws for it', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const prisma = lintedClient();

    await lintCode(prisma.admin.findFirst({ where: { userId: 'a' } }));
    await lintCode(prisma.admin.findFirst({ where: { userId: 'b' } }));
    await lintCode(
      prisma.admin.findFirst({
        where: { userId: 'c' },
        select: { userId: true },
      }),
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`[LINT.SELECT_STAR] Admin.findFirst@${CALLER}`),
    );
    warn.mockRestore();
  });

  it('treats an undefined or null take like a missing take', async () => {
    const prisma = lintedClient();
    const repository = new ProbeRepository(prisma);

    await expect(repository.optionalLimit()).rejects.toMatchObject({
      code: 'LINT.NO_LIMIT',
      key: `User.findMany@${FILE}#ProbeRepository.optionalLimit`,
    });
    expect(await lintCode(repository.optionalLimit(5))).toBeUndefined();
    expect(
      await lintCode(prisma.user.findMany({ take: null as unknown as number })),
    ).toBe('LINT.NO_LIMIT');
  });
});
