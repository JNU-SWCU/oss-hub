import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PROCESS_RUNTIME_CONFIG } from './runtime-config-instance.config';

export type PrismaQueryLintRule =
  | 'LINT.NO_LIMIT'
  | 'LINT.DELETE_WITHOUT_WHERE'
  | 'LINT.UPDATE_WITHOUT_WHERE'
  | 'LINT.SELECT_STAR';

type AllowlistEntry = Readonly<{
  model: string;
  operation: string;
  file: string;
}>;

type PrismaQueryLintPolicy = Readonly<{
  repoRoot: string;
  allowlist: ReadonlyMap<string, AllowlistEntry>;
  uniqueKeys: ReadonlyMap<string, readonly (readonly string[])[]>;
}>;

type PrismaInternalClient = {
  _request: (
    this: unknown,
    params: { callsite?: { _error?: Error } },
  ) => unknown;
};

const ALLOWLIST_FILE = 'verify/query-lint-allowlist.json';
const ERROR_RULES: Readonly<Record<string, PrismaQueryLintRule>> = {
  findMany: 'LINT.NO_LIMIT',
  deleteMany: 'LINT.DELETE_WITHOUT_WHERE',
  updateMany: 'LINT.UPDATE_WITHOUT_WHERE',
};
const RULE_MESSAGES: Readonly<Record<PrismaQueryLintRule, string>> = {
  'LINT.NO_LIMIT':
    'take 없이 여러 행을 읽습니다. take를 지정하거나 기본/고유 키를 in·equals로 제한하세요.',
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
const ALLOWLIST_KEY =
  /^([A-Z]\w*)\.(findMany|deleteMany|updateMany)@(\S+\.ts)$/;

const callsites = new AsyncLocalStorage<{ _error?: Error } | undefined>();
const attachedClients = new WeakSet<object>();
const warnedSelectStar = new Set<string>();

export class PrismaQueryLintError extends Error {
  constructor(
    readonly code: PrismaQueryLintRule,
    readonly key: string,
  ) {
    super(
      `[${code}] ${key}: ${RULE_MESSAGES[code]} 의도한 쿼리라면 ${ALLOWLIST_FILE}에 "${key}"와 reason을 추가하세요.`,
    );
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

  auditAllowlist(): string[] {
    const policy = this.policy;
    if (!policy) return [];
    return [...policy.allowlist].flatMap(
      ([key, { model, operation, file }]) => {
        const absolute = join(policy.repoRoot, file);
        if (!existsSync(absolute)) return [`${key}: ${file} 파일이 없습니다.`];
        const delegate = model.charAt(0).toLowerCase() + model.slice(1);
        const call = new RegExp(`\\.${delegate}\\s*\\.${operation}\\s*\\(`);
        return call.test(readFileSync(absolute, 'utf8'))
          ? []
          : [`${key}: ${file}에 ${delegate}.${operation}( 호출이 없습니다.`];
      },
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
    if (rule && violates(rule, query, policy.uniqueKeys.get(model) ?? [])) {
      const key = `${model}.${operation}@${callerFile(policy.repoRoot)}`;
      if (!policy.allowlist.has(key)) throw new PrismaQueryLintError(rule, key);
    }
    if (!SELECT_STAR_OPERATIONS.has(operation) || query.select !== undefined)
      return;
    const warning = `${model}.${operation}`;
    if (warnedSelectStar.has(warning)) return;
    warnedSelectStar.add(warning);
    this.logger.warn(
      `[LINT.SELECT_STAR] ${warning}@${callerFile(policy.repoRoot)}: ${RULE_MESSAGES['LINT.SELECT_STAR']}`,
    );
  }
}

export function loadPrismaQueryLintConfig({
  nodeEnv = PROCESS_RUNTIME_CONFIG.NODE_ENV,
  allowlistPath,
}: { nodeEnv?: string; allowlistPath?: string } = {}): PrismaQueryLintConfig {
  if (nodeEnv === 'production') return new PrismaQueryLintConfig();
  const repoRoot = findUp('pnpm-workspace.yaml');
  const schema = readFileSync(
    join(findUp('prisma/schema.prisma'), 'prisma/schema.prisma'),
    'utf8',
  );
  const uniqueKeys = readUniqueKeys(schema);
  return new PrismaQueryLintConfig({
    repoRoot,
    uniqueKeys,
    allowlist: readAllowlist(
      allowlistPath ?? join(repoRoot, ALLOWLIST_FILE),
      uniqueKeys,
    ),
  });
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
  uniqueKeys: readonly (readonly string[])[],
): boolean {
  if (rule !== 'LINT.NO_LIMIT')
    return !isRecord(query.where) || Object.keys(query.where).length === 0;
  if (query.take !== undefined) return false;
  const restricted = restrictedFields(query.where);
  return !uniqueKeys.some((key) => key.every((field) => restricted.has(field)));
}

function restrictedFields(where: unknown): Set<string> {
  const fields = new Set<string>();
  if (!isRecord(where)) return fields;
  for (const [field, condition] of Object.entries(where)) {
    if (field === 'AND') {
      for (const part of [condition].flat())
        for (const nested of restrictedFields(part)) fields.add(nested);
    } else if (isEqualityOrIn(condition)) fields.add(field);
  }
  return fields;
}

function isEqualityOrIn(condition: unknown): boolean {
  if (condition === null || condition === undefined) return false;
  if (!isRecord(condition)) return true;
  return (
    Array.isArray(condition.in) ||
    (condition.equals !== undefined && condition.equals !== null)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function callerFile(repoRoot: string): string {
  const file = stackFiles(callsites.getStore()?._error).find(
    (candidate) =>
      candidate !== __filename &&
      !candidate.includes('node_modules') &&
      candidate.startsWith(repoRoot + sep),
  );
  if (!file) return 'unknown';
  return relative(repoRoot, file)
    .split(sep)
    .join('/')
    .replace(/^(apps\/[^/]+)\/dist\/(.+)\.js$/, '$1/$2.ts');
}

function stackFiles(error: Error | undefined): string[] {
  if (!error) return [];
  let files: string[] | undefined;
  const previous = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
  Error.prepareStackTrace = (formatted: Error, frames: NodeJS.CallSite[]) => {
    files = frames.map((frame) => frame.getFileName() ?? '');
    return [String(formatted), ...frames.map(formatFrame)].join('\n');
  };
  let stack: string;
  try {
    stack = error.stack ?? '';
  } finally {
    if (previous) Object.defineProperty(Error, 'prepareStackTrace', previous);
    else Reflect.deleteProperty(Error, 'prepareStackTrace');
  }
  return (
    files ??
    stack
      .split('\n')
      .map(
        (line) =>
          /(?:\(|at )([^()]+?):\d+:\d+\)?$/.exec(line.trim())?.[1] ?? '',
      )
  );
}

function formatFrame(frame: NodeJS.CallSite): string {
  const location = `${frame.getFileName() ?? '<anonymous>'}:${frame.getLineNumber() ?? 0}:${frame.getColumnNumber() ?? 0}`;
  const name = frame.getFunctionName();
  return name ? `    at ${name} (${location})` : `    at ${location}`;
}

function findUp(marker: string): string {
  for (let dir = __dirname; ; dir = dirname(dir)) {
    if (existsSync(join(dir, marker))) return dir;
    if (dir === dirname(dir))
      throw new Error(`쿼리 린트가 ${marker}를 찾지 못했습니다.`);
  }
}

function readUniqueKeys(
  schema: string,
): ReadonlyMap<string, readonly (readonly string[])[]> {
  const keys = new Map<string, string[][]>();
  for (const [, model = '', body = ''] of schema.matchAll(
    /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm,
  )) {
    const modelKeys: string[][] = [];
    for (const line of body.split('\n').map((text) => text.trim())) {
      const [, compound = ''] =
        /^@@(?:id|unique)\(\s*(?:fields:\s*)?\[([^\]]*)\]/.exec(line) ?? [];
      if (compound)
        modelKeys.push(
          compound.split(',').map((field) => field.replace(/\(.*$/, '').trim()),
        );
      const [, single = ''] = /^(\w+)\s.*\s@(?:id|unique)\b/.exec(line) ?? [];
      if (single) modelKeys.push([single]);
    }
    keys.set(model, modelKeys);
  }
  return keys;
}

function readAllowlist(
  file: string,
  uniqueKeys: ReadonlyMap<string, unknown>,
): ReadonlyMap<string, AllowlistEntry> {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!isRecord(parsed))
    throw new Error(`${file}: 최상위 값은 객체여야 합니다.`);
  const problems: string[] = [];
  const allowlist = new Map<string, AllowlistEntry>();
  for (const [key, entry] of Object.entries(parsed)) {
    const [, model = '', operation = '', file = ''] =
      ALLOWLIST_KEY.exec(key) ?? [];
    const reason = isRecord(entry) ? entry.reason : undefined;
    if (!uniqueKeys.has(model))
      problems.push(
        `${key}: Model.findMany|deleteMany|updateMany@경로.ts 형식이 아니거나 없는 모델입니다.`,
      );
    else if (typeof reason !== 'string' || reason.trim() === '')
      problems.push(`${key}: reason이 비어 있습니다.`);
    else allowlist.set(key, { model, operation, file });
  }
  if (problems.length > 0)
    throw new Error(`${file} 검사 실패\n${problems.join('\n')}`);
  return allowlist;
}
