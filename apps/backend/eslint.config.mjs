import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { sharedConfig } from '../../eslint.shared.mjs';

const testFileGlobs = [
  'src/**/*.spec.ts',
  'src/**/*fixture.ts',
  'src/**/*fixtures.ts',
  'src/**/*support.ts',
];

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
