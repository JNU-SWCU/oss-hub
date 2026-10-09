import path from 'node:path';
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isBuiltin } from 'node:module';
import { defineConfig } from 'eslint/config';
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
  'job',
  'dto',
  'domain',
];
const modulePatterns = ['src/(programs/archive/*)', 'src/(*)'];
const moduleGlobs = ['src/programs/archive/*', 'src/*'];
const testFiles = [
  'test/**/*.ts',
  'src/**/*.spec.ts',
  'src/**/*.spec.helpers.ts',
  'src/**/*.test.ts',
  'src/**/*fixture.ts',
  'src/**/*fixtures.ts',
  'src/**/*support.ts',
];
const moduleFiles = moduleGlobs.map((pattern) => `${pattern}/*.module.ts`);
const repositoryFiles = moduleGlobs.map(
  (pattern) => `${pattern}/repository/**/*.ts`,
);
const dtoFiles = moduleGlobs.map((pattern) => `${pattern}/dto/**/*.ts`);
const enumExemptFiles = [
  ...testFiles,
  ...moduleFiles,
  ...repositoryFiles,
  'src/prisma/**/*.ts',
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
        element('dto'),
        element('domain'),
        category('auth-capability'),
      ],
    },
  },
  {
    from: element('job'),
    allow: {
      to: [
        element('service'),
        element('dto'),
        element('domain'),
        element('runtime-config'),
        category('auth-capability'),
        category('bootstrap'),
      ],
    },
  },
  {
    from: element('service'),
    allow: {
      to: [
        element('service'),
        element('dto'),
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
    from: [element('gateway'), element('dto'), element('domain')],
    allow: { to: element('domain') },
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
  { from: element('runtime-config'), allow: { to: element('runtime-config') } },
  {
    from: element('prisma'),
    allow: { to: [element('prisma'), element('runtime-config')] },
  },
  {
    from: category('composition'),
    allow: {
      to: [
        element('service'),
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
    disallow: { to: { file: { path: '**/src/prisma/lock-program-tree.ts' } } },
  },
  {
    from: [element('repository'), category('test')],
    allow: { to: { file: { path: '**/src/prisma/lock-program-tree.ts' } } },
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
            'no-cycle': noCycle,
            'no-dpdm-ignore': noDpdmIgnore,
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
          ...['common', 'prisma', 'runtime-config'].map((type) => ({
            type,
            pattern: `src/${type}`,
            partialMatch: false,
          })),
          ...layers.flatMap((type) =>
            modulePatterns.map((pattern) => ({
              type,
              pattern: `${pattern}/${type}`,
              capture: ['module'],
              partialMatch: false,
            })),
          ),
        ],
        'boundaries/files': [
          { category: 'test', pattern: testFiles },
          { category: 'test', pattern: 'prisma/**/*.ts' },
          {
            category: 'bootstrap',
            pattern: [
              'src/main.ts',
              'src/app.module.ts',
              'src/app-controller-discovery.ts',
            ],
          },
          {
            category: 'auth-capability',
            pattern: [
              'src/auth/{authentication.guard,origin.guard,session.guard,http-auth,auth-route-metadata}.ts',
              'src/auth/controller/{authentication.guard,origin.guard,session.guard,http-auth,auth-route-metadata}.ts',
            ],
          },
          {
            category: 'storage-public',
            pattern: [
              'src/storage/storage.module.ts',
              'src/storage/*.{key,token}.ts',
            ],
          },
          ...modulePatterns.flatMap((pattern) => [
            {
              category: 'composition',
              pattern: `${pattern}/*.module.ts`,
              capture: ['module'],
            },
            {
              category: 'guard',
              pattern: `${pattern}/*.guard.ts`,
              capture: ['module'],
            },
            {
              category: 'root-contract',
              pattern: `${pattern}/*.{config,key,token,types,error-code,error-code.enum}.ts`,
              capture: ['module'],
            },
            {
              category: 'root-contract',
              pattern: `${pattern}/*-error-code.enum.ts`,
              capture: ['module'],
            },
          ]),
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
            checkUnknownLocals: false,
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
  ]);
}
