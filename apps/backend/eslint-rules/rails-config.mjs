import path from 'node:path';
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isBuiltin } from 'node:module';
import { defineConfig } from 'eslint/config';
import { builtinRules } from 'eslint/use-at-your-own-risk';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';
import ts from 'typescript';
import { parseCircular, parseDependencyTree } from 'dpdm';
import { prismaEnumNames } from '../../../scripts/prisma-enum-names.mjs';

const layers = [
  'controller',
  'service',
  'repository',
  'gateway',
  'dto',
  'domain',
];
const flatModules =
  'auth|users|programs|ranking|student|staff|admin|notifications|github|platform';
const flatModulePattern = `src/(${flatModules})`;
const flatModuleGlob = `src/{${flatModules.replaceAll('|', ',')}}`;
export const testFiles = [
  'test/**/*.ts',
  'src/**/*.spec.ts',
  'src/**/*.spec.helpers.ts',
  'src/**/*.test.ts',
  'src/**/*fixture.ts',
  'src/**/*fixtures.ts',
  'src/**/*support.ts',
];
export const bootstrapFiles = [
  'src/main.ts',
  'src/cli.ts',
  'src/app.module.ts',
  'src/app-controller-discovery.ts',
];
const dtoFiles = [`${flatModuleGlob}/dto/*.ts`];
const enumExemptFiles = [
  ...testFiles,
  `${flatModuleGlob}/*.module.ts`,
  `${flatModuleGlob}/*.repository.ts`,
  'src/platform/prisma.service.ts',
  'prisma/**/*.ts',
];
const enumPattern = `/^(${prismaEnumNames.join('|')})$/`;
const enumMessage =
  'Prisma 열거형만 import할 수 있다. DB 접근은 repository와 prisma/에서만 한다.';
const nestKeys = new Set([
  'APP_GUARD',
  'APP_FILTER',
  'APP_INTERCEPTOR',
  'APP_PIPE',
]);
const unsupportedCycleSyntax = [
  {
    selector: 'TSImportType',
    message:
      '순환 검사에서 지원하지 않는 import 타입 대신 정적 import type 선언을 사용한다.',
  },
  {
    selector:
      'TSImportEqualsDeclaration[moduleReference.type=TSExternalModuleReference]',
    message:
      '순환 검사에서 지원하지 않는 import equals 대신 정적 import 선언을 사용한다.',
  },
];
const runtimeConfigFiles = ['src/platform/runtime-config.config.ts'];
const lockProgramTreeFiles = '**/src/platform/lock-program-tree.repository.ts';
const nestTestingImport = {
  name: '@nestjs/testing',
  message:
    '운영 코드는 @nestjs/testing을 참조하지 않는다 — E2E 조립은 test/e2e-program-authoring/main.ts에서만 한다 (#1427).',
};
const mainImport = {
  group: ['**/main'],
  message:
    'main.ts는 하단에서 bootstrap()을 실행한다 — 공유 로직은 부수효과 없는 파일로 옮기고 그 파일을 import한다.',
};
const nodeEnvTestMessage =
  '운영 코드는 지금 테스트 중인지 묻지 않는다 — NODE_ENV를 test와 비교해 분기하지 않는다 (#1427).';
const envRestrictedSyntax = [
  {
    selector:
      "MemberExpression[object.object.name='process'][object.property.name='env']",
    message:
      '환경변수는 runtime-config manifest를 거쳐 읽는다 — process.env 키 직접 접근 금지.',
  },
  {
    selector:
      "VariableDeclarator[init.object.name='process'][init.property.name='env'] > ObjectPattern",
    message:
      '환경변수는 runtime-config manifest를 거쳐 읽는다 — process.env 구조분해 금지.',
  },
  {
    selector:
      "BinaryExpression[operator=/^(===|!==|==|!=)$/][left.property.name='NODE_ENV'][right.value='test']",
    message: nodeEnvTestMessage,
  },
  {
    selector:
      "BinaryExpression[operator=/^(===|!==|==|!=)$/][left.value='test'][right.property.name='NODE_ENV']",
    message: nodeEnvTestMessage,
  },
];
const collectionDelegateRestrictedSyntax = {
  selector: 'MemberExpression[property.name=/^canonical[A-Z]/]',
  message:
    'collection Prisma delegate(canonical*)는 collection 구현 밖에서 접근하지 않는다.',
};

const element = (type, captured) => ({
  element: { type, ...(captured ? { captured } : {}) },
});
const category = (name) => ({ file: { categories: name } });
const sameModule = { module: '{{from.element.captured.module}}' };
const controller = [
  element('controller'),
  category('guard'),
  category('auth-capability'),
];

function propertyName(node) {
  if (node.type === 'Identifier' && !node.computed) return node.name;
  if (node.type === 'Literal') return node.value;
  return undefined;
}

function nestRegistrationKey(node, sourceCode) {
  const member = node.type === 'MemberExpression';
  const identifier = member ? node.object : node;
  if (identifier.type !== 'Identifier') return false;
  let scope = sourceCode.getScope(identifier);
  while (scope && !scope.set.has(identifier.name)) scope = scope.upper;
  const definitions = scope?.set.get(identifier.name)?.defs;
  if (definitions?.length !== 1) return false;
  const definition = definitions[0];
  if (
    definition.type !== 'ImportBinding' ||
    definition.parent.source.value !== '@nestjs/core'
  )
    return false;
  if (member) {
    if (node.computed && node.property.type !== 'Literal') return false;
    return (
      definition.node.type === 'ImportNamespaceSpecifier' &&
      nestKeys.has(propertyName(node.property))
    );
  }
  return (
    definition.node.type === 'ImportSpecifier' &&
    nestKeys.has(propertyName(definition.node.imported))
  );
}

const noClassAlias = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      forbidden: '클래스 별칭 주입 키는 금지한다. 클래스를 직접 주입한다.',
    },
  },
  create(context) {
    return {
      ObjectExpression(node) {
        const properties = node.properties.filter(
          (property) => property.type === 'Property',
        );
        const aliases = properties.filter(
          (property) => propertyName(property.key) === 'useExisting',
        );
        const provide = properties.find(
          (property) => propertyName(property.key) === 'provide',
        );
        if (
          provide &&
          (!provide.computed || provide.key.type === 'Literal') &&
          nestRegistrationKey(provide.value, context.sourceCode)
        )
          return;
        for (const alias of aliases)
          context.report({ node: alias, messageId: 'forbidden' });
      },
    };
  },
};

const dtoLocation = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: 'Dto 클래스는 모듈의 dto/에서만 선언한다.' },
  },
  create(context) {
    return {
      'ClassDeclaration[id.name=/Dto$/]'(node) {
        context.report({ node, messageId: 'forbidden' });
      },
    };
  },
};

const noDpdmIgnore = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: '@dpdm-ignore로 순환 의존 검사를 생략할 수 없다.' },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.value.includes('@dpdm-ignore')) {
            context.report({ loc: comment.loc, messageId: 'forbidden' });
          }
        }
      },
    };
  },
};

const repositoryExports = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      forbidden:
        'repository 파일은 데이터 접근만 둔다 — 클래스와 타입만 export한다. 함수는 서비스, 상수는 .config.ts로 옮긴다.',
    },
  },
  create(context) {
    const report = (node) => context.report({ node, messageId: 'forbidden' });
    return {
      ExportDefaultDeclaration(node) {
        if (node.declaration.type !== 'ClassDeclaration') report(node);
      },
      ExportAllDeclaration(node) {
        if (node.exportKind !== 'type') report(node);
      },
      ExportNamedDeclaration(node) {
        if (node.exportKind === 'type') return;
        if (node.declaration) {
          if (
            [
              'VariableDeclaration',
              'FunctionDeclaration',
              'TSEnumDeclaration',
            ].includes(node.declaration.type)
          )
            report(node);
          return;
        }
        for (const specifier of node.specifiers)
          if (specifier.exportKind !== 'type') report(specifier);
      },
    };
  },
};

const typesOnly = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      forbidden:
        '.types.ts에는 타입만 둔다. 런타임 코드는 만드는 쪽 파일로 옮긴다.',
    },
  },
  create(context) {
    const runtime = new Set([
      'VariableDeclaration',
      'FunctionDeclaration',
      'ClassDeclaration',
      'TSEnumDeclaration',
    ]);
    return {
      Program(program) {
        for (const statement of program.body) {
          const node =
            statement.type === 'ExportNamedDeclaration' ||
            statement.type === 'ExportDefaultDeclaration'
              ? statement.declaration
              : statement;
          if (node && runtime.has(node.type))
            context.report({ node, messageId: 'forbidden' });
        }
      },
    };
  },
};

async function cycleRule(rootDir) {
  const tsconfig = path.join(rootDir, 'tsconfig.json');
  const read = ts.readConfigFile(tsconfig, ts.sys.readFile);
  if (read.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(read.error.messageText, '\n'),
    );
  const config = ts.parseJsonConfigFileContent(read.config, ts.sys, rootDir);
  if (config.errors.length)
    throw new Error(
      config.errors
        .map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, '\n'),
        )
        .join('\n'),
    );
  const aliases = Object.keys(config.options.paths ?? {});
  const isAlias = (request) =>
    aliases.some((alias) => {
      const wildcard = alias.indexOf('*');
      return wildcard === -1
        ? request === alias
        : request.startsWith(alias.slice(0, wildcard)) &&
            request.endsWith(alias.slice(wildcard + 1));
    });
  const isSource = (file) => {
    const relative = path.relative(
      path.join(rootDir, 'src'),
      path.resolve(rootDir, file),
    );
    return (
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  const tree = await parseDependencyTree('src/**/*.ts', {
    cwd: rootDir,
    context: rootDir,
    tsconfig,
    transform: false,
    skipDynamicImports: false,
  });
  for (const [file, dependencies] of Object.entries(tree)) {
    if (dependencies === null && isSource(file)) {
      throw new Error(`cycle-incomplete: excluded internal source ${file}`);
    }
    for (const dependency of dependencies ?? []) {
      const request = dependency.request;
      if (dependency.id !== null || isBuiltin(request)) continue;
      const baseUrlSource =
        config.options.baseUrl &&
        isSource(path.resolve(config.options.baseUrl, request));
      if (
        request.startsWith('.') ||
        path.isAbsolute(request) ||
        isAlias(request) ||
        baseUrlSource
      ) {
        throw new Error(
          `cycle-incomplete: unresolved internal dependency ${file} -> ${request}`,
        );
      }
    }
  }
  const ordered = Object.fromEntries(
    Object.entries(tree)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([file, dependencies]) => [
        file,
        dependencies?.slice().sort((left, right) => {
          const a = JSON.stringify([left.id, left.kind, left.request]);
          const b = JSON.stringify([right.id, right.kind, right.request]);
          return a < b ? -1 : a > b ? 1 : 0;
        }) ?? null,
      ]),
  );
  const witnesses = parseCircular(ordered);
  if (witnesses.length > 0) {
    for (const [issuer, dependencies] of Object.entries(ordered)) {
      const targets = new Set();
      for (const dependency of dependencies ?? []) {
        if (
          !dependency.id ||
          !ordered[dependency.id] ||
          targets.has(dependency.id)
        )
          continue;
        targets.add(dependency.id);
        const rooted = { [issuer]: [dependency], ...ordered };
        rooted[issuer] = [dependency];
        witnesses.push(
          ...parseCircular(rooted).filter((cycle) => cycle.includes(issuer)),
        );
      }
    }
  }
  const cycles = new Map();
  for (const witness of witnesses) {
    const nodes = witness.map((file) => file.split(path.sep).join('/'));
    const rotations = nodes.map((_, index) => [
      ...nodes.slice(index),
      ...nodes.slice(0, index),
    ]);
    const canonical = rotations
      .map((rotation) => JSON.stringify(rotation))
      .sort()[0];
    const orderedNodes = JSON.parse(canonical);
    const reporter = orderedNodes.find(
      (file) => file.startsWith('src/') && file.endsWith('.ts'),
    );
    if (!reporter)
      throw new Error(
        `순환 의존 진단을 backend src 파일에 연결할 수 없다: ${canonical}`,
      );
    const messageId = `cycle_${createHash('sha256').update(canonical).digest('hex')}`;
    cycles.set(messageId, {
      reporter,
      cycle: JSON.stringify([...orderedNodes, orderedNodes[0]]),
    });
  }
  return {
    meta: {
      type: 'problem',
      schema: [],
      messages: Object.fromEntries(
        [...cycles.keys()]
          .sort()
          .map((id) => [id, '순환 의존은 금지한다: {{cycle}}']),
      ),
    },
    create(context) {
      const file = path
        .relative(rootDir, context.filename)
        .split(path.sep)
        .join('/');
      return {
        Program() {
          for (const [messageId, cycle] of cycles) {
            if (cycle.reporter !== file) continue;
            context.report({
              loc: {
                start: { line: 1, column: 0 },
                end: { line: 1, column: 0 },
              },
              messageId,
              data: { cycle: cycle.cycle },
            });
          }
        },
      };
    },
  };
}

const policies = [
  { allow: { to: { module: { origin: ['external', 'core'] } } } },
  { allow: { to: element('common') } },
  {
    from: controller,
    allow: {
      to: [
        element('service'),
        element('dto', sameModule),
        element('domain'),
        category('auth-capability'),
      ],
    },
  },
  {
    from: element('service'),
    allow: {
      to: [
        element('service'),
        element('domain'),
        element('repository', sameModule),
        element('gateway', sameModule),
        element('runtime-config'),
        category('storage-public'),
      ],
    },
  },
  {
    from: element('repository'),
    allow: {
      to: [
        element('domain'),
        element('prisma'),
        element('repository', sameModule),
      ],
    },
  },
  {
    from: [element('service'), element('repository')],
    dependency: { kind: 'type' },
    allow: { to: element('repository') },
  },
  {
    from: element('repository'),
    dependency: { kind: 'type' },
    allow: { to: element('gateway', sameModule) },
  },
  {
    from: { file: { path: '**/dto/*-request.dto.ts' } },
    allow: {
      to: [element('service', sameModule), element('repository', sameModule)],
    },
  },
  {
    from: { file: { path: '**/dto/*-request.dto.ts' } },
    dependency: { kind: 'type' },
    allow: { to: [element('service'), element('repository')] },
  },
  {
    from: { file: { path: '**/dto/*-response.dto.ts' } },
    dependency: { kind: 'type' },
    allow: {
      to: [element('service'), element('repository'), element('gateway')],
    },
  },
  {
    from: [element('gateway'), element('dto'), element('domain')],
    allow: { to: element('domain') },
  },
  {
    from: element('gateway'),
    allow: { to: element('gateway', sameModule) },
  },
  {
    from: element('dto'),
    allow: {
      to: element('dto', { module: '{{from.element.captured.module}}' }),
    },
  },
  {
    from: layers
      .filter((layer) => layer !== 'domain')
      .map((layer) => element(layer)),
    allow: {
      to: { file: { categories: 'root-contract', captured: sameModule } },
    },
  },
  {
    from: category('root-contract'),
    allow: {
      to: [
        element('domain'),
        element('runtime-config'),
        element('prisma'),
        {
          file: {
            categories: 'root-contract',
            captured: { module: '{{from.file.captured.module}}' },
          },
        },
      ],
    },
  },
  {
    from: { file: { categories: 'root-contract', path: '**/*.types.ts' } },
    dependency: { kind: 'type' },
    allow: {
      to: [
        element('gateway', { module: '{{from.file.captured.module}}' }),
        element('repository', { module: '{{from.file.captured.module}}' }),
      ],
    },
  },
  { from: element('runtime-config'), allow: { to: element('runtime-config') } },
  {
    from: element('prisma'),
    allow: {
      to: [
        element('prisma'),
        element('runtime-config'),
        {
          file: {
            categories: 'root-contract',
            captured: { module: 'platform' },
          },
        },
      ],
    },
  },
  {
    from: category('composition'),
    allow: {
      to: [
        element('service'),
        element('prisma'),
        category('composition'),
        { element: { captured: { module: '{{from.file.captured.module}}' } } },
        { file: { captured: { module: '{{from.file.captured.module}}' } } },
      ],
    },
  },
  {
    from: category('bootstrap'),
    allow: { to: { module: { origin: 'local' } } },
  },
  { disallow: { to: category('test') } },
  {
    from: category('test'),
    allow: { to: { module: { origin: ['local', 'external', 'core'] } } },
  },
  {
    disallow: { to: { file: { path: lockProgramTreeFiles } } },
  },
  {
    from: [element('repository'), category('test')],
    allow: { to: { file: { path: lockProgramTreeFiles } } },
  },
  {
    from: { file: { path: '**/src/github/**/*.ts' } },
    disallow: {
      to: {
        file: { path: '**/src/{programs,ranking,student,staff,admin}/**' },
      },
    },
    message:
      'github 구현은 소비자 모듈(programs/ranking/student/staff/admin)을 역참조하지 않는다.',
  },
];

export async function createRailsConfig(rootDir) {
  rootDir = realpathSync(rootDir);
  const noCycle = await cycleRule(rootDir);
  return defineConfig([
    { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
    {
      files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
      languageOptions: { parser: tseslint.parser },
      linterOptions: { noInlineConfig: true },
      plugins: {
        architecture: {
          rules: {
            'no-class-alias': noClassAlias,
            'dto-location': dtoLocation,
            'repository-exports': repositoryExports,
            'types-only': typesOnly,
            'no-cycle': noCycle,
            'no-dpdm-ignore': noDpdmIgnore,
            'restricted-imports': builtinRules.get('no-restricted-imports'),
            'restricted-syntax': builtinRules.get('no-restricted-syntax'),
          },
        },
      },
      rules: { 'architecture/no-dpdm-ignore': 'error' },
    },
    {
      files: ['src/**/*.ts', 'test/**/*.ts', 'prisma/**/*.ts'],
      languageOptions: { parser: tseslint.parser },
      linterOptions: { noInlineConfig: true },
      plugins: { boundaries },
      settings: {
        'boundaries/root-path': rootDir,
        'boundaries/files-single-match': false,
        'boundaries/dependency-nodes': [
          'import',
          'export',
          'require',
          'dynamic-import',
        ],
        'boundaries/additional-dependency-nodes': [
          {
            selector: 'TSImportType > Literal',
            kind: 'type',
            name: 'typescript-import-type',
          },
          {
            selector:
              'TSImportEqualsDeclaration > TSExternalModuleReference > Literal',
            kind: 'value',
            name: 'typescript-import-equals',
          },
        ],
        'boundaries/elements': [
          {
            type: 'prisma',
            pattern: [
              'src/platform/prisma.service.ts',
              'src/platform/{platform,lock-program-tree,repository-provision-generation}.repository.ts',
              'src/platform/{lock-program-tree,repository-provision-generation}.error.ts',
            ],
            mode: 'full',
          },
          {
            type: 'runtime-config',
            pattern:
              'src/platform/{runtime-config,runtime-config-instance,private-key-file,join-code-secret}.config.ts',
            mode: 'full',
          },
          {
            type: 'common',
            pattern: [
              'src/platform/configure-http-app.config.ts',
              'src/platform/{problem-detail.filter,multipart-file-upload.interceptor,prisma-serialization-retry.repository}.ts',
              'src/platform/{system-error-code,error-code}.error.ts',
            ],
            mode: 'full',
          },
          ...Object.entries({
            controller: '*.{controller,guard,interceptor,filter}.ts',
            service: '*.service.ts',
            repository: '*.repository.ts',
            gateway: '*.client.ts',
            dto: 'dto/*.dto.ts',
            domain: '*.{error,types,config}.ts',
          }).map(([type, suffix]) => ({
            type,
            pattern: `${flatModulePattern}/${suffix}`,
            mode: 'full',
            capture: ['module'],
          })),
        ],
        'boundaries/files': [
          { category: 'test', pattern: testFiles },
          { category: 'test', pattern: 'prisma/**/*.ts' },
          {
            category: 'bootstrap',
            pattern: bootstrapFiles,
          },
          {
            category: 'auth-capability',
            pattern: [
              'src/auth/{authentication.guard,origin.guard,session.guard,http-auth.types}.ts',
              'src/auth/auth.config.ts',
            ],
          },
          {
            category: 'storage-public',
            pattern: [
              'src/platform/platform.module.ts',
              'src/platform/object-storage.types.ts',
            ],
          },
          {
            category: 'guard',
            pattern: `${flatModulePattern}/*.{guard,interceptor,filter}.ts`,
            capture: ['module'],
          },
          {
            category: 'composition',
            pattern: `${flatModulePattern}/*.module.ts`,
            capture: ['module'],
          },
          {
            category: 'root-contract',
            pattern: `${flatModulePattern}/*.{config,types}.ts`,
            capture: ['module'],
          },
        ],
        'import/resolver': {
          typescript: {
            project: path.join(rootDir, 'tsconfig.json'),
            alwaysTryTypes: true,
          },
        },
      },
      rules: {
        'boundaries/dependencies': [
          'error',
          {
            default: 'disallow',
            checkAllOrigins: true,
            checkUnknownLocals: true,
            checkInternals: true,
            policies,
          },
        ],
        'boundaries/no-unknown-files': 'error',
        'architecture/no-class-alias': 'error',
        'architecture/no-cycle': 'error',
      },
    },
    {
      files: ['src/**/*.ts'],
      ignores: testFiles,
      rules: { 'no-restricted-syntax': ['error', ...unsupportedCycleSyntax] },
    },
    {
      files: ['src/**/*.ts'],
      ignores: enumExemptFiles,
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: '@prisma/client',
                allowImportNames: prismaEnumNames,
                message: enumMessage,
              },
            ],
          },
        ],
        'no-restricted-syntax': [
          'error',
          ...unsupportedCycleSyntax,
          {
            selector:
              "ImportDeclaration[source.value='@prisma/client'][specifiers.length=0]",
            message: enumMessage,
          },
          {
            selector: `ExportNamedDeclaration[source.value='@prisma/client'] > ExportSpecifier:not([local.name=${enumPattern}]):not([local.value=${enumPattern}])`,
            message: enumMessage,
          },
          {
            selector: "ExportAllDeclaration[source.value='@prisma/client']",
            message: enumMessage,
          },
          {
            selector: "ImportExpression[source.value='@prisma/client']",
            message: enumMessage,
          },
          {
            selector:
              "CallExpression[callee.name='require'][arguments.0.value='@prisma/client']",
            message: enumMessage,
          },
          {
            selector: "TSImportType[source.value='@prisma/client']",
            message: enumMessage,
          },
          {
            selector:
              "TSImportEqualsDeclaration > TSExternalModuleReference > Literal[value='@prisma/client']",
            message: enumMessage,
          },
        ],
      },
    },
    {
      files: ['src/**/*.ts'],
      ignores: [...testFiles, ...dtoFiles],
      rules: {
        'architecture/dto-location': 'error',
      },
    },
    {
      files: ['src/**/*.ts'],
      ignores: testFiles,
      rules: {
        'architecture/restricted-imports': [
          'error',
          { paths: [nestTestingImport], patterns: [mainImport] },
        ],
      },
    },
    {
      files: ['src/**/*.repository.ts'],
      ignores: testFiles,
      rules: { 'architecture/repository-exports': 'error' },
    },
    {
      files: ['src/**/*.types.ts'],
      ignores: testFiles,
      rules: { 'architecture/types-only': 'error' },
    },
    {
      files: ['test/**/*.ts'],
      rules: {
        'architecture/restricted-imports': [
          'error',
          { patterns: [mainImport] },
        ],
      },
    },
    {
      files: ['src/**/*.ts'],
      ignores: [...testFiles, ...runtimeConfigFiles],
      rules: {
        'architecture/restricted-syntax': [
          'error',
          ...envRestrictedSyntax,
          collectionDelegateRestrictedSyntax,
        ],
      },
    },
    {
      files: ['src/github/*.ts'],
      ignores: testFiles,
      rules: {
        'architecture/restricted-syntax': ['error', ...envRestrictedSyntax],
      },
    },
  ]);
}
