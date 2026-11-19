import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { loadPrismaPoolConfig } from './prisma-pool.config';
import { PROCESS_RUNTIME_CONFIG } from './runtime-config-instance.config';

export type PrismaQueryLintRule =
  | 'LINT.NO_LIMIT'
  | 'LINT.NESTED_NO_LIMIT'
  | 'LINT.DELETE_WITHOUT_WHERE'
  | 'LINT.UPDATE_WITHOUT_WHERE';

type RelationFields = ReadonlyMap<
  string,
  ReadonlyMap<string, Readonly<{ model: string; isList: boolean }>>
>;

let schemaRelations: RelationFields | undefined;

const ERROR_RULES: Readonly<Record<string, PrismaQueryLintRule>> = {
  deleteMany: 'LINT.DELETE_WITHOUT_WHERE',
  updateMany: 'LINT.UPDATE_WITHOUT_WHERE',
};
const RULE_MESSAGES: Readonly<Record<PrismaQueryLintRule, string>> = {
  'LINT.NO_LIMIT': 'take 없이 여러 행을 읽습니다.',
  'LINT.NESTED_NO_LIMIT': 'take 없이 여러 행 관계를 함께 읽습니다.',
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

  constructor(private readonly relations?: RelationFields) {}

  createLintedClient<T extends PrismaClient>(client: T): T {
    const relations = this.relations;
    if (!relations) return client;
    return client.$extends({
      name: 'prisma-query-lint',
      query: {
        $allModels: {
          $allOperations: ({ model, operation, args, query }) => {
            this.inspect(relations, model, operation, args);
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

  private inspect(
    relations: RelationFields,
    model: string,
    operation: string,
    args: unknown,
  ): void {
    const query = isRecord(args) ? args : {};
    const key = `${model}.${operation}`;
    if (operation === 'findMany' && query.take == null) {
      throw new PrismaQueryLintError('LINT.NO_LIMIT', key);
    }
    const relation = unboundedRelation(relations, model, query);
    if (relation) {
      throw new PrismaQueryLintError(
        'LINT.NESTED_NO_LIMIT',
        `${key}.${relation}`,
      );
    }
    const rule = ERROR_RULES[operation];
    if (
      rule &&
      (!isRecord(query.where) || Object.keys(query.where).length === 0)
    )
      throw new PrismaQueryLintError(rule, key);
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
  if (nodeEnv === 'production') return new PrismaQueryLintConfig();
  schemaRelations ??= loadRelations();
  return new PrismaQueryLintConfig(schemaRelations);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function loadRelations(): RelationFields {
  const marker = 'prisma/schema.prisma';
  let dir = __dirname;
  while (!existsSync(join(dir, marker))) {
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error(`쿼리 린트가 ${marker}를 찾지 못했습니다.`);
    dir = parent;
  }
  const schemaFile = join(dir, marker);
  const schema = readFileSync(schemaFile, 'utf8');
  const blocks = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
  const models = new Set(blocks.map(([, name]) => name));
  return new Map(
    blocks.map(([, name = '', body = '']) => [
      name,
      new Map(
        [...body.matchAll(/^\s+(\w+)\s+(\w+)(\[\])?/gm)]
          .filter(([, , type]) => models.has(type ?? ''))
          .map(([, field = '', type = '', list]) => [
            field,
            { model: type, isList: list !== undefined },
          ]),
      ),
    ]),
  );
}

function unboundedRelation(
  relations: RelationFields,
  model: string,
  query: Record<string, unknown>,
): string | undefined {
  const fields = relations.get(model);
  for (const selection of [query.select, query.include]) {
    if (!isRecord(selection)) continue;
    for (const [field, value] of Object.entries(selection)) {
      const relation = fields?.get(field);
      if (!relation || value === false || value == null) continue;
      if (relation.isList && !(isRecord(value) && value.take != null))
        return field;
      if (!isRecord(value)) continue;
      const nested = unboundedRelation(relations, relation.model, value);
      if (nested) return `${field}.${nested}`;
    }
  }
  return undefined;
}
