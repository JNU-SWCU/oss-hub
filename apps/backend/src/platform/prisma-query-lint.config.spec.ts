import { Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  loadPrismaQueryLintConfig,
  PrismaQueryLintError,
} from './prisma-query-lint.config';

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

  it('rejects a top-level take that evaluates to undefined', async () => {
    const take = new Map<string, number>().get('pageSize');
    await expect(
      lintedClient().user.findMany({ take, select: { id: true } }),
    ).rejects.toMatchObject({
      code: 'LINT.NO_LIMIT',
      key: 'User.findMany',
    });
  });

  it('rejects a nested relation take that evaluates to undefined', async () => {
    const take = new Map<string, number>().get('pageSize');
    await expect(
      lintedClient().program.findFirst({
        select: { teams: { take, select: { id: true } } },
      }),
    ).rejects.toMatchObject({
      code: 'LINT.NESTED_NO_LIMIT',
      key: 'Program.findFirst.teams',
    });
  });

  it('rejects deleteMany and updateMany without a where filter', async () => {
    const prisma = lintedClient();

    await expect(prisma.user.deleteMany({})).rejects.toMatchObject({
      code: 'LINT.DELETE_WITHOUT_WHERE',
      key: 'User.deleteMany',
    });
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

  it('warns once per operation for reads without select', async () => {
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
      '[LINT.SELECT_STAR] Admin.findFirst: select 없이 모든 열을 읽습니다.',
    );
    warn.mockRestore();
  });
});
