import path from 'node:path';
import { defineConfig } from 'eslint/config';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';
import { prismaEnumNames } from '../../scripts/prisma-enum-names.mjs';

const layers = ['controller', 'service', 'repository', 'gateway', 'job', 'dto', 'domain'];
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
const repositoryFiles = moduleGlobs.map((pattern) => `${pattern}/repository/**/*.ts`);
const dtoFiles = moduleGlobs.map((pattern) => `${pattern}/dto/**/*.ts`);
const enumExemptFiles = [...testFiles, ...moduleFiles, ...repositoryFiles, 'src/prisma/**/*.ts', 'prisma/**/*.ts'];
const enumPattern = `/^(${prismaEnumNames.join('|')})$/`;
const enumMessage = 'Prisma 열거형만 import할 수 있다. DB 접근은 repository와 prisma/에서만 한다.';
const nestKeys = new Set(['APP_GUARD', 'APP_FILTER', 'APP_INTERCEPTOR', 'APP_PIPE']);

const element = (type, captured) => ({ element: { type, ...(captured ? { captured } : {}) } });
const category = (name) => ({ file: { categories: name } });
const sameModule = { module: '{{from.element.captured.module}}' };
const controller = [element('controller'), category('guard'), category('auth-capability')];

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
  if (definition.type !== 'ImportBinding' || definition.parent.source.value !== '@nestjs/core') return false;
  if (member) {
    if (node.computed && node.property.type !== 'Literal') return false;
    return definition.node.type === 'ImportNamespaceSpecifier' &&
      nestKeys.has(propertyName(node.property));
  }
  return definition.node.type === 'ImportSpecifier' &&
    nestKeys.has(propertyName(definition.node.imported));
}

const noClassAlias = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: '클래스 별칭 주입 키는 금지한다. 클래스를 직접 주입한다.' },
  },
  create(context) {
    return {
      ObjectExpression(node) {
        const properties = node.properties.filter((property) => property.type === 'Property');
        const aliases = properties.filter((property) => propertyName(property.key) === 'useExisting');
        const provide = properties.find((property) => propertyName(property.key) === 'provide');
        if (provide && (!provide.computed || provide.key.type === 'Literal') && nestRegistrationKey(provide.value, context.sourceCode)) return;
        for (const alias of aliases) context.report({ node: alias, messageId: 'forbidden' });
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

const policies = [
  { allow: { to: { module: { origin: ['external', 'core'] } } } },
  { allow: { to: element('common') } },
  { from: controller, allow: { to: [element('service'), element('dto'), element('domain'), category('auth-capability')] } },
  { from: element('job'), allow: { to: [element('service'), element('dto'), element('domain'), category('auth-capability')] } },
  { from: element('service'), allow: { to: [element('service'), element('dto'), element('domain'), element('repository', sameModule), element('gateway', sameModule), element('runtime-config'), category('storage-public')] } },
  { from: element('repository'), allow: { to: [element('domain'), element('prisma')] } },
  { from: [element('gateway'), element('dto'), element('domain')], allow: { to: element('domain') } },
  { from: layers.filter((layer) => layer !== 'domain').map((layer) => element(layer)), allow: { to: { file: { categories: 'root-contract', captured: sameModule } } } },
  { from: category('root-contract'), allow: { to: [element('domain'), element('runtime-config'), { file: { categories: 'root-contract', captured: { module: '{{from.file.captured.module}}' } } }] } },
  { from: element('runtime-config'), allow: { to: element('runtime-config') } },
  { from: element('prisma'), allow: { to: [element('prisma'), element('runtime-config')] } },
  { from: category('composition'), allow: { to: [element('service'), category('composition'), { element: { captured: { module: '{{from.file.captured.module}}' } } }, { file: { captured: { module: '{{from.file.captured.module}}' } } }] } },
  { from: category('bootstrap'), allow: { to: { module: { origin: 'local' } } } },
  { disallow: { to: category('test') } },
  { from: category('test'), allow: { to: { module: { origin: ['local', 'external', 'core'] } } } },
  { disallow: { to: { file: { path: '**/src/prisma/lock-program-tree.ts' } } } },
  { from: [element('repository'), category('test')], allow: { to: { file: { path: '**/src/prisma/lock-program-tree.ts' } } } },
];

export function createRailsConfig(rootDir = import.meta.dirname) {
  return defineConfig([
    { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
    {
      files: ['src/**/*.ts', 'test/**/*.ts', 'prisma/**/*.ts'],
      languageOptions: { parser: tseslint.parser },
      linterOptions: { noInlineConfig: true },
      plugins: { boundaries, architecture: { rules: { 'no-class-alias': noClassAlias, 'dto-location': dtoLocation } } },
      settings: {
        'boundaries/root-path': rootDir,
        'boundaries/files-single-match': false,
        'boundaries/dependency-nodes': ['import', 'export', 'require', 'dynamic-import'],
        'boundaries/additional-dependency-nodes': [
          { selector: 'TSImportType > Literal', kind: 'type' },
          { selector: 'TSImportEqualsDeclaration > TSExternalModuleReference > Literal', kind: 'value' },
        ],
        'boundaries/elements': [
          ...['common', 'prisma', 'runtime-config'].map((type) => ({ type, pattern: `src/${type}`, partialMatch: false })),
          ...layers.flatMap((type) => modulePatterns.map((pattern) => ({ type, pattern: `${pattern}/${type}`, capture: ['module'], partialMatch: false }))),
        ],
        'boundaries/files': [
          { category: 'test', pattern: testFiles },
          { category: 'test', pattern: 'prisma/**/*.ts' },
          { category: 'bootstrap', pattern: ['src/main.ts', 'src/app.module.ts', 'src/app-controller-discovery.ts'] },
          { category: 'auth-capability', pattern: ['src/auth/{authentication.guard,origin.guard,session.guard,http-auth,auth-route-metadata}.ts', 'src/auth/controller/{authentication.guard,origin.guard,session.guard,http-auth,auth-route-metadata}.ts'] },
          { category: 'storage-public', pattern: ['src/storage/storage.module.ts', 'src/storage/*.{key,token}.ts'] },
          ...modulePatterns.flatMap((pattern) => [
            { category: 'composition', pattern: `${pattern}/*.module.ts`, capture: ['module'] },
            { category: 'guard', pattern: `${pattern}/*.guard.ts`, capture: ['module'] },
            { category: 'root-contract', pattern: `${pattern}/*.{config,key,token,types,error-code,error-code.enum}.ts`, capture: ['module'] },
            { category: 'root-contract', pattern: `${pattern}/*-error-code.enum.ts`, capture: ['module'] },
          ]),
        ],
        'import/resolver': { typescript: { project: path.join(rootDir, 'tsconfig.json'), alwaysTryTypes: true } },
      },
      rules: {
        'boundaries/dependencies': ['error', { default: 'disallow', checkAllOrigins: true, checkUnknownLocals: true, checkInternals: true, policies }],
        'boundaries/no-unknown-files': 'error',
        'boundaries/no-unknown-dependencies': 'error',
        'architecture/no-class-alias': 'error',
      },
    },
    {
      files: ['src/**/*.ts'],
      ignores: enumExemptFiles,
      rules: {
        'no-restricted-imports': ['error', { paths: [{ name: '@prisma/client', allowImportNames: prismaEnumNames, message: enumMessage }] }],
        'no-restricted-syntax': [
          'error',
          { selector: "ImportDeclaration[source.value='@prisma/client'][specifiers.length=0]", message: enumMessage },
          { selector: `ExportNamedDeclaration[source.value='@prisma/client'] > ExportSpecifier:not([local.name=${enumPattern}]):not([local.value=${enumPattern}])`, message: enumMessage },
          { selector: "ExportAllDeclaration[source.value='@prisma/client']", message: enumMessage },
          { selector: "ImportExpression[source.value='@prisma/client']", message: enumMessage },
          { selector: "CallExpression[callee.name='require'][arguments.0.value='@prisma/client']", message: enumMessage },
          { selector: "TSImportType[source.value='@prisma/client']", message: enumMessage },
          { selector: "TSImportEqualsDeclaration > TSExternalModuleReference > Literal[value='@prisma/client']", message: enumMessage },
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

export default createRailsConfig();
