import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const backendRoot = path.resolve(__dirname, '../..');

type RuleCase = {
  rule: string;
  name: string;
  filename: string;
  code: string;
  errors?: string[];
};

const runner = `
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [backendRoot, casesJson] = process.argv.slice(1);
const require = createRequire(path.join(backendRoot, 'package.json'));
const { RuleTester } = require('eslint');
const tseslint = require('typescript-eslint');
const load = async (file, name) => (await import(pathToFileURL(path.join(backendRoot, 'eslint-rules', file)).href))[name];
const rules = {
  'controller-explicit-return': await load('controller-explicit-return.mjs', 'controllerExplicitReturn'),
  'response-dto-shape': await load('response-dto-shape.mjs', 'responseDtoShape'),
  'request-dto-decorated': await load('request-dto-decorated.mjs', 'requestDtoDecorated'),
  'file-name-convention': await load('file-name-convention.mjs', 'fileNameConvention'),
  'file-class-match': await load('file-class-match.mjs', 'fileClassMatch'),
  'config-exports': await load('module-exports.mjs', 'configExports'),
  'service-exports': await load('module-exports.mjs', 'serviceExports'),
  'no-session-guard': await load('no-session-guard.mjs', 'noSessionGuard'),
  'injectable-role-class': await load('module-exports.mjs', 'injectableRoleClass'),
  'thin-controller': await load('thin-controller.mjs', 'thinController'),
  'no-passthrough-factory': await load(
    'no-passthrough-factory.mjs',
    'noPassthroughFactory',
  ),
  'request-dto-no-methods': await load('request-dto-no-methods.mjs', 'requestDtoNoMethods'),
};
let current;
RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => {
  try {
    fn();
    current = { ok: true };
  } catch (error) {
    current = { ok: false, message: error.message };
  }
};
RuleTester.itOnly = RuleTester.it;
const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });
const typedTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      projectService: {
        allowDefaultProject: [
          'src/programs/rule-case.controller.ts',
          'src/programs/rule-case.module.ts',
        ],
        defaultProject: 'tsconfig.json',
      },
      tsconfigRootDir: backendRoot,
    },
  },
});
const typedRules = new Set([
  'controller-explicit-return',
  'no-passthrough-factory',
]);
const output = [];
for (const item of JSON.parse(casesJson)) {
  const test = { code: item.code, filename: path.join(backendRoot, item.filename) };
  current = undefined;
  (typedRules.has(item.rule) ? typedTester : tester).run(item.rule, rules[item.rule], item.errors
    ? { valid: [], invalid: [{ ...test, errors: item.errors.map((messageId) => ({ messageId })) }] }
    : { valid: [test], invalid: [] });
  output.push(current ?? { ok: false, message: 'case did not run' });
}
process.stdout.write(JSON.stringify(output));
`;

const controllerFile = () => 'src/programs/rule-case.controller.ts';
const handler = (
  returnType: string | null,
  route = "@Controller('things')",
  verb = '@Get()',
  declarations = '',
) => `import { Controller, Delete, Get, StreamableFile } from '@nestjs/common';
${declarations}
class ThingResponseDto { declare readonly id: string; }
class OtherResponseDto { declare readonly name: string; }
class PageResponseDto<T> { declare readonly items: T[]; }
class Thing { declare readonly id: string; }
${route}
export class ThingsController {
  ${verb}
  list()${returnType === null ? '' : `: ${returnType}`} {
    return undefined as never;
  }
}`;

const cases: RuleCase[] = [];
const valid = (rule: string, name: string, filename: string, code: string) =>
  cases.push({ rule, name, filename, code });
const invalid = (
  rule: string,
  name: string,
  filename: string,
  code: string,
  errors: string[],
) => cases.push({ rule, name, filename, code, errors });

for (const type of [
  'Promise<ThingResponseDto[]>',
  'Promise<ThingResponseDto>',
  'Promise<readonly ThingResponseDto[]>',
  'Promise<ThingResponseDto | OtherResponseDto>',
  'Promise<PageResponseDto<ThingResponseDto>>',
  'Promise<void>',
  'void',
  'StreamableFile',
  'Promise<StreamableFile>',
  'ThingResponseDto',
  'Array<ThingResponseDto>',
  'Promise<Array<ThingResponseDto>>',
  'Promise<ReadonlyArray<ThingResponseDto>>',
]) {
  valid(
    'controller-explicit-return',
    `accepts ${type}`,
    controllerFile(),
    handler(type),
  );
}
valid(
  'controller-explicit-return',
  'ignores methods without an HTTP decorator',
  controllerFile(),
  handler(null, "@Controller('things')", ''),
);
valid(
  'controller-explicit-return',
  'accepts an array of a real imported response DTO class',
  controllerFile(),
  handler(
    'Array<ProgramIdResponseDto>',
    undefined,
    undefined,
    "import { ProgramIdResponseDto } from './dto/program-id-response.dto';",
  ),
);
for (const [declarations, type] of <[string, string][]>[
  ['type FakeResponseDto = null;', 'FakeResponseDto'],
  ['type FakeResponseDto = unknown;', 'Promise<FakeResponseDto>'],
  ['type FakeAny = any;', 'Promise<PageResponseDto<FakeAny>>'],
  [
    'type MaybeResponseDto = ThingResponseDto | undefined;',
    'MaybeResponseDto[]',
  ],
]) {
  invalid(
    'controller-explicit-return',
    `rejects ${declarations} as ${type}`,
    controllerFile(),
    handler(type, undefined, undefined, declarations),
    ['forbidden'],
  );
}
for (const [declarations, type] of <[string, string][]>[
  ['interface FakeResponseDto { readonly id: string }', 'FakeResponseDto'],
  [
    'type FakeResponseDto = { readonly id: string };',
    'Promise<FakeResponseDto[]>',
  ],
  ['', 'Promise<MissingResponseDto>'],
]) {
  invalid(
    'controller-explicit-return',
    `rejects ${declarations || 'an undeclared name'} as ${type}`,
    controllerFile(),
    handler(type, undefined, undefined, declarations),
    ['invalid'],
  );
}
invalid(
  'controller-explicit-return',
  'rejects a missing return type',
  controllerFile(),
  handler(null),
  ['missing'],
);
for (const type of [
  'Promise<string>',
  'Promise<Promise<ThingResponseDto>>',
  'Promise<Thing>',
  'Promise<{ readonly id: string }>',
  'Promise<Array<Thing>>',
]) {
  invalid(
    'controller-explicit-return',
    `rejects ${type}`,
    controllerFile(),
    handler(type),
    ['invalid'],
  );
}
for (const type of [
  'Promise<ThingResponseDto | null>',
  'Promise<ThingResponseDto | undefined>',
  'Promise<any>',
  'Promise<unknown>',
  'Promise<PageResponseDto<any>>',
]) {
  invalid(
    'controller-explicit-return',
    `rejects ${type}`,
    controllerFile(),
    handler(type),
    ['forbidden'],
  );
}
for (const controller of [
  'programs/:programId/applications/me',
  'application-preparations/programs/:programId/me',
]) {
  invalid(
    'controller-explicit-return',
    `rejects null on ${controller}`,
    controllerFile(),
    handler('Promise<ThingResponseDto | null>', `@Controller('${controller}')`),
    ['forbidden'],
  );
}
invalid(
  'controller-explicit-return',
  'checks every HTTP verb',
  controllerFile(),
  handler(null, "@Controller('things')", "@Delete(':id')"),
  ['missing'],
);

valid(
  'file-class-match',
  'accepts foo.service.ts exporting FooService',
  'src/programs/foo.service.ts',
  'export class FooService {}',
);
valid(
  'file-class-match',
  'accepts a kebab-case stem',
  'src/programs/foo-bar.repository.ts',
  'export class FooBarRepository {} class Helper {}',
);
valid(
  'file-class-match',
  'accepts a request DTO class',
  'src/programs/dto/create-post-request.dto.ts',
  'export class CreatePostRequestDto {} export class CreatePostItemRequestDto {}',
);
valid(
  'file-class-match',
  'ignores suffixes without a class contract',
  'src/programs/foo.types.ts',
  'export const value = 1;',
);
invalid(
  'file-class-match',
  'rejects foo.service.ts exporting BarService',
  'src/programs/foo.service.ts',
  'export class BarService {}',
  ['missing'],
);
invalid(
  'file-class-match',
  'rejects a role file without a class',
  'src/programs/foo.guard.ts',
  'export const value = 1;',
  ['missing'],
);
invalid(
  'file-class-match',
  'rejects an extra exported class without the role suffix',
  'src/programs/foo.service.ts',
  'export class FooService {} export class FooError extends Error {}',
  ['extra'],
);
for (const [name, code] of <[string, string][]>[
  [
    'an exported class-expression binding',
    'export class FooService {} export const Wrong = class Wrong {};',
  ],
  [
    'an anonymous exported class expression',
    'export class FooService {} export const Wrong = class {};',
  ],
  [
    'an anonymous default class',
    'export class FooService {} export default class {}',
  ],
  [
    'a default class expression',
    'export class FooService {} export default (class Wrong {});',
  ],
  [
    'a local class exported under another name',
    'export class FooService {} const Hidden = class {}; export { Hidden as Wrong };',
  ],
]) {
  invalid(
    'file-class-match',
    `rejects ${name} without the role suffix`,
    'src/programs/foo.service.ts',
    code,
    ['extra'],
  );
}
valid(
  'file-class-match',
  'accepts an exported class-expression binding with the role suffix',
  'src/programs/foo.service.ts',
  'export class FooService {} export const BarService = class {};',
);
invalid(
  'file-class-match',
  'rejects a response DTO class with a request suffix',
  'src/programs/dto/post-response.dto.ts',
  'export class PostResponseDto {} export class PostQueryRequestDto {}',
  ['extra'],
);

for (const file of [
  'src/programs/foo-bar.service.ts',
  'src/programs/s3-object-storage.client.ts',
  'src/programs/programs.module.ts',
  'src/programs/dto/create-post-request.dto.ts',
  'src/programs/dto/post-list-response.dto.ts',
]) {
  valid('file-name-convention', `accepts ${file}`, file, 'export {};');
}
for (const file of [
  'src/programs/foo.policy.ts',
  'src/programs/foo.scheduler.ts',
  'src/programs/foo.job.ts',
  'src/programs/fooBar.service.ts',
  'src/programs/foo.helpers.ts',
  'src/programs/foo_bar.service.ts',
  'src/programs/foo.bar.service.ts',
  'src/programs/foo-request.dto.ts',
  'src/programs/dto/post.dto.ts',
  'src/programs/dto/Post-response.dto.ts',
]) {
  invalid('file-name-convention', `rejects ${file}`, file, 'export {};', [
    'invalid',
  ]);
}

const responseFile = 'src/programs/dto/thing-response.dto.ts';
valid(
  'response-dto-shape',
  'accepts declare readonly fields and one static from',
  responseFile,
  `export class ThingResponseDto {
  declare readonly id: string;
  static from(thing: { id: string }): ThingResponseDto {
    if (thing.id === '') return { id: 'none' };
    return { id: thing.id };
  }
}`,
);
invalid(
  'response-dto-shape',
  'rejects a constructor',
  responseFile,
  `export class ThingResponseDto {
  declare readonly id: string;
  constructor() {}
  static from(): ThingResponseDto { return { id: '' }; }
}`,
  ['constructor'],
);
invalid(
  'response-dto-shape',
  'rejects a field that is not declare readonly',
  responseFile,
  `export class ThingResponseDto {
  readonly id = '';
  static from(): ThingResponseDto { return { id: '' }; }
}`,
  ['field'],
);
invalid(
  'response-dto-shape',
  'rejects an instance method',
  responseFile,
  `export class ThingResponseDto {
  declare readonly id: string;
  toJSON() { return {}; }
  static from(): ThingResponseDto { return { id: '' }; }
}`,
  ['method'],
);
invalid(
  'response-dto-shape',
  'rejects a class without static from',
  responseFile,
  `export class ThingResponseDto {
  declare readonly id: string;
  static anonymous(): ThingResponseDto { return { id: '' }; }
}`,
  ['from'],
);
invalid(
  'response-dto-shape',
  'rejects a static from without the class return type',
  responseFile,
  `export class ThingResponseDto {
  declare readonly id: string;
  static from() { return { id: '' }; }
}`,
  ['fromType'],
);
invalid(
  'response-dto-shape',
  'rejects a static from that returns something other than an object literal',
  responseFile,
  `export class ThingResponseDto {
  declare readonly id: string;
  static from(thing: ThingResponseDto): ThingResponseDto { return thing; }
}`,
  ['fromBody'],
);
invalid(
  'response-dto-shape',
  'rejects a static from that spreads its source into the literal',
  responseFile,
  `export class ThingResponseDto {
  declare readonly id: string;
  static from(thing: { readonly id: string }): ThingResponseDto { return { ...thing }; }
}`,
  ['fromSpread'],
);
invalid(
  'response-dto-shape',
  'rejects an object spread nested inside the returned literal',
  responseFile,
  `export class ThingResponseDto {
  declare readonly items: readonly { readonly id: string }[];
  static from(page: { readonly items: readonly { readonly id: string }[] }): ThingResponseDto {
    return { items: page.items.map((item) => ({ ...item })) };
  }
}`,
  ['fromSpread'],
);

const requestFile = 'src/programs/dto/thing-request.dto.ts';
valid(
  'request-dto-decorated',
  'accepts class-validator decorators',
  requestFile,
  `import { IsOptional, IsString } from 'class-validator';
export class ThingRequestDto {
  @IsString() declare readonly name: string;
  @IsOptional() @IsString() declare readonly note?: string;
}`,
);
invalid(
  'request-dto-decorated',
  'rejects an undecorated field',
  requestFile,
  'export class ThingRequestDto { declare readonly name: string; }',
  ['undecorated'],
);
invalid(
  'request-dto-decorated',
  'rejects @IsOptional alone',
  requestFile,
  `import { IsOptional } from 'class-validator';
export class ThingRequestDto { @IsOptional() declare readonly name?: string; }`,
  ['undecorated'],
);
valid(
  'request-dto-decorated',
  'accepts aliased and namespace class-validator decorators',
  requestFile,
  `import { IsString as Str } from 'class-validator';
import * as v from 'class-validator';
export class ThingRequestDto {
  @Str() declare readonly name: string;
  @v.IsOptional() @v.IsInt() declare readonly page?: number;
}`,
);
for (const [name, code] of <[string, string][]>[
  [
    'an aliased @IsOptional alone',
    `import { IsOptional as Optional } from 'class-validator';
export class ThingRequestDto { @Optional() declare readonly title?: string; }`,
  ],
  [
    'a namespace @IsOptional alone',
    `import * as v from 'class-validator';
export class ThingRequestDto { @v.IsOptional() declare readonly title?: string; }`,
  ],
  [
    'a local decorator named like a validator',
    `const IsString = () => () => undefined;
export class ThingRequestDto { @IsString() declare readonly title: string; }`,
  ],
]) {
  invalid('request-dto-decorated', `rejects ${name}`, requestFile, code, [
    'undecorated',
  ]);
}
invalid(
  'request-dto-decorated',
  'rejects a decorator that is not from class-validator',
  requestFile,
  `import { Type } from 'class-transformer';
export class ThingRequestDto { @Type(() => Number) declare readonly page: number; }`,
  ['undecorated'],
);

const configFile = 'src/programs/rule-case.config.ts';
const serviceFile = 'src/programs/rule-case.service.ts';
for (const [name, code] of [
  ['constants', 'export const LIMIT = 1; export enum Mode { A = "A" }'],
  ['a const from a call', "export const config = registerAs('x', () => ({}));"],
  [
    'types',
    'export type Shape = { id: string }; export interface Row { id: string }',
  ],
  [
    'a config class',
    'export class ThingConfig { static parse() { return 1; } }',
  ],
  ['a load*Config factory', 'export function loadThingConfig() { return {}; }'],
  [
    'an exported load*Config binding',
    'function loadThingConfig() { return {}; } export { loadThingConfig };',
  ],
  ['a type re-export', 'export type { Row } from "./row.types";'],
  [
    'a type-only import re-exported by name',
    'import type { Row } from "./row.types"; export { Row };',
  ],
] as const) {
  valid('config-exports', `allows ${name}`, configFile, code);
}
for (const [name, code] of [
  ['a domain function', 'export function parseThing() { return 1; }'],
  [
    'an async domain function',
    'export async function parseThing() { return 1; }',
  ],
  ['an arrow function', 'export const parseThing = () => 1;'],
  [
    'a function expression',
    'export const parseThing = function () { return 1; };',
  ],
  [
    'an arrow named like a factory is still allowed only by name',
    'export const parseConfig = () => 1;',
  ],
  ['a default function', 'export default function () { return 1; }'],
  [
    'an export list of a function',
    'function parseThing() { return 1; } export { parseThing };',
  ],
  [
    'an export list of an arrow',
    'const parseThing = () => 1; export { parseThing };',
  ],
  ['a value re-export', 'export { parseThing } from "./thing.service";'],
  ['a star re-export', 'export * from "./thing.service";'],
  [
    'a default export of a function binding',
    'function parseThing() { return 1; } export default parseThing;',
  ],
  [
    'an arrow behind a type assertion',
    'export const parseThing = (() => 1) as () => number;',
  ],
  [
    'an arrow behind satisfies',
    'export const parseThing = (() => 1) satisfies () => number;',
  ],
  [
    'a default binding behind a type assertion',
    'const parseThing = () => 1; export default (parseThing as () => number);',
  ],
  [
    'a default binding behind satisfies',
    'const parseThing = () => 1; export default (parseThing satisfies () => number);',
  ],
  [
    'a non-null default binding',
    'const parseThing = () => 1; export default parseThing!;',
  ],
  [
    'an angle-bracket asserted default binding',
    'const parseThing = () => 1; export default <() => number>parseThing;',
  ],
  [
    'a parenthesized default binding',
    'const parseThing = () => 1; export default (parseThing);',
  ],
  [
    'a default alias of a function binding',
    'const parseThing = () => 1; const alias = parseThing; export default alias;',
  ],
  [
    'an export list of an asserted alias',
    'const parseThing = () => 1; const alias = parseThing as () => number; export { alias };',
  ],
  [
    'an imported default binding',
    'import { parseThing } from "./other"; export default parseThing;',
  ],
  [
    'an imported export-list binding',
    'import { parseThing } from "./other"; export { parseThing };',
  ],
  [
    'an imported namespace binding',
    'import * as helpers from "./other"; export { helpers };',
  ],
] as const) {
  invalid('config-exports', `rejects ${name}`, configFile, code, ['forbidden']);
}
for (const [name, code] of [
  ['its class', 'export class ThingService { run() { return 1; } }'],
  [
    'types',
    'export type Shape = { id: string }; export interface Row { id: string }',
  ],
  ['constants', 'export const LIMIT = 1;'],
  [
    'a local helper',
    'function helper() { return 1; } export class ThingService { run() { return helper(); } }',
  ],
] as const) {
  valid('service-exports', `allows ${name}`, serviceFile, code);
}
for (const [name, code] of [
  ['a function', 'export function run() { return 1; }'],
  ['a load*Config function', 'export function loadThingConfig() { return 1; }'],
  ['an arrow function', 'export const run = () => 1;'],
  ['a default function', 'export default function run() { return 1; }'],
  [
    'an export list of a function',
    'function run() { return 1; } export { run };',
  ],
  ['a value re-export', 'export { run } from "./run.helpers";'],
  ['a star re-export', 'export * from "./run.helpers";'],
  [
    'a default export of a function binding',
    'const run = () => 1; export default run;',
  ],
  [
    'an arrow behind a type assertion',
    'export const run = (() => 1) as never;',
  ],
  [
    'a default binding behind a type assertion',
    'const run = () => 1; export default (run as () => number);',
  ],
  [
    'a default binding behind satisfies',
    'const run = () => 1; export default (run satisfies () => number);',
  ],
  ['a non-null default binding', 'const run = () => 1; export default run!;'],
  [
    'an angle-bracket asserted default binding',
    'const run = () => 1; export default <() => number>run;',
  ],
  [
    'a parenthesized default binding',
    'const run = () => 1; export default (run);',
  ],
  [
    'a default alias of a function binding',
    'const run = () => 1; const alias = run; export default alias;',
  ],
  [
    'an export list of an asserted alias',
    'const run = () => 1; const alias = run as () => number; export { alias };',
  ],
  [
    'an imported default binding',
    'import { run } from "./other"; export default run;',
  ],
  [
    'an imported export-list binding',
    'import { run } from "./other"; export { run };',
  ],
  [
    'an imported namespace binding',
    'import * as helpers from "./other"; export { helpers };',
  ],
] as const) {
  invalid('service-exports', `rejects ${name}`, serviceFile, code, [
    'forbidden',
  ]);
}

valid(
  'no-session-guard',
  'accepts a protected route that only adds OriginGuard',
  'src/programs/rule-case.controller.ts',
  `import { Controller, Post, UseGuards } from '@nestjs/common';
import { Protected } from '../auth/authentication.guard';
import { OriginGuard } from '../platform/origin.guard';
@Controller('things')
export class ThingsController {
  @Post()
  @Protected()
  @UseGuards(OriginGuard)
  create(): void {}
}`,
);
invalid(
  'no-session-guard',
  'rejects a SessionGuard declaration',
  'src/auth/rule-case.guard.ts',
  'export class SessionGuard {}',
  ['forbidden'],
);
invalid(
  'no-session-guard',
  'rejects an import from a session.guard file',
  'src/programs/rule-case.controller.ts',
  "import { Guard } from '../auth/session.guard';",
  ['forbidden'],
);
invalid(
  'no-session-guard',
  'rejects a session.guard file',
  'src/auth/session.guard.ts',
  'export const guard = 1;',
  ['forbidden'],
);

const repositoryFile = 'src/programs/rule-case.repository.ts';
for (const [name, filename, code] of [
  [
    'an injectable service',
    serviceFile,
    '@Injectable() export class ThingService { run() { return 1; } }',
  ],
  [
    'an injectable repository',
    repositoryFile,
    '@Injectable() export class ThingRepository { constructor(private readonly prisma: PrismaService) {} }',
  ],
] as const) {
  valid('injectable-role-class', `allows ${name}`, filename, code);
}
for (const [name, filename, code, errors] of [
  [
    'a service without @Injectable',
    serviceFile,
    'export class ThingService { run() { return 1; } }',
    ['notInjectable'],
  ],
  [
    'a repository of static helpers',
    repositoryFile,
    'export class ThingRepository { static where() { return {}; } }',
    ['notInjectable', 'staticMember'],
  ],
  [
    'a static member on an injectable service',
    serviceFile,
    '@Injectable() export class ThingService { static readonly providers = []; }',
    ['staticMember'],
  ],
  [
    'a different decorator',
    serviceFile,
    '@Controller() export class ThingService {}',
    ['notInjectable'],
  ],
  [
    'a non-exported repository of static helpers',
    repositoryFile,
    'class ThingRepository { static run() { return 1; } }',
    ['notInjectable', 'staticMember'],
  ],
  [
    'a non-exported transaction store class',
    repositoryFile,
    'class ThingTransactionStore { constructor(private readonly transaction: unknown) {} }',
    ['notInjectable'],
  ],
  [
    'a local helper class without a role suffix',
    serviceFile,
    'class Parser { parse() { return 1; } }',
    ['notInjectable'],
  ],
] as const) {
  invalid('injectable-role-class', `rejects ${name}`, filename, code, [
    ...errors,
  ]);
}

valid(
  'request-dto-no-methods',
  'accepts a request DTO that only declares fields',
  requestFile,
  `import { IsString } from 'class-validator';
export class ThingRequestDto { @IsString() declare readonly name: string; }`,
);
invalid(
  'request-dto-no-methods',
  'rejects a conversion method on a request DTO',
  requestFile,
  `import { IsString } from 'class-validator';
export class ThingRequestDto {
  @IsString() declare readonly name: string;
  toQuery() { return { name: this.name }; }
}`,
  ['method'],
);
invalid(
  'request-dto-no-methods',
  'rejects a getter on a request DTO',
  requestFile,
  `export class ThingRequestDto { get trimmed() { return ''; } }`,
  ['method'],
);

for (const [name, filename, code, errors] of [
  [
    'a client without @Injectable',
    'src/programs/rule-case.client.ts',
    'export class ThingClient { read() { return 1; } }',
    ['notInjectable'],
  ],
  [
    'a guard without @Injectable',
    'src/programs/rule-case.guard.ts',
    'export class ThingGuard { canActivate() { return true; } }',
    ['notInjectable'],
  ],
  [
    'an interceptor without @Injectable',
    'src/programs/rule-case.interceptor.ts',
    'export class ThingInterceptor { intercept() { return 1; } }',
    ['notInjectable'],
  ],
] as const) {
  invalid('injectable-role-class', `rejects ${name}`, filename, code, [
    ...errors,
  ]);
}
valid(
  'injectable-role-class',
  'allows an injectable client',
  'src/programs/rule-case.client.ts',
  '@Injectable() export class ThingClient { read() { return 1; } }',
);
for (const filename of [
  'src/programs/rule-case.client.ts',
  'src/programs/rule-case.guard.ts',
  'src/programs/rule-case.interceptor.ts',
]) {
  invalid(
    'service-exports',
    `rejects an exported function in ${filename}`,
    filename,
    'export function helper() { return 1; }',
    ['forbidden'],
  );
}

valid(
  'thin-controller',
  'accepts a route that maps HTTP input to one service call',
  controllerFile(),
  `import { Controller, Get, Param } from '@nestjs/common';
@Controller('things')
export class ThingsController {
  constructor(private readonly service: ThingService) {}
  @Get(':id')
  async get(@Param('id') id: string): Promise<ThingResponseDto> {
    return ThingResponseDto.from(await this.service.get(id));
  }
}`,
);
valid(
  'thin-controller',
  'accepts a conditional expression that picks one of two response DTOs for the service result',
  controllerFile(),
  `export class ThingsController {
  async get(id: string) {
    const result = await this.service.find(id);
    return result.kind === 'full'
      ? FullThingResponseDto.from(result.thing)
      : ThingSummaryResponseDto.from(result.thing);
  }
}`,
);
valid(
  'thin-controller',
  'accepts a negated and combined equality predicate over the service result',
  controllerFile(),
  `export class ThingsController {
  async get(id: string) {
    const result = await this.service.find(id);
    return !result.archived && result.kind !== 'summary'
      ? FullThingResponseDto.from(result.thing)
      : ThingSummaryResponseDto.from(result.thing);
  }
}`,
);
for (const [name, body] of [
  [
    'a static response DTO',
    'uploadPolicy() { return ThingPolicyResponseDto.from(); }',
  ],
  [
    'a response DTO of a parameter',
    'get(id: string) { return ThingResponseDto.from(id); }',
  ],
  ['a literal', "ping() { return 'ok'; }"],
  ['a constant', 'limits() { return THING_LIMITS; }'],
] as const) {
  valid(
    'thin-controller',
    `accepts a route without a service call that returns ${name}`,
    controllerFile(),
    `export class ThingsController { ${body} }`,
  );
}
valid(
  'thin-controller',
  'accepts mapping a service result list to response DTOs',
  controllerFile(),
  `export class ThingsController {
  async list() {
    return (await this.service.list()).map((thing) => ThingResponseDto.from(thing));
  }
}`,
);
for (const [name, body, errors] of [
  [
    'a switch statement in a route',
    'get(kind: string) { switch (kind) { default: return this.service.get(kind); } }',
    ['branching'],
  ],
  [
    'a private helper method',
    'private helper(): number { return 1; }',
    ['hiddenMethod'],
  ],
  [
    'branching in a route',
    'get(id: string) { if (id) { return this.service.get(id); } return null; }',
    ['branching'],
  ],
  [
    'try/catch in a route',
    'async get(id: string) { try { return await this.service.get(id); } catch { return null; } }',
    ['branching'],
  ],
  [
    'two service calls in a route',
    'async get(id: string) { this.rules.check(id); return this.service.get(id); }',
    ['serviceCalls'],
  ],
  [
    'a clock read in a route',
    'get() { return this.service.list(new Date()); }',
    ['clock'],
  ],
  [
    'a business conditional passed to the service',
    'get(input) { return this.service.run(input.admin ? deleteAll() : retainAll()); }',
    ['conditional', 'domainCall', 'domainCall'],
  ],
  [
    'a conditional with a non-DTO arm',
    'async get(id: string) { const thing = await this.service.find(id); return thing ? ThingResponseDto.from(thing) : null; }',
    ['conditional'],
  ],
  [
    'a response choice that reads request input',
    'async get(input) { const result = await this.service.find(input.id); return input.full ? FullThingResponseDto.from(result) : ThingSummaryResponseDto.from(result); }',
    ['conditional'],
  ],
  [
    'a response choice over a non-service value',
    'get(thing) { return thing.full ? FullThingResponseDto.from(thing) : ThingSummaryResponseDto.from(thing); }',
    ['noService', 'conditional'],
  ],
  [
    'a choice between non-response classes',
    'async get(id: string) { const result = await this.service.find(id); return result.ok ? Thing.from(result) : Other.from(result); }',
    ['conditional', 'domainCall', 'domainCall'],
  ],
  [
    'an operator in a service call argument',
    'get(input) { return this.service.run(input.price * 2); }',
    ['expression'],
  ],
  [
    'a comparison passed to the service',
    "get(query) { return this.service.run(query.view === 'operations'); }",
    ['expression'],
  ],
  [
    'a nullish default passed to the service',
    'get(body) { return this.service.run(body.message ?? null); }',
    ['expression'],
  ],
  [
    'a string built for the service',
    'get(id) { return this.service.run(`thing-${id}`); }',
    ['expression'],
  ],
  [
    'a local variable other than the service result',
    'get(input) { const price = input.price; return this.service.run(price); }',
    ['expression'],
  ],
  [
    'a calculation without a service call or other call',
    'get(input) { return ThingResponseDto.from({ price: input.price * 2 }); }',
    ['noService'],
  ],
  [
    'an operator result without a service call',
    'get(input) { return input.price * 2; }',
    ['noService'],
  ],
  [
    'a local computation without a service call',
    'get(input) { const price = input.price; return ThingResponseDto.from(price); }',
    ['noService'],
  ],
  [
    'an update expression in the response predicate',
    'async get(id) { const result = await this.service.find(id); return result.kind === result.count++ ? AResponseDto.from(result) : BResponseDto.from(result); }',
    ['conditional'],
  ],
  [
    'a relational response predicate',
    'async get(id) { const result = await this.service.find(id); return result.price > 100 ? AResponseDto.from(result) : BResponseDto.from(result); }',
    ['conditional'],
  ],
  [
    'an assignment in the response predicate',
    "async get(id) { const result = await this.service.find(id); return (result.kind = 'a') === 'a' ? AResponseDto.from(result) : BResponseDto.from(result); }",
    ['conditional'],
  ],
  [
    'a delete in the response predicate',
    'async get(id) { const result = await this.service.find(id); return delete result.kind ? AResponseDto.from(result) : BResponseDto.from(result); }',
    ['conditional'],
  ],
  [
    'a comma in the response predicate',
    "async get(id) { const result = await this.service.find(id); return (result.count, result.kind) === 'a' ? AResponseDto.from(result) : BResponseDto.from(result); }",
    ['conditional'],
  ],
  [
    'an update expression in a response mapping argument',
    "async get(id) { const result = await this.service.find(id); return result.kind === 'a' ? AResponseDto.from(result.count++) : BResponseDto.from(result); }",
    ['conditional'],
  ],
  [
    'domain parsing in a route',
    'get(input: string) { return this.service.run(JSON.parse(input)); }',
    ['domainCall'],
  ],
  [
    'a domain calculation without a service call',
    'get(input) { return calculatePrice(input); }',
    ['noService', 'domainCall'],
  ],
  [
    'promise chaining in a route',
    'get(id: string) { return this.service.get(id).then((thing) => normalize(thing)); }',
    ['domainCall', 'domainCall'],
  ],
  [
    'constructing a value in a route',
    'async get(id: string) { return new StreamableFile(await this.service.read(id)); }',
    ['domainCall'],
  ],
] as const) {
  invalid(
    'thin-controller',
    `rejects ${name}`,
    controllerFile(),
    `export class ThingsController { ${body} }`,
    [...errors],
  );
}

const moduleFile = 'src/programs/rule-case.module.ts';
const moduleDeclarations =
  'class A {} class B {} class ThingService { constructor(a: A, b: B) {} } class ThingClient { constructor(a: A, now: () => Date = () => new Date()) {} } ';
for (const [name, code] of [
  ['a class provider', 'export const providers = [ThingService];'],
  [
    'a factory that leaves a defaulted function argument to the class',
    'export const providers = [{ provide: ThingClient, inject: [A], useFactory: (a: A) => new ThingClient(a) }];',
  ],
  [
    'a factory that closes over a function argument',
    'export const providers = [{ provide: ThingClient, inject: [A], useFactory: (a: A) => new ThingClient(a, () => new Date(0)) }];',
  ],
  [
    'a factory that selects an implementation at runtime',
    'export const providers = [{ provide: ThingService, inject: [A, B], useFactory: (a: A, b: B) => (a ? new ThingService(a, b) : new ThingService(new A(), b)) }];',
  ],
] as const) {
  valid(
    'no-passthrough-factory',
    `allows ${name}`,
    moduleFile,
    moduleDeclarations + code,
  );
}
for (const [name, code] of [
  [
    'an arrow factory that forwards every constructor argument',
    'export const providers = [{ provide: ThingService, inject: [A, B], useFactory: (a: A, b: B) => new ThingService(a, b) }];',
  ],
  [
    'a block factory that forwards every constructor argument',
    'export const providers = [{ provide: ThingService, inject: [A, B], useFactory: (a: A, b: B) => { return new ThingService(a, b); } }];',
  ],
] as const) {
  invalid(
    'no-passthrough-factory',
    `rejects ${name}`,
    moduleFile,
    moduleDeclarations + code,
    ['passThrough'],
  );
}

describe('backend convention lint rules', () => {
  let results: { ok: boolean; message?: string }[];

  beforeAll(() => {
    results = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          runner,
          backendRoot,
          JSON.stringify(cases),
        ],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      ),
    ) as typeof results;
  }, 30000);

  it.each(cases.map((item, index) => ({ ...item, index })))(
    '$rule $name',
    ({ index }) => {
      expect(results[index]).toEqual({ ok: true });
    },
  );
});
