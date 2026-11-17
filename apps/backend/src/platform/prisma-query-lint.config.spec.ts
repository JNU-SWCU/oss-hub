import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import {
  loadPrismaQueryLintConfig,
  PrismaQueryLintError,
} from './prisma-query-lint.config';

const CALLER = 'apps/backend/src/platform/prisma-query-lint.config.spec.ts';
const directory = mkdtempSync(join(tmpdir(), 'prisma-query-lint-'));
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

function allowlistFile(content: unknown): string {
  const file = join(directory, `${clients.length}-${Math.random()}.json`);
  writeFileSync(file, JSON.stringify(content));
  return file;
}

function lintedClient(allowlist: unknown = {}): PrismaClient {
  return loadPrismaQueryLintConfig({
    nodeEnv: 'test',
    allowlistPath: allowlistFile(allowlist),
  }).createLintedClient(unreachableClient());
}

async function lintCode(query: Promise<unknown>): Promise<string | undefined> {
  try {
    await query;
  } catch (error) {
    if (error instanceof PrismaQueryLintError) return error.code;
    return undefined;
  }
  throw new Error('unreachable database query unexpectedly succeeded');
}

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  rmSync(directory, { recursive: true, force: true });
});

describe('loadPrismaQueryLintConfig', () => {
  it('returns the client unchanged in production without reading the allowlist', () => {
    const client = unreachableClient();
    const extend = jest.spyOn(client, '$extends');

    const linted = loadPrismaQueryLintConfig({
      nodeEnv: 'production',
      allowlistPath: join(directory, 'missing.json'),
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

  it('lets an allowlisted caller through', async () => {
    const prisma = lintedClient({
      [`User.findMany@${CALLER}`]: { reason: 'bounded synthetic fixture' },
    });

    expect(await lintCode(prisma.user.findMany())).toBeUndefined();
    expect(await lintCode(prisma.user.deleteMany())).toBe(
      'LINT.DELETE_WITHOUT_WHERE',
    );
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

  it('rejects allowlist entries without a reason or with an unknown key', () => {
    const load = (allowlist: unknown) => () =>
      loadPrismaQueryLintConfig({
        nodeEnv: 'test',
        allowlistPath: allowlistFile(allowlist),
      });

    expect(load({ [`User.findMany@${CALLER}`]: { reason: ' ' } })).toThrow(
      /reason/,
    );
    expect(load({ [`User.findMany@${CALLER}`]: {} })).toThrow(/reason/);
    expect(load({ [`Nope.findMany@${CALLER}`]: { reason: 'x' } })).toThrow(
      /Nope\.findMany/,
    );
    expect(load({ [`User.findFirst@${CALLER}`]: { reason: 'x' } })).toThrow(
      /User\.findFirst/,
    );
  });

  it('reports allowlist entries whose file or call no longer exists', () => {
    const config = loadPrismaQueryLintConfig({
      nodeEnv: 'test',
      allowlistPath: allowlistFile({
        'User.findMany@apps/backend/src/platform/missing.ts': { reason: 'x' },
        [`Program.deleteMany@${CALLER}`]: { reason: 'x' },
        [`User.findMany@${CALLER}`]: { reason: 'x' },
      }),
    });

    expect(config.auditAllowlist()).toEqual([
      expect.stringContaining(
        'User.findMany@apps/backend/src/platform/missing.ts',
      ),
      expect.stringContaining(`Program.deleteMany@${CALLER}`),
    ]);
  });

  it('keeps every committed allowlist entry current', () => {
    expect(
      loadPrismaQueryLintConfig({ nodeEnv: 'test' }).auditAllowlist(),
    ).toEqual([]);
  });
});
