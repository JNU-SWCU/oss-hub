import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, SourceMap } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type * as TS from 'typescript';
import { loadPrismaPoolConfig } from './prisma-pool.config';
import { PROCESS_RUNTIME_CONFIG } from './runtime-config-instance.config';

export type PrismaQueryLintRule =
  | 'LINT.NO_LIMIT'
  | 'LINT.DELETE_WITHOUT_WHERE'
  | 'LINT.UPDATE_WITHOUT_WHERE'
  | 'LINT.SELECT_STAR';

type PrismaQueryLintPolicy = Readonly<{
  repoRoot: string;
}>;

type PrismaInternalClient = {
  _request: (
    this: unknown,
    params: { callsite?: { _error?: Error } },
  ) => unknown;
};

const ERROR_RULES: Readonly<Record<string, PrismaQueryLintRule>> = {
  findMany: 'LINT.NO_LIMIT',
  deleteMany: 'LINT.DELETE_WITHOUT_WHERE',
  updateMany: 'LINT.UPDATE_WITHOUT_WHERE',
};
const RULE_MESSAGES: Readonly<Record<PrismaQueryLintRule, string>> = {
  'LINT.NO_LIMIT':
    'take 없이 여러 행을 읽습니다. 상한, 페이지 크기, 배치 크기 중 하나로 take를 지정하세요.',
  'LINT.DELETE_WITHOUT_WHERE': 'where 없이 여러 행을 삭제합니다.',
  'LINT.UPDATE_WITHOUT_WHERE': 'where 없이 여러 행을 수정합니다.',
  'LINT.SELECT_STAR': 'select 없이 모든 열을 읽습니다.',
};
const SELECT_STAR_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
]);
const callsites = new AsyncLocalStorage<{ _error?: Error } | undefined>();
const attachedClients = new WeakSet<object>();
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

  constructor(private readonly policy?: PrismaQueryLintPolicy) {}

  createLintedClient<T extends PrismaClient>(client: T): T {
    const policy = this.policy;
    if (!policy) return client;
    recordCallsites(client);
    return client.$extends({
      name: 'prisma-query-lint',
      query: {
        $allModels: {
          $allOperations: ({ model, operation, args, query }) => {
            this.inspect(policy, model, operation, args);
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
    policy: PrismaQueryLintPolicy,
    model: string,
    operation: string,
    args: unknown,
  ): void {
    const query = isRecord(args) ? args : {};
    const rule = ERROR_RULES[operation];
    if (rule && violates(rule, query)) {
      const key = `${model}.${operation}@${callerKey(policy.repoRoot)}`;
      throw new PrismaQueryLintError(rule, key);
    }
    if (!SELECT_STAR_OPERATIONS.has(operation) || query.select !== undefined)
      return;
    const warning = `${model}.${operation}`;
    if (warnedSelectStar.has(warning)) return;
    warnedSelectStar.add(warning);
    this.logger.warn(
      `[LINT.SELECT_STAR] ${warning}@${callerKey(policy.repoRoot)}: ${RULE_MESSAGES['LINT.SELECT_STAR']}`,
    );
  }
}

export function loadPrismaQueryLintConfig({
  nodeEnv = PROCESS_RUNTIME_CONFIG.NODE_ENV,
}: { nodeEnv?: string } = {}): PrismaQueryLintConfig {
  if (nodeEnv === 'production') return new PrismaQueryLintConfig();
  return new PrismaQueryLintConfig({ repoRoot: findUp('pnpm-workspace.yaml') });
}

function recordCallsites(client: PrismaClient): void {
  const internal = (client as unknown as { _originalClient?: unknown })
    ._originalClient as PrismaInternalClient | undefined;
  if (typeof internal?._request !== 'function')
    throw new Error(
      'Prisma 내부 _request를 찾지 못해 쿼리 린트가 호출 위치를 알 수 없습니다. Prisma 버전 변경을 확인하세요.',
    );
  if (attachedClients.has(internal)) return;
  attachedClients.add(internal);
  const request = internal._request;
  internal._request = function (this: unknown, params) {
    return callsites.run(params.callsite, () => request.call(this, params));
  };
}

function violates(
  rule: PrismaQueryLintRule,
  query: Record<string, unknown>,
): boolean {
  if (rule !== 'LINT.NO_LIMIT')
    return !isRecord(query.where) || Object.keys(query.where).length === 0;
  return query.take === undefined || query.take === null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function callerKey(repoRoot: string): string {
  const stack = callsites.getStore()?._error?.stack ?? '';
  for (const line of stack.split('\n').slice(1)) {
    const [, raw = '', row = '0', column = '0'] =
      /^at (?:.* \((.+):(\d+):(\d+)\)|(?:async )?(.+):(\d+):(\d+))$/
        .exec(line.trim())
        ?.filter((part) => part !== undefined) ?? [];
    const file = raw.startsWith('file://') ? fileURLToPath(raw) : raw;
    if (
      !file.startsWith(repoRoot + sep) ||
      file.includes(`${sep}node_modules${sep}`) ||
      file === __filename
    )
      continue;
    const source = originalPosition(file, Number(row), Number(column));
    const path = relative(repoRoot, source.file).split(sep).join('/');
    return `${path}#${ownerAt(source.file, source.line, source.column)}`;
  }
  return 'unknown';
}

function originalPosition(
  file: string,
  line: number,
  column: number,
): { file: string; line: number; column: number } {
  const map = `${file}.map`;
  if (!file.endsWith('.js') || !existsSync(map)) return { file, line, column };
  const entry = new SourceMap(
    JSON.parse(readFileSync(map, 'utf8')) as ConstructorParameters<
      typeof SourceMap
    >[0],
  ).findEntry(line - 1, column - 1);
  if (!('originalSource' in entry)) return { file, line, column };
  return {
    file: entry.originalSource.startsWith('file://')
      ? fileURLToPath(entry.originalSource)
      : resolve(dirname(file), entry.originalSource),
    line: entry.originalLine + 1,
    column: entry.originalColumn + 1,
  };
}

function findUp(marker: string): string {
  for (let dir = __dirname; ; dir = dirname(dir)) {
    if (existsSync(join(dir, marker))) return dir;
    if (dir === dirname(dir))
      throw new Error(`쿼리 린트가 ${marker}를 찾지 못했습니다.`);
  }
}

const sources = new Map<string, TS.SourceFile>();
let typescript: typeof TS | undefined;

function ts(): typeof TS {
  typescript ??= createRequire(__filename)('typescript') as typeof TS;
  return typescript;
}

function parse(file: string): TS.SourceFile {
  const cached = sources.get(file);
  if (cached) return cached;
  const source = ts().createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts().ScriptTarget.Latest,
    true,
  );
  sources.set(file, source);
  return source;
}

function ownerAt(file: string, line: number, column: number): string {
  const source = parse(file);
  const position = source.getPositionOfLineAndCharacter(line - 1, column - 1);
  let node: TS.Node = source;
  for (;;) {
    const child = node
      .getChildren(source)
      .find(
        (candidate) =>
          candidate.getStart(source) <= position && position < candidate.end,
      );
    if (!child) return ownerOf(node);
    node = child;
  }
}

function ownerOf(start: TS.Node): string {
  const t = ts();
  for (let node: TS.Node | undefined = start; node; node = node.parent) {
    const parent = node.parent;
    if (
      (t.isMethodDeclaration(node) ||
        t.isGetAccessorDeclaration(node) ||
        t.isSetAccessorDeclaration(node) ||
        t.isConstructorDeclaration(node)) &&
      t.isClassLike(parent)
    )
      return `${className(parent)}.${t.isConstructorDeclaration(node) ? 'constructor' : node.name.getText()}`;
    if (t.isFunctionDeclaration(node) && node.name) return node.name.text;
    if (t.isArrowFunction(node) || t.isFunctionExpression(node)) {
      if (t.isPropertyDeclaration(parent) && t.isClassLike(parent.parent))
        return `${className(parent.parent)}.${parent.name.getText()}`;
      if (t.isVariableDeclaration(parent) && t.isIdentifier(parent.name))
        return parent.name.text;
    }
  }
  return '<module>';
}

function className(node: TS.ClassLikeDeclaration): string {
  return node.name?.text ?? '<class>';
}
