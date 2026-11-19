import { Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { loadPrismaPoolConfig } from './prisma-pool.config';
import { PROCESS_RUNTIME_CONFIG } from './runtime-config-instance.config';

export type PrismaQueryLintRule =
  'LINT.DELETE_WITHOUT_WHERE' | 'LINT.UPDATE_WITHOUT_WHERE';

const ERROR_RULES: Readonly<Record<string, PrismaQueryLintRule>> = {
  deleteMany: 'LINT.DELETE_WITHOUT_WHERE',
  updateMany: 'LINT.UPDATE_WITHOUT_WHERE',
};
const RULE_MESSAGES: Readonly<Record<PrismaQueryLintRule, string>> = {
  'LINT.DELETE_WITHOUT_WHERE': 'where 없이 여러 행을 삭제합니다.',
  'LINT.UPDATE_WITHOUT_WHERE': 'where 없이 여러 행을 수정합니다.',
};
const SELECT_STAR_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
]);
const warnedSelectStar = new Set<string>();

export class PrismaQueryLintError extends Error {
  constructor(
    readonly code: PrismaQueryLintRule,
    readonly key: string,
  ) {
    super(`[${code}] ${key}: ${RULE_MESSAGES[code]}`);
    this.name = 'PrismaQueryLintError';
  }
}

export class PrismaQueryLintConfig {
  private readonly logger = new Logger('PrismaQueryLint');

  constructor(private readonly enabled: boolean) {}

  createLintedClient<T extends PrismaClient>(client: T): T {
    if (!this.enabled) return client;
    return client.$extends({
      name: 'prisma-query-lint',
      query: {
        $allModels: {
          $allOperations: ({ model, operation, args, query }) => {
            this.inspect(model, operation, args);
            return query(args);
          },
        },
      },
    }) as unknown as T;
  }

  createLintedPrismaClient(databaseUrl?: string): PrismaClient {
    return this.createLintedClient(
      new PrismaClient({
        adapter: new PrismaPg(loadPrismaPoolConfig(databaseUrl)),
      }),
    );
  }

  private inspect(model: string, operation: string, args: unknown): void {
    const query = isRecord(args) ? args : {};
    const rule = ERROR_RULES[operation];
    if (
      rule &&
      (!isRecord(query.where) || Object.keys(query.where).length === 0)
    )
      throw new PrismaQueryLintError(rule, `${model}.${operation}`);
    if (!SELECT_STAR_OPERATIONS.has(operation) || query.select !== undefined)
      return;
    const warning = `${model}.${operation}`;
    if (warnedSelectStar.has(warning)) return;
    warnedSelectStar.add(warning);
    this.logger.warn(
      `[LINT.SELECT_STAR] ${warning}: select 없이 모든 열을 읽습니다.`,
    );
  }
}

export function loadPrismaQueryLintConfig({
  nodeEnv = PROCESS_RUNTIME_CONFIG.NODE_ENV,
}: { nodeEnv?: string } = {}): PrismaQueryLintConfig {
  return new PrismaQueryLintConfig(nodeEnv !== 'production');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}
