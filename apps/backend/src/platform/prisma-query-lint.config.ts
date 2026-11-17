import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, SourceMap } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type * as TS from 'typescript';
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
  owner: string;
  count: number;
}>;

type PrismaQueryLintPolicy = Readonly<{
  repoRoot: string;
  allowlist: ReadonlyMap<string, AllowlistEntry>;
  uniqueKeys: UniqueKeys;
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
  /^([A-Z]\w*)\.(findMany|deleteMany|updateMany)@(\S+\.ts)#(\S+)$/;

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
      ([key, { model, operation, file, owner, count }]) => {
        const absolute = join(policy.repoRoot, file);
        if (!existsSync(absolute)) return [`${key}: ${file} 파일이 없습니다.`];
        const found = unboundedCalls(absolute, policy.uniqueKeys).filter(
          (call) =>
            call.model === model &&
            call.operation === operation &&
            call.owner === owner,
        ).length;
        return found === count
          ? []
          : [
              `${key}: ${owner} 안의 제한 없는 ${model}.${operation} 호출은 ${found}개인데 count는 ${count}입니다.`,
            ];
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
      const key = `${model}.${operation}@${callerKey(policy.repoRoot)}`;
      if (!policy.allowlist.has(key)) throw new PrismaQueryLintError(rule, key);
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
  if (query.take !== undefined && query.take !== null) return false;
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

function readUniqueKeys(schema: string): UniqueKeys {
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
    const [, model = '', operation = '', file = '', owner = ''] =
      ALLOWLIST_KEY.exec(key) ?? [];
    const reason = isRecord(entry) ? entry.reason : undefined;
    const count = isRecord(entry) ? (entry.count ?? 1) : 1;
    if (!uniqueKeys.has(model))
      problems.push(
        `${key}: Model.findMany|deleteMany|updateMany@경로.ts#함수 형식이 아니거나 없는 모델입니다.`,
      );
    else if (typeof reason !== 'string' || reason.trim() === '')
      problems.push(`${key}: reason이 비어 있습니다.`);
    else if (!Number.isInteger(count) || (count as number) < 1)
      problems.push(`${key}: count는 1 이상의 정수여야 합니다.`);
    else
      allowlist.set(key, {
        model,
        operation,
        file,
        owner,
        count: count as number,
      });
  }
  if (problems.length > 0)
    throw new Error(`${file} 검사 실패\n${problems.join('\n')}`);
  return allowlist;
}

type UnboundedCall = Readonly<{
  model: string;
  operation: string;
  owner: string;
}>;

type UniqueKeys = ReadonlyMap<string, readonly (readonly string[])[]>;

const OPERATIONS = new Set(['findMany', 'deleteMany', 'updateMany']);
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

function unboundedCalls(file: string, uniqueKeys: UniqueKeys): UnboundedCall[] {
  const t = ts();
  const models = new Map(
    [...uniqueKeys.keys()].map((model) => [
      model.charAt(0).toLowerCase() + model.slice(1),
      model,
    ]),
  );
  const calls: UnboundedCall[] = [];
  const visit = (node: TS.Node): void => {
    if (
      t.isCallExpression(node) &&
      t.isPropertyAccessExpression(node.expression) &&
      t.isPropertyAccessExpression(node.expression.expression)
    ) {
      const operation = node.expression.name.text;
      const model = models.get(node.expression.expression.name.text);
      if (
        model &&
        OPERATIONS.has(operation) &&
        !bounded(operation, node.arguments[0], uniqueKeys.get(model) ?? [])
      )
        calls.push({ model, operation, owner: ownerOf(node) });
    }
    t.forEachChild(node, visit);
  };
  visit(parse(file));
  return calls;
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

function bounded(
  operation: string,
  argument: TS.Expression | undefined,
  keys: readonly (readonly string[])[],
): boolean {
  const t = ts();
  if (!argument || !t.isObjectLiteralExpression(argument)) return false;
  const property = (target: TS.ObjectLiteralExpression, name: string) =>
    target.properties.find(
      (candidate) => candidate.name?.getText().replace(/['"]/g, '') === name,
    );
  if (operation !== 'findMany')
    return property(argument, 'where') !== undefined;
  if (numericTake(property(argument, 'take'))) return true;
  const where = property(argument, 'where');
  if (!where || !t.isPropertyAssignment(where)) return false;
  const filter = where.initializer;
  if (!t.isObjectLiteralExpression(filter)) return false;
  const restricted = new Set(
    filter.properties.flatMap((candidate) => {
      const name = candidate.name?.getText().replace(/['"]/g, '');
      if (!name) return [];
      if (t.isShorthandPropertyAssignment(candidate)) return [name];
      if (!t.isPropertyAssignment(candidate)) return [];
      const value = candidate.initializer;
      if (!t.isObjectLiteralExpression(value)) return [name];
      return property(value, 'in') || property(value, 'equals') ? [name] : [];
    }),
  );
  return keys.some((key) => key.every((field) => restricted.has(field)));
}

function numericTake(take: TS.ObjectLiteralElementLike | undefined): boolean {
  const t = ts();
  if (!take) return false;
  if (t.isShorthandPropertyAssignment(take)) return numericConst(take.name);
  if (!t.isPropertyAssignment(take)) return false;
  return numericExpression(take.initializer);
}

function numericExpression(expression: TS.Expression): boolean {
  const t = ts();
  if (t.isNumericLiteral(expression)) return true;
  if (
    t.isPrefixUnaryExpression(expression) &&
    expression.operator === t.SyntaxKind.MinusToken
  )
    return t.isNumericLiteral(expression.operand);
  return t.isIdentifier(expression) && numericConst(expression);
}

function numericConst(name: TS.Identifier): boolean {
  const t = ts();
  const source = name.getSourceFile();
  return source.statements.some(
    (statement) =>
      t.isVariableStatement(statement) &&
      (statement.declarationList.flags & t.NodeFlags.Const) !== 0 &&
      statement.declarationList.declarations.some(
        (declaration) =>
          t.isIdentifier(declaration.name) &&
          declaration.name.text === name.text &&
          declaration.initializer !== undefined &&
          (t.isNumericLiteral(declaration.initializer) ||
            (t.isPrefixUnaryExpression(declaration.initializer) &&
              t.isNumericLiteral(declaration.initializer.operand))),
      ),
  );
}
