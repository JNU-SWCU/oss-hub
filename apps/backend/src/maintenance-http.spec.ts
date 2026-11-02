import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { request, Server } from 'node:http';
import { bootstrap } from './main';
import { MaintenanceConfig } from './github/maintenance.config';
import { AuthConfig } from './platform/auth.config';
import { HealthService } from './platform/health.service';
import { RUNTIME_CONFIG } from './platform/runtime-config-instance.config';
import { loadRuntimeConfig } from './platform/runtime-config.config';

describe('running maintenance state HTTP boundary', () => {
  let app: INestApplication;
  const databaseReady = jest.fn<Promise<void>, []>();
  const registry = new SchedulerRegistry();
  const deniedCases: readonly {
    readonly mode: boolean;
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
  }[] = [
    { mode: false, method: 'GET', headers: { host: '127.0.0.1:0' } },
    { mode: true, method: 'POST', headers: { host: '127.0.0.1:0' } },
    { mode: true, method: 'GET', headers: { host: 'public.example.test' } },
    {
      mode: true,
      method: 'GET',
      headers: { host: '127.0.0.1:0', 'x-forwarded-for': '127.0.0.1' },
    },
    {
      mode: true,
      method: 'GET',
      headers: { host: '127.0.0.1:0', forwarded: 'for=127.0.0.1' },
    },
  ];

  beforeEach(async () => {
    databaseReady.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: AuthConfig, useValue: { validate: () => undefined } },
        {
          provide: HealthService,
          useValue: { assertDatabaseReachable: databaseReady },
        },
        { provide: SchedulerRegistry, useValue: registry },
        { provide: RUNTIME_CONFIG, useValue: loadRuntimeConfig({ PORT: '0' }) },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    jest.spyOn(NestFactory, 'create').mockResolvedValue(app);
  });

  afterEach(async () => {
    await app.close();
    for (const name of registry.getCronJobs().keys())
      registry.deleteCronJob(name);
    databaseReady.mockReset();
    jest.restoreAllMocks();
  });

  async function readState(
    method = 'GET',
    headers: Readonly<Record<string, string>> = { host: '127.0.0.1:0' },
  ) {
    const server: unknown = app.getHttpServer();
    if (!(server instanceof Server)) throw new Error('HTTP server is required');
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Bound TCP address is required');
    }
    return new Promise<{
      readonly status: number | undefined;
      readonly body: string;
    }>((resolve, reject) => {
      const outgoing = request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/internal/maintenance-state',
          method,
          headers,
          signal: AbortSignal.timeout(5_000),
        },
        (response) => {
          response.setEncoding('utf8');
          let body = '';
          response.on('data', (chunk: string) => {
            body += chunk;
          });
          response.on('error', reject);
          response.on('end', () =>
            resolve({ status: response.statusCode, body }),
          );
        },
      );
      outgoing.on('error', reject);
      outgoing.end();
    });
  }

  it('reports the listening process and actual empty scheduler after DB readiness', async () => {
    jest.spyOn(MaintenanceConfig, 'enabled').mockReturnValue(true);
    await bootstrap();

    const result = await readState();

    expect(result.status).toBe(200);
    const state: unknown = JSON.parse(result.body);
    expect(state).toEqual({
      maintenance: true,
      ready: true,
      pid: process.pid,
      schedules: { cronJobs: 0, intervals: 0, timeouts: 0 },
    });
    expect(databaseReady).toHaveBeenCalledTimes(1);
  });

  it.each(deniedCases)(
    'does not expose state for $mode/$method/$headers',
    async ({ mode, method, headers }) => {
      jest.spyOn(MaintenanceConfig, 'enabled').mockReturnValue(mode);
      await bootstrap();

      expect((await readState(method, headers)).status).toBe(404);
      expect(databaseReady).not.toHaveBeenCalled();
    },
  );

  it('refuses readiness if a cron registration survives', async () => {
    jest.spyOn(MaintenanceConfig, 'enabled').mockReturnValue(true);
    registry.addCronJob(
      'unexpected-writer',
      new CronJob('0 0 1 1 *', () => undefined),
    );
    await bootstrap();

    expect((await readState()).status).toBe(500);
    expect(databaseReady).not.toHaveBeenCalled();
  });
});
