import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/configure-http-app';
import { MaintenanceConfig } from '../src/github/maintenance.config';
import { AuthSessionService } from '../src/platform/auth-session.service';
import { PrismaService } from '../src/platform/prisma.service';
import { loadPrismaPoolConfig } from '../src/platform/prisma-pool.config';
import { RUNTIME_CONFIG } from '../src/platform/runtime-config-instance.config';
import { loadRuntimeConfig } from '../src/platform/runtime-config.config';

const BARRIER_QUERY = 'SELECT 1 AS "query_growth_barrier"';
const BARRIER_TIMEOUT_MS = 10_000;
const FRONTEND_ORIGIN = 'http://frontend.test';

export interface RecordedQueries {
  readonly count: number;
  readonly durationMs: number;
  readonly statements: readonly string[];
}

interface Recording {
  count: number;
  durationMs: number;
  statements: string[];
}

export class QueryRecordingPrisma extends PrismaClient<
  Prisma.PrismaClientOptions,
  'query'
> {
  private recording: Recording | null = null;
  private releaseBarrier: (() => void) | undefined;

  constructor() {
    super({
      adapter: new PrismaPg(loadPrismaPoolConfig()),
      log: [{ emit: 'event', level: 'query' }],
    });
    this.$on('query', (event) => {
      if (event.query === BARRIER_QUERY) {
        this.releaseBarrier?.();
        return;
      }
      if (this.recording === null) return;
      this.recording.count += 1;
      this.recording.durationMs += event.duration;
      this.recording.statements.push(event.query);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async record<T>(
    action: () => Promise<T>,
  ): Promise<{ readonly result: T; readonly queries: RecordedQueries }> {
    await this.flush();
    const recording: Recording = { count: 0, durationMs: 0, statements: [] };
    this.recording = recording;
    try {
      const result = await action();
      await this.flush();
      return { result, queries: recording };
    } finally {
      this.recording = null;
    }
  }

  private async flush(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const released = new Promise<void>((resolve, reject) => {
      this.releaseBarrier = resolve;
      timer = setTimeout(
        () => reject(new Error('query-growth: query event barrier timed out')),
        BARRIER_TIMEOUT_MS,
      );
    });
    try {
      await Promise.all([released, this.$queryRawUnsafe(BARRIER_QUERY)]);
    } finally {
      clearTimeout(timer);
      this.releaseBarrier = undefined;
    }
  }
}

export interface QueryGrowthApp {
  readonly baseUrl: string;
  sessionCookie(githubId: bigint): Promise<string>;
  close(): Promise<void>;
}

export async function startQueryGrowthApp(
  prisma: QueryRecordingPrisma,
): Promise<QueryGrowthApp> {
  const sessionSecret = randomBytes(32);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(RUNTIME_CONFIG)
    .useValue(
      loadRuntimeConfig({
        ...process.env,
        SESSION_SECRET: sessionSecret.toString('base64url'),
        FRONTEND_URL: FRONTEND_ORIGIN,
        GITHUB_OAUTH_CLIENT_ID: 'query-growth-client',
        GITHUB_OAUTH_CLIENT_SECRET: 'query-growth-secret',
        AUTH_INITIAL_ROLES: '',
        MAIL_MODE: 'dry-run',
      }),
    )
    .compile();
  const application: INestApplication = moduleRef.createNestApplication({
    logger: false,
  });
  configureHttpApp(application);
  await application.init();
  stopScheduledJobs(application.get(SchedulerRegistry));
  await application.listen(0, '127.0.0.1');
  const baseUrl = await application.getUrl();
  const sessions = new AuthSessionService();
  return {
    baseUrl,
    sessionCookie: async (githubId) =>
      `${sessions.sessionCookieName(false)}=${await sessions.issueSessionToken(
        new Uint8Array(sessionSecret),
        githubId,
        0,
      )}`,
    close: () => application.close(),
  };
}

function stopScheduledJobs(registry: SchedulerRegistry): void {
  for (const name of registry.getCronJobs().keys()) {
    registry.deleteCronJob(name);
  }
  for (const name of registry.getIntervals()) {
    registry.deleteInterval(name);
  }
  for (const name of registry.getTimeouts()) {
    registry.deleteTimeout(name);
  }
  MaintenanceConfig.scheduleState(registry);
}

export interface EndpointMeasurement {
  readonly status: number;
  readonly itemCount: number;
  readonly queries: number;
  readonly durationMs: number;
  readonly statements: readonly string[];
}

export async function measureEndpoint(
  prisma: QueryRecordingPrisma,
  app: QueryGrowthApp,
  path: string,
  githubId: bigint | null,
): Promise<EndpointMeasurement> {
  const headers: Record<string, string> = { connection: 'close' };
  if (githubId !== null) headers.cookie = await app.sessionCookie(githubId);
  const { result, queries } = await prisma.record(async () => {
    const response = await fetch(`${app.baseUrl}${path}`, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    return {
      status: response.status,
      body: (await response.json()) as unknown,
    };
  });
  return {
    status: result.status,
    itemCount: largestArrayLength(result.body),
    queries: queries.count,
    durationMs: queries.durationMs,
    statements: queries.statements,
  };
}

export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(
      `query-growth: missing element ${index} of ${items.length}`,
    );
  }
  return item;
}

function largestArrayLength(value: unknown): number {
  if (Array.isArray(value)) {
    return Math.max(value.length, ...value.map(largestArrayLength));
  }
  if (typeof value === 'object' && value !== null) {
    return Math.max(0, ...Object.values(value).map(largestArrayLength));
  }
  return 0;
}
