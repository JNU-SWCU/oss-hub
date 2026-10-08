import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Linter } from 'eslint';

const backendRoot = path.resolve(__dirname, '../..');
const dependencyRule = 'boundaries/dependencies';
const layers = ['controller', 'service', 'repository', 'gateway', 'job', 'dto', 'domain'] as const;
type Layer = (typeof layers)[number];
type Fixture = { name: string; file: string; code: string; rule: string | null };
const fixtures: Fixture[] = [];
const files = new Map<string, string>();

function add(name: string, file: string, code: string, rule: string | null): void {
  fixtures.push({ name, file, code, rule });
  files.set(file, code);
}

function reference(from: string, to: string): string {
  const relative = path.posix.relative(path.posix.dirname(from), to).replace(/\.ts$/, '');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function edge(name: string, from: string, to: string, allowed: boolean, syntax = 'value'): void {
  files.set(to, 'export const value = 1; export interface Shape { id: string }');
  const source = JSON.stringify(reference(from, to));
  const forms: Record<string, string> = {
    value: `import { value } from ${source}; export { value };`,
    type: `import type { Shape } from ${source}; export type Result = Shape;`,
    barrel: `export * from ${source};`,
    dynamic: `export const load = () => import(${source});`,
    require: `export const value = require(${source});`,
    sideEffect: `import ${source};`,
    importType: `export type Value = import(${source}).Shape;`,
    importEquals: `import Value = require(${source}); export { Value };`,
  };
  const code = forms[syntax];
  if (code === undefined) throw new Error(`Unknown fixture syntax: ${syntax}`);
  add(name, from, code, allowed ? (syntax === 'importType' || syntax === 'importEquals' ? 'no-restricted-syntax' : null) : dependencyRule);
}

const permitted: Record<Layer, readonly Layer[]> = {
  controller: ['service', 'dto', 'domain'],
  service: ['service', 'repository', 'gateway', 'dto', 'domain'],
  repository: ['domain'],
  gateway: ['domain'],
  job: ['service', 'dto', 'domain'],
  dto: ['domain'],
  domain: ['domain'],
};

for (const from of layers) {
  for (const to of layers) {
    for (const foreign of [false, true]) {
      const name = `${from}-${to}-${foreign ? 'foreign' : 'own'}`;
      const allowed = permitted[from].includes(to) && !(foreign && (to === 'repository' || to === 'gateway'));
      edge(name, `src/alpha/${from}/${name}.ts`, `src/${foreign ? 'beta' : 'alpha'}/${to}/target.ts`, allowed);
    }
  }
  edge(`${from}-common`, `src/alpha/${from}/common.ts`, 'src/common/contract.ts', true);
}

edge('common cannot import domain', 'src/common/reverse.ts', 'src/alpha/domain/target.ts', false);
edge('common may import common', 'src/common/helper.ts', 'src/common/contract.ts', true);
edge('service may call users authority', 'src/alpha/service/authority.ts', 'src/users/service/authority.service.ts', true);
edge('service may read runtime config', 'src/alpha/service/config.ts', 'src/runtime-config/runtime-config.ts', true);
edge('domain cannot read runtime config', 'src/alpha/domain/config.ts', 'src/runtime-config/runtime-config.ts', false);
edge('service may use storage key', 'src/alpha/service/storage.ts', 'src/storage/object-storage.key.ts', true);
edge('service cannot import storage gateway', 'src/alpha/service/storage-private.ts', 'src/storage/gateway/object.storage.ts', false);
edge('controller may use auth guard', 'src/alpha/controller/auth.ts', 'src/auth/controller/session.guard.ts', true);
edge('controller may use root auth guard', 'src/alpha/controller/root-auth.ts', 'src/auth/session.guard.ts', true);
edge('service cannot use auth controller', 'src/alpha/service/auth.ts', 'src/auth/controller/session.guard.ts', false);
edge('controller cannot access PrismaService', 'src/alpha/controller/prisma.ts', 'src/prisma/prisma.service.ts', false);
edge('guard cannot access PrismaService', 'src/alpha/alpha.guard.ts', 'src/prisma/prisma.service.ts', false);
edge('repository may access PrismaService', 'src/alpha/repository/prisma.ts', 'src/prisma/prisma.service.ts', true);
edge('service cannot access PrismaService', 'src/alpha/service/prisma.ts', 'src/prisma/prisma.service.ts', false);
edge('repository may acquire tree lock', 'src/alpha/repository/lock.ts', 'src/prisma/lock-program-tree.ts', true);
edge('service cannot acquire tree lock', 'src/alpha/service/lock.ts', 'src/prisma/lock-program-tree.ts', false);
edge('controller cannot acquire tree lock', 'src/alpha/controller/lock.ts', 'src/prisma/lock-program-tree.ts', false);
edge('bootstrap cannot acquire tree lock', 'src/main.ts', 'src/prisma/lock-program-tree.ts', false);
edge('tests may acquire tree lock', 'test/tree-lock.spec.ts', 'src/prisma/lock-program-tree.ts', true);
edge('module may compose own repository', 'src/alpha/alpha.module.ts', 'src/alpha/repository/target.ts', true);
edge('module cannot compose foreign repository', 'src/alpha/foreign.module.ts', 'src/beta/repository/target.ts', false);
edge('module may import other module', 'src/alpha/cross.module.ts', 'src/beta/beta.module.ts', true);
edge('service may import own root types', 'src/alpha/service/types.ts', 'src/alpha/alpha.types.ts', true);
edge('production cannot import colocated test', 'src/alpha/service/test-import.ts', 'src/alpha/service/target.spec.ts', false);
edge('production cannot import fixture', 'src/alpha/service/fixture-import.ts', 'test/fixture.ts', false);
edge('test may import fixture', 'src/alpha/service/fixture.spec.ts', 'test/fixture.ts', true);
edge('nested module owns its repository', 'src/programs/archive/overview/service/read.ts', 'src/programs/archive/overview/repository/target.ts', true);
edge('nested modules cannot share repositories', 'src/programs/archive/projects/service/read.ts', 'src/programs/archive/overview/repository/target.ts', false);
edge('nested module is not parent module', 'src/programs/service/archive.ts', 'src/programs/archive/overview/repository/target.ts', false);
edge('nested dto may use foreign domain', 'src/programs/archive/projects/dto/read.ts', 'src/alpha/domain/target.ts', true);

for (const syntax of ['type', 'barrel', 'dynamic', 'require', 'sideEffect', 'importType', 'importEquals']) {
  edge(`${syntax} cannot escape foreign repository boundary`, `src/alpha/service/${syntax}.ts`, 'src/beta/repository/target.ts', false, syntax);
  edge(`${syntax} may import domain`, `src/alpha/service/${syntax}-allowed.ts`, 'src/beta/domain/target.ts', true, syntax);
}

add('alias cannot escape foreign repository boundary', 'src/alpha/service/alias.ts', "import { value } from '@fixture/beta/repository/target'; export { value };", dependencyRule);
add('unknown folder is rejected', 'src/alpha/misc/value.ts', 'export const value = 1;', 'boundaries/no-unknown-files');
add('unknown root business file is rejected', 'src/alpha/behavior.ts', 'export const value = 1;', 'boundaries/no-unknown-files');
add('root config remains classified', 'src/alpha/alpha.config.ts', 'export const value = 1;', null);
add('root error codes remain classified', 'src/alpha/alpha-error-code.enum.ts', 'export enum Code { FAILURE }', null);
add('DTO class belongs in dto directory', 'src/alpha/service/result.ts', 'export class ResultResponseDto {}', 'architecture/dto-location');
add('DTO class is accepted in dto directory', 'src/alpha/dto/result.ts', 'export class ResultResponseDto {}', null);
add('nested DTO class is accepted', 'src/programs/archive/overview/dto/result.ts', 'export class ResultResponseDto {}', null);
add('test may use import type node', 'test/import-type.spec.ts', "export type Value = import('../src/alpha/domain/target').Shape;", null);
add('test may use import equals', 'test/import-equals.spec.ts', "import Value = require('../src/alpha/domain/target'); export { Value };", null);
add('repository cannot use import type node', 'src/alpha/repository/import-type.ts', "export type Value = import('../domain/target').Shape;", 'no-restricted-syntax');
add('module cannot use import equals', 'src/alpha/equals.module.ts', "import Value = require('./domain/target'); export { Value };", 'no-restricted-syntax');
for (const file of ['src/alpha/domain/marker.ts', 'test/marker.spec.ts', 'prisma/seeds/marker.ts', 'eslint-marker.mjs']) {
  add(`dpdm suppression marker forbidden in ${file}`, file, "/* @dpdm-ignore */\nexport const value = 1;", 'architecture/no-dpdm-ignore');
}

for (const layer of layers) {
  const code = "import { AccountStatus as Status } from '@prisma/client'; export const value = Status;";
  add(`${layer} accepts aliased Prisma enum`, `src/enums/${layer}/allowed.ts`, code, null);
  if (layer === 'repository') continue;
  for (const name of ['Prisma', 'PrismaClient', 'User', 'PrismaPromise']) {
    add(`${layer} rejects Prisma ${name}`, `src/enums/${layer}/${name}.ts`, `import type { ${name} } from '@prisma/client'; export type Value = ${name};`, 'no-restricted-imports');
  }
}

for (const [name, code] of [
  ['default', "import Client from '@prisma/client'; export { Client };"],
  ['namespace', "import * as Client from '@prisma/client'; export { Client };"],
  ['sql', "import { Prisma } from '@prisma/client'; export const query = Prisma.sql`SELECT 1`;"],
] as const) {
  add(`rejects Prisma ${name} import`, `src/enums/service/${name}.ts`, code, 'no-restricted-imports');
}

for (const [name, code] of [
  ['star-export', "export * from '@prisma/client';"],
  ['namespace-export', "export * as Client from '@prisma/client';"],
  ['dynamic-client', "export const load = () => import('@prisma/client');"],
  ['require-client', "export const client = require('@prisma/client');"],
  ['side-effect-client', "import '@prisma/client';"],
  ['type-client', "export type Client = import('@prisma/client').PrismaClient;"],
  ['equals-client', "import Client = require('@prisma/client'); export { Client };"],
] as const) {
  add(`rejects Prisma ${name} escape`, `src/enums/service/${name}.ts`, code, 'no-restricted-syntax');
}

add('rejects Prisma model re-export', 'src/enums/domain/reexport.ts', "export type { User as PublicUser } from '@prisma/client';", 'no-restricted-imports');
add('allows enum type import', 'src/enums/dto/type.ts', "import type { AccountStatus } from '@prisma/client'; export type Status = AccountStatus;", null);
add('allows enum re-export', 'src/enums/domain/enum-export.ts', "export { AccountStatus as Status } from '@prisma/client';", null);

for (const file of ['src/enums/repository/client.ts', 'src/prisma/client.ts', 'src/enums/enums.module.ts', 'src/enums/service/client.spec.ts', 'test/client.ts', 'prisma/seeds/synthetic.ts', 'src/programs/archive/overview/repository/client.ts', 'src/programs/archive/overview/overview.module.ts']) {
  add(`DB access exemption ${file}`, file, "import { Prisma, PrismaClient } from '@prisma/client'; export { Prisma, PrismaClient };", null);
}

add('ordinary class alias is rejected', 'src/providers/providers.module.ts', 'class Service {} export const provider = { provide: "KEY", useExisting: Service };', 'architecture/no-class-alias');
add('built-in-looking local key is rejected', 'src/providers/local.module.ts', 'const APP_GUARD = "fake"; class Guard {} export const provider = { provide: APP_GUARD, useExisting: Guard };', 'architecture/no-class-alias');
add('foreign built-in-looking import is rejected', 'src/providers/foreign.module.ts', 'import { APP_GUARD } from "./fake"; export const provider = { provide: APP_GUARD, useExisting: Object };', 'architecture/no-class-alias');
files.set('src/providers/fake.ts', 'export const APP_GUARD = "fake";');
add('shadowed built-in import is rejected', 'src/providers/shadow.module.ts', 'import { APP_GUARD } from "@nestjs/core"; export const key = APP_GUARD; export function provider(APP_GUARD: string) { return { provide: APP_GUARD, useExisting: Object }; }', 'architecture/no-class-alias');
add('computed class alias is rejected', 'src/providers/computed.module.ts', 'export const provider = { ["provide"]: "KEY", ["useExisting"]: Object };', 'architecture/no-class-alias');
add('class provider without alias is accepted', 'src/providers/class.module.ts', 'class Service {} export const providers = [Service, { provide: "KEY", useClass: Service }];', null);

for (const key of ['APP_GUARD', 'APP_FILTER', 'APP_INTERCEPTOR', 'APP_PIPE']) {
  add(`Nest ${key} global registration is accepted`, `src/providers/${key}.module.ts`, `import { ${key} as KEY } from '@nestjs/core'; export const provider = { provide: KEY, useExisting: Object };`, null);
}
add('Nest namespace registration is accepted', 'src/providers/namespace.module.ts', "import * as Nest from '@nestjs/core'; export const provider = { provide: Nest.APP_GUARD, useExisting: Object };", null);
add('computed identifier is not a Nest key', 'src/providers/computed-namespace.module.ts', "import * as Nest from '@nestjs/core'; const APP_GUARD = 'other'; export const provider = { provide: Nest[APP_GUARD], useExisting: Object };", 'architecture/no-class-alias');

const runner = `
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const [backendRoot, fixtureRoot, fileList] = process.argv.slice(1);
const require = createRequire(path.join(backendRoot, 'package.json'));
const { ESLint } = require('eslint');
const { createRailsConfig } = await import(pathToFileURL(path.join(backendRoot, 'eslint.rails.mjs')).href);
const eslint = new ESLint({ cwd: fixtureRoot, overrideConfigFile: true, overrideConfig: await createRailsConfig(fixtureRoot) });
const results = [];
for (const file of JSON.parse(fileList)) {
  const filePath = path.join(fixtureRoot, file);
  const [result] = await eslint.lintText(fs.readFileSync(filePath, 'utf8'), { filePath });
  results.push(result.messages);
}
process.stdout.write(JSON.stringify(results));
`;

function write(root: string, file: string, content: string): void {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function configure(root: string): void {
  write(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'commonjs', baseUrl: '.', paths: { '@fixture/*': ['src/*'] } }, include: ['src/**/*.ts', 'test/**/*.ts', 'prisma/**/*.ts'] }));
}

describe('backend structural lint rails', () => {
  let root: string;
  let messages: Linter.LintMessage[][];

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-hub-boundaries-')));
    configure(root);
    fs.symlinkSync(path.join(backendRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    for (const [file, code] of files) write(root, file, code);
    const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', runner, backendRoot, root, JSON.stringify(fixtures.map((fixture) => fixture.file))], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    messages = JSON.parse(stdout) as Linter.LintMessage[][];
  }, 30000);

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(fixtures.map((fixture, index) => ({ ...fixture, index })))('$name', ({ rule, index }) => {
    const actual = messages[index];
    expect(actual).toBeDefined();
    expect(actual?.filter((message) => message.fatal)).toEqual([]);
    if (rule === null) {
      expect(actual).toEqual([]);
    } else {
      expect(actual?.map((message) => message.ruleId)).toContain(rule);
      if (rule === dependencyRule) {
        expect(actual?.filter((message) => message.ruleId === 'boundaries/no-unknown-files' || message.ruleId === 'boundaries/no-unknown-dependencies')).toEqual([]);
      }
    }
  });
});

const cycles: { name: string; sources: Record<string, string> }[] = [
  { name: 'value', sources: { 'a.ts': "import { b } from './b'; export const a = () => b;", 'b.ts': "import { a } from './a'; export const b = () => a;" } },
  { name: 'type-only', sources: { 'a.ts': "import type { B } from './b'; export interface A { b: B }", 'b.ts': "import type { A } from './a'; export interface B { a: A }" } },
  { name: 'alias', sources: { 'a.ts': "import { b } from '@fixture/b'; export const a = () => b;", 'b.ts': "import { a } from '@fixture/a'; export const b = () => a;" } },
  { name: 'dynamic', sources: { 'a.ts': "export const a = () => import('./b');", 'b.ts': "export const b = () => import('./a');" } },
  { name: 'barrel', sources: { 'a.ts': "export { b } from './index';", 'index.ts': "export * from './b';", 'b.ts': "export { b } from './a';" } },
  { name: 'self', sources: { 'a.ts': "import './a'; export const a = 1;" } },
  { name: 'commonjs', sources: { 'a.ts': "module.exports = require('./b');", 'b.ts': "module.exports = require('./a');" } },
  { name: 'side-effect', sources: { 'a.ts': "import './b';", 'b.ts': "import './a';" } },
  { name: 'disconnected', sources: { 'main.ts': 'export const main = 1;', 'orphan/a.ts': "import './b';", 'orphan/b.ts': "import './a';" } },
];

const dpdmRunner = `
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [backendRoot, root] = process.argv.slice(1);
const require = createRequire(path.join(backendRoot, 'package.json'));
const { parseCircular, parseDependencyTree } = await import(pathToFileURL(require.resolve('dpdm')).href);
const tree = await parseDependencyTree('src/**/*.ts', {
  cwd: root,
  context: root,
  tsconfig: path.join(root, 'tsconfig.json'),
  transform: false,
  skipDynamicImports: false,
});
process.stdout.write(JSON.stringify(parseCircular(tree)));
`;

describe('source cycle coverage with dpdm', () => {
  const roots = new Set<string>();

  afterEach(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    roots.clear();
  });

  function analyze(sources: Record<string, string>): string[][] {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-hub-cycle-')));
    roots.add(root);
    configure(root);
    for (const [file, code] of Object.entries(sources)) write(root, `src/${file}`, code);
    const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', dpdmRunner, backendRoot, root], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(stdout) as string[][];
  }

  it.each(cycles)('detects $name cycles without ignoring edges', ({ sources }) => {
    expect(analyze(sources)).not.toEqual([]);
  });

  it('accepts an acyclic graph including type and dynamic edges', () => {
    expect(analyze({ 'a.ts': "import type { B } from './b'; export type A = B; export const load = () => import('./b');", 'b.ts': 'export interface B { id: string }' })).toEqual([]);
  });
});

const cycleScenarios: { name: string; sources: Record<string, string> }[] = [
  ...cycles,
  { name: 'unsupported-type-node', sources: { 'a.ts': "export interface A { b: import('./b').B }", 'b.ts': "export interface B { a: import('./a').A }" } },
  { name: 'unsupported-import-equals', sources: { 'a.ts': "import b = require('./b'); export const a = b;", 'b.ts': "import a = require('./a'); export const b = a;" } },
  { name: 'suppressed-cycle', sources: { 'a.ts': "// @dpdm-ignore\nimport './b';", 'b.ts': "import './a';" } },
  { name: 'base', sources: { 'a.ts': "import './b';", 'b.ts': "import './a';" } },
  { name: 'shifted', sources: { 'b.ts': "\n\nimport './a';\nexport const unrelated = 1;", 'a.ts': "\nimport './b';" } },
  { name: 'swapped', sources: { 'a.ts': "import './c';", 'c.ts': "import './a';" } },
  { name: 'expanded', sources: { 'a.ts': "import './b';", 'b.ts': "import './c';", 'c.ts': "import './a';" } },
  { name: 'reversed', sources: { 'a.ts': "import './c';", 'c.ts': "import './b';", 'b.ts': "import './a';" } },
  { name: 'added', sources: { 'a.ts': "import './b'; import './c';", 'b.ts': "import './a';", 'c.ts': "import './a';" } },
  { name: 'overlapping', sources: { 'a.ts': "import './b'; import './c';", 'b.ts': "import './a';", 'c.ts': "import './b';" } },
  { name: 'broken', sources: { 'a.ts': "import './b';", 'b.ts': 'export const b = 1;' } },
];

const cycleRunner = `
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [backendRoot, requests] = process.argv.slice(1);
const require = createRequire(path.join(backendRoot, 'package.json'));
const { ESLint } = require('eslint');
const { createRailsConfig } = await import(pathToFileURL(path.join(backendRoot, 'eslint.rails.mjs')).href);
const output = {};
for (const { name, root } of JSON.parse(requests)) {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: await createRailsConfig(root) });
  const results = await eslint.lintFiles(['src/**/*.ts']);
  if (results.some((result) => result.messages.some((message) => message.fatal))) throw new Error('Invalid cycle fixture');
  output[name] = results.flatMap((result) => result.messages
    .filter((message) => ['architecture/no-cycle', 'no-restricted-syntax', 'architecture/no-dpdm-ignore'].includes(message.ruleId))
    .map((message) => ({ ...message, file: path.relative(root, result.filePath).split(path.sep).join('/') })));
}
process.stdout.write(JSON.stringify(output));
`;

describe('physical cycle diagnostics for the trusted lint ratchet', () => {
  const roots = new Set<string>();
  let results: Record<string, (Linter.LintMessage & { file: string })[]>;

  beforeAll(() => {
    const requests = cycleScenarios.map(({ name, sources }) => {
      const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-hub-cycle-rails-')));
      roots.add(root);
      configure(root);
      for (const [file, code] of Object.entries(sources)) write(root, `src/${file}`, code);
      return { name, root };
    });
    const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', cycleRunner, backendRoot, JSON.stringify(requests)], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    results = JSON.parse(stdout) as typeof results;
  }, 60000);

  afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  });

  function findings(name: string): (Linter.LintMessage & { file: string })[] {
    const messages = results[name];
    if (!messages) throw new Error(`Missing cycle result: ${name}`);
    return messages;
  }

  function identities(name: string): string[] {
    return findings(name).map((message) => JSON.stringify([message.file, message.ruleId, message.messageId])).sort();
  }

  it.each(cycles)('emits ratchetable $name cycle diagnostics from physical files', ({ name }) => {
    expect(findings(name).length).toBeGreaterThan(0);
    for (const message of findings(name)) {
      expect(message.messageId).toMatch(/^cycle_[a-f0-9]{64}$/);
      expect(message).toMatchObject({ line: 1, column: 1, endLine: 1, endColumn: 1 });
      expect(message.nodeType).toBeNull();
      expect(message.message).toContain('src/');
    }
  });

  it('preserves identity across root relocation, source lines and declaration order', () => {
    expect(identities('base')).toHaveLength(1);
    expect(identities('shifted')).toEqual(identities('base'));
  });

  it('rejects same-count cycle replacement with a different target identity', () => {
    expect(findings('swapped')).toHaveLength(findings('base').length);
    expect(findings('swapped')[0]?.file).toBe(findings('base')[0]?.file);
    expect(identities('swapped')).not.toEqual(identities('base'));
  });

  it('distinguishes expanded cycles and directed traversal order', () => {
    expect(identities('expanded')).not.toEqual(identities('base'));
    expect(identities('reversed')).not.toEqual(identities('expanded'));
  });

  it('reports separate identities for two cycles anchored in the same file', () => {
    expect(identities('added')).toHaveLength(2);
    expect(new Set(findings('added').map((message) => message.file)).size).toBe(1);
    expect(identities('added')).toEqual(expect.arrayContaining(identities('base')));
  });

  it('does not let a visited-node traversal hide an overlapping cyclic edge', () => {
    expect(identities('overlapping')).toHaveLength(2);
    expect(identities('overlapping')).toEqual(expect.arrayContaining(identities('base')));
    expect(findings('overlapping').some((message) => message.message.includes('src/c.ts'))).toBe(true);
  });

  it('removes diagnostics when the physical return edge is removed', () => {
    expect(findings('broken')).toEqual([]);
  });

  it.each(['unsupported-type-node', 'unsupported-import-equals'])('rejects production %s despite pinned dpdm omitting its cycle', (name) => {
    expect(findings(name).filter((message) => message.ruleId === 'architecture/no-cycle')).toEqual([]);
    expect(findings(name).filter((message) => message.ruleId === 'no-restricted-syntax')).toHaveLength(2);
  });

  it('rejects the marker even when dpdm suppresses the actual return path', () => {
    expect(findings('suppressed-cycle').filter((message) => message.ruleId === 'architecture/no-cycle')).toEqual([]);
    expect(findings('suppressed-cycle').filter((message) => message.ruleId === 'architecture/no-dpdm-ignore')).toHaveLength(1);
  });
});

const graphValidationRunner = `
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [backendRoot, requests] = process.argv.slice(1);
const { createRailsConfig } = await import(pathToFileURL(path.join(backendRoot, 'eslint.rails.mjs')).href);
const output = {};
for (const { name, root } of JSON.parse(requests)) {
  try {
    await createRailsConfig(root);
    output[name] = null;
  } catch (error) {
    output[name] = error.message;
  }
}
process.stdout.write(JSON.stringify(output));
`;

describe('cycle graph completeness', () => {
  const roots = new Set<string>();
  let results: Record<string, string | null>;

  beforeAll(() => {
    const cases: { name: string; sources: Record<string, string> }[] = [
      { name: 'relative', sources: { 'a.ts': "import './not-present';" } },
      { name: 'alias', sources: { 'a.ts': "import '@fixture/not-present';" } },
      { name: 'excluded-source', sources: { 'a.ts': "import './node_modules-shadow/b';", 'node_modules-shadow/b.ts': "import '../a';" } },
      { name: 'builtin-package', sources: { 'a.ts': "import 'node:fs'; import '@nestjs/common';" } },
    ];
    const requests = cases.map(({ name, sources }) => {
      const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-hub-graph-completeness-')));
      roots.add(root);
      configure(root);
      fs.symlinkSync(path.join(backendRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
      for (const [file, code] of Object.entries(sources)) write(root, `src/${file}`, code);
      return { name, root };
    });
    const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', graphValidationRunner, backendRoot, JSON.stringify(requests)], { encoding: 'utf8' });
    results = JSON.parse(stdout) as typeof results;
  }, 60000);

  afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(['relative', 'alias'])('rejects an unresolved internal %s instead of returning an acyclic config', (name) => {
    expect(results[name]).toContain('cycle-incomplete: unresolved internal dependency');
    expect(results[name]).toContain('not-present');
  });

  it('rejects an excluded internal source node', () => {
    expect(results['excluded-source']).toContain('cycle-incomplete: excluded internal source');
    expect(results['excluded-source']).toContain('node_modules-shadow');
  });

  it('allows builtin and external package boundaries', () => {
    expect(results['builtin-package']).toBeNull();
  });
});
