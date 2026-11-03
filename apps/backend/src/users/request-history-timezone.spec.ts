import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

it.each(['UTC', 'Asia/Seoul'] as const)(
  'preserves imported timestamps and explicit offsets under TZ=%s',
  async (timezone) => {
    const script = `
    const { AdminAccessHistoryRepository } = require('./src/users/admin-access-history.repository');
    const timestamps = [
      ['2026-09-02T00:00:00', '2026-09-03T00:00:00'],
      ['2026-01-02T00:00:00.1', '2026-01-03T00:00:00.4'],
      ['2026-01-02T00:00:00.12', '2026-01-03T00:00:00.45'],
      ['2026-01-02T00:00:00.123', '2026-01-03T00:00:00.456'],
      ['2026-01-02T00:00:00.123Z', '2026-01-03T00:00:00.456Z'],
      ['2026-01-02T09:00:00.123+09:00', '2026-01-03T09:00:00.456+09:00'],
      ['2026-01-02T00:00:00.123', null],
    ];
    Promise.all(timestamps.map(async ([createdAt, decidedAt], index) => {
      const request = {
        id: 'request-' + index, userId: 'target',
        status: decidedAt === null ? 'PENDING' : 'REVOKED',
        createdAt, decidedAt,
        decidedById: decidedAt === null ? null : 'actor', rejectionReason: null,
      };
      const prisma = {
        userHistory: { findMany: async () => [{
          event: 'LEGACY_IMPORT',
          data: { schemaVersion: 1, recordKind: 'REQUEST_SNAPSHOT', original: request },
        }] },
        user: { findMany: async () => [{ id: 'actor', nickname: 'actor' }] },
      };
      const result = await new AdminAccessHistoryRepository()
        .listAdminAccessStaffAccessRequestHistory(prisma, 'target', { page: 1, limit: 20 });
      const item = result.items[0];
      if (!item) throw new Error('Missing imported request');
      return {
        createdAt: item.createdAt.toISOString(),
        decidedAt: item.decidedAt === null ? null : item.decidedAt.toISOString(),
      };
    }))
      .then(results => process.stdout.write(JSON.stringify(results)))
      .catch(error => {
        process.stderr.write(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  `;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['-r', 'ts-node/register', '-e', script],
      {
        cwd: resolve(__dirname, '../..'),
        env: { ...process.env, TZ: timezone },
        timeout: 20000,
      },
    );
    expect(stdout).toBe(
      JSON.stringify([
        {
          createdAt: '2026-09-02T00:00:00.000Z',
          decidedAt: '2026-09-03T00:00:00.000Z',
        },
        {
          createdAt: '2026-01-02T00:00:00.100Z',
          decidedAt: '2026-01-03T00:00:00.400Z',
        },
        {
          createdAt: '2026-01-02T00:00:00.120Z',
          decidedAt: '2026-01-03T00:00:00.450Z',
        },
        {
          createdAt: '2026-01-02T00:00:00.123Z',
          decidedAt: '2026-01-03T00:00:00.456Z',
        },
        {
          createdAt: '2026-01-02T00:00:00.123Z',
          decidedAt: '2026-01-03T00:00:00.456Z',
        },
        {
          createdAt: '2026-01-02T00:00:00.123Z',
          decidedAt: '2026-01-03T00:00:00.456Z',
        },
        { createdAt: '2026-01-02T00:00:00.123Z', decidedAt: null },
      ]),
    );
  },
  30000,
);
