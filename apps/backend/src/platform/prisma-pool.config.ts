import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism, platform } from 'node:os';
import { Client, type ClientConfig, type PoolConfig } from 'pg';
import { PROCESS_RUNTIME_CONFIG } from './runtime-config-instance.config';

const PRISMA_POOL_URL_PARAMETERS = [
  'connection_limit',
  'pool_timeout',
  'connect_timeout',
  'max_idle_connection_lifetime',
  'max_connection_lifetime',
] as const;

export type PrismaPoolConfig = Readonly<
  Required<
    Pick<
      PoolConfig,
      | 'max'
      | 'connectionTimeoutMillis'
      | 'idleTimeoutMillis'
      | 'maxLifetimeSeconds'
      | 'Client'
    >
  > & {
    connectionString: string | undefined;
    connectTimeoutMillis: number;
  }
>;

function countPhysicalCpus(): number {
  if (platform() === 'linux') {
    const cores = new Set<string>();
    let physicalId = '';
    for (const line of readFileSync('/proc/cpuinfo', 'utf8').split('\n')) {
      const [key, value] = line.split(':').map((part) => part.trim());
      if (key === 'physical id') physicalId = value ?? '';
      if (key === 'core id') cores.add(`${physicalId}:${value ?? ''}`);
    }
    if (cores.size > 0) return cores.size;
  }
  if (platform() === 'darwin') {
    const physical = Number(
      execFileSync('sysctl', ['-n', 'hw.physicalcpu'], { encoding: 'utf8' }),
    );
    if (physical > 0) return physical;
  }
  return availableParallelism();
}

function nonNegativeInteger(
  parameters: URLSearchParams,
  name: (typeof PRISMA_POOL_URL_PARAMETERS)[number],
  fallback: number,
): number {
  const raw = parameters.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`DATABASE_URL ${name} must be a non-negative integer`);
  }
  return value;
}

export function loadPrismaPoolConfig(
  databaseUrl = PROCESS_RUNTIME_CONFIG.DATABASE_URL,
  physicalCpus: () => number = countPhysicalCpus,
): PrismaPoolConfig {
  const url = databaseUrl === undefined ? undefined : new URL(databaseUrl);
  const parameters = url?.searchParams ?? new URLSearchParams();
  const connectionLimit = parameters.has('connection_limit')
    ? nonNegativeInteger(parameters, 'connection_limit', 0)
    : physicalCpus() * 2 + 1;
  if (connectionLimit < 1) {
    throw new TypeError('DATABASE_URL connection_limit must be at least 1');
  }
  const connectTimeoutMillis =
    nonNegativeInteger(parameters, 'connect_timeout', 5) * 1000;
  const config: PrismaPoolConfig = {
    connectionString: databaseUrl,
    max: connectionLimit,
    connectionTimeoutMillis:
      nonNegativeInteger(parameters, 'pool_timeout', 10) * 1000,
    connectTimeoutMillis,
    idleTimeoutMillis:
      nonNegativeInteger(parameters, 'max_idle_connection_lifetime', 300) *
      1000,
    maxLifetimeSeconds: nonNegativeInteger(
      parameters,
      'max_connection_lifetime',
      0,
    ),
    Client: class extends Client {
      constructor(clientConfig?: string | ClientConfig) {
        super(
          typeof clientConfig === 'string'
            ? {
                connectionString: clientConfig,
                connectionTimeoutMillis: connectTimeoutMillis,
              }
            : {
                ...clientConfig,
                connectionTimeoutMillis: connectTimeoutMillis,
              },
        );
      }
    },
  };
  if (!PRISMA_POOL_URL_PARAMETERS.some((name) => parameters.has(name))) {
    return config;
  }
  for (const name of PRISMA_POOL_URL_PARAMETERS) parameters.delete(name);
  return { ...config, connectionString: url?.toString() };
}
