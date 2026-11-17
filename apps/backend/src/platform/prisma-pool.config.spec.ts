import { createServer, type Server, type Socket } from 'node:net';
import { Pool } from 'pg';
import { loadPrismaPoolConfig } from './prisma-pool.config';

const BASE = 'postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic';

describe('loadPrismaPoolConfig', () => {
  it('uses the Prisma 6 defaults when the URL sets no pool parameters', () => {
    const physicalCpus = jest.fn(() => 4);

    const config = loadPrismaPoolConfig(`${BASE}?schema=public`, physicalCpus);

    expect(physicalCpus).toHaveBeenCalledTimes(1);
    expect(config).toMatchObject({
      connectionString: `${BASE}?schema=public`,
      max: 9,
      connectionTimeoutMillis: 10_000,
      connectTimeoutMillis: 5_000,
      idleTimeoutMillis: 300_000,
      maxLifetimeSeconds: 0,
    });
  });

  it('maps every Prisma 6 pool parameter and strips it from the pg URL', () => {
    const physicalCpus = jest.fn(() => 4);

    const config = loadPrismaPoolConfig(
      `${BASE}?schema=public&connection_limit=1&pool_timeout=10&connect_timeout=3&max_idle_connection_lifetime=60&max_connection_lifetime=600`,
      physicalCpus,
    );

    expect(physicalCpus).not.toHaveBeenCalled();
    expect(config).toMatchObject({
      connectionString: `${BASE}?schema=public`,
      max: 1,
      connectionTimeoutMillis: 10_000,
      connectTimeoutMillis: 3_000,
      idleTimeoutMillis: 60_000,
      maxLifetimeSeconds: 600,
    });
  });

  it('keeps 0 as no timeout like Prisma 6', () => {
    expect(
      loadPrismaPoolConfig(`${BASE}?pool_timeout=0&connect_timeout=0`, () => 1),
    ).toMatchObject({ connectionTimeoutMillis: 0, connectTimeoutMillis: 0 });
  });

  it.each(['connection_limit=0', 'connection_limit=x', 'pool_timeout=-1'])(
    'rejects %s',
    (parameter) => {
      expect(() =>
        loadPrismaPoolConfig(`${BASE}?${parameter}`, () => 1),
      ).toThrow(TypeError);
    },
  );

  describe('connect timeout', () => {
    let server: Server;
    const sockets: Socket[] = [];

    beforeAll(async () => {
      server = createServer((socket) => sockets.push(socket));
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
    });

    afterAll(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('bounds a new connection by connect_timeout, not by pool_timeout', async () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('listener has no TCP port');
      }
      const pool = new Pool(
        loadPrismaPoolConfig(
          `postgresql://synthetic:synthetic@127.0.0.1:${address.port}/synthetic?connect_timeout=1&pool_timeout=10`,
          () => 1,
        ),
      );
      const startedAt = performance.now();
      try {
        await expect(pool.connect()).rejects.toThrow(/timeout/i);
        const elapsed = performance.now() - startedAt;
        expect(elapsed).toBeGreaterThanOrEqual(900);
        expect(elapsed).toBeLessThan(5_000);
      } finally {
        await pool.end();
      }
    });
  });
});
