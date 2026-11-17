import { PROCESS_RUNTIME_CONFIG } from './runtime-config-instance.config';

export type PrismaPoolConfig = Readonly<{
  connectionString: string | undefined;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  max: number | undefined;
}>;

export function loadPrismaPoolConfig(
  connectionString = PROCESS_RUNTIME_CONFIG.DATABASE_URL,
  max?: number,
): PrismaPoolConfig {
  return {
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 300_000,
    max,
  };
}
