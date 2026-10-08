import path from 'node:path';
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import moduleZoneBoundary from './eslint-rules/module-zone-boundary.mjs';
import { sharedConfig } from '../../eslint.shared.mjs';

const srcDir = path.join(import.meta.dirname, 'src');
const sharedDirs = new Set(['common', 'prisma']);

const testFileBasenamePattern = '(\\.spec|fixtures?|support)\\.ts$';
const testFileGlobs = [
  'src/**/*.spec.ts',
  'src/**/*fixture.ts',
  'src/**/*fixtures.ts',
  'src/**/*support.ts',
];

const collectionPublicFiles = [
  'collection.module',

  'collection-trigger.port',

  'repositories.module',
  'repositories.service',
  'repositories.repository',
  'repositories-read.port',
  'repositories.integration-support',
  'github-app.client',
  'github-app.error',

  'repository-identity',

  'collection-schedule',

  'repository-provision-event',
];
const collectionPublicDirs = ['dto', 'domain'];

const collectionPublicPaths = [
  'service/repositories.service',
  'repository/repositories.repository',

  'service/own-repository-url-validation.service',
  'service/collection-trigger.service',
];
const collectionInternalMessage =
  '소비자 Service는 github의 concrete repository를 import하지 않는다. 소비자 Repository는 Prisma를 쓴다. (ADR-003 DEC-42)';

const collectionConsumerZones = ['programs', 'ranking', 'system-status'];
const collectionReverseImportMessage =
  'github 구현은 소비자 모듈(programs/ranking/system-status)을 역참조하지 않는다 (ADR-003 DEC-42).';

const controllerPrismaMessage =
  'controller는 Prisma에 직접 접근하지 않는다 — service를 거쳐 repository/port로 위임한다 (ADR-003).';

const moduleZoneBoundaryOptions = {
  srcRoot: srcDir,
  sharedZones: [...sharedDirs],
  internalDirs: ['dto'],
  encapsulated: [
    {
      zone: 'github',
      publicFiles: collectionPublicFiles,
      publicDirs: collectionPublicDirs,
      publicPaths: collectionPublicPaths,
      message: collectionInternalMessage,
    },
  ],
  reverseDeny: [
    {
      from: 'github',
      to: collectionConsumerZones,
      message: collectionReverseImportMessage,
    },
  ],
  rolePathDeny: [
    {
      fileSuffix: '.controller.ts',
      denyPaths: ['prisma/prisma.service'],
      message: controllerPrismaMessage,
    },

    {
      fileSuffix: '.service.ts',
      denyPaths: ['prisma/prisma.service'],
      zones: ['programs', 'ranking'],

      knownDebt: [
        'programs/service/program-lifecycle.service.ts',
        'programs/service/student-dashboard.service.ts',
      ],
      message:
        'service 는 Prisma 를 직접 부르지 않는다 — repository 계층으로 위임한다 (ADR-010 §8).',
    },
  ],

  testBoundary: {
    testDir: path.join(import.meta.dirname, 'test'),
    basenamePattern: testFileBasenamePattern,
    message:
      '운영 코드는 테스트 코드를 참조하지 않는다 — E2E 대역은 test/e2e-program-authoring/main.ts에서만 끼운다 (#1427).',
  },
};

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
    message:
      '운영 코드는 지금 테스트 중인지 묻지 않는다 — NODE_ENV를 test와 비교해 분기하지 않는다 (#1427).',
  },
  {
    selector:
      "BinaryExpression[operator=/^(===|!==|==|!=)$/][left.value='test'][right.property.name='NODE_ENV']",
    message:
      '운영 코드는 지금 테스트 중인지 묻지 않는다 — NODE_ENV를 test와 비교해 분기하지 않는다 (#1427).',
  },
];

const collectionDelegateRestrictedSyntax = {
  selector: 'MemberExpression[property.name=/^canonical[A-Z]/]',
  message:
    'collection Prisma delegate(canonical*)는 collection 구현 밖에서 접근하지 않는다 (ADR-003 DEC-42).',
};

export default tseslint.config(
  eslint.configs.recommended,
  ...sharedConfig,
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ['src/**/*.ts'],
    plugins: { boundary: { rules: { 'module-zone': moduleZoneBoundary } } },
    rules: {
      'boundary/module-zone': ['error', moduleZoneBoundaryOptions],
    },
  },

  {
    files: ['src/**/*.ts'],
    ignores: testFileGlobs,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nestjs/testing',
              message:
                '운영 코드는 @nestjs/testing을 참조하지 않는다 — E2E 조립은 test/e2e-program-authoring/main.ts에서만 한다 (#1427).',
            },
          ],
          patterns: [
            {
              group: ['**/main'],
              message:
                'main.ts는 하단에서 bootstrap()을 실행한다 — 공유 로직은 부수효과 없는 파일로 옮기고 그 파일을 import한다.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['test/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/main'],
              message:
                'main.ts는 하단에서 bootstrap()을 실행한다 — 공유 로직은 부수효과 없는 파일로 옮기고 그 파일을 import한다.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...envRestrictedSyntax],
    },
  },

  {
    files: ['src/**/*.ts'],
    ignores: ['src/github/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...envRestrictedSyntax,
        collectionDelegateRestrictedSyntax,
      ],
    },
  },
  {
    files: ['src/runtime-config/runtime-config.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['src/**/*.spec.ts', 'test/**/*.ts', 'prisma/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['src/**/dto/*.ts'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: ['class', 'interface', 'typeAlias'],
          format: ['PascalCase'],
          custom: {
            regex: '^[A-Z][A-Za-z0-9]*(?:Request|Response)Dto$',
            match: true,
          },
        },
      ],
    },
  },
  {
    files: ['eslint.config.mjs', 'eslint.rails.mjs', 'eslint-rules/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: [
      'src/github/collection-sync.service.100-repositories.integration.spec.ts',
    ],
    rules: { '@typescript-eslint/unbound-method': 'off' },
  },
  {
    ignores: ['dist', 'node_modules'],
  },
);
