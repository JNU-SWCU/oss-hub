import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'eslint/config';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import typescriptParser from '@typescript-eslint/parser';
import runtimeTestBoundary from './eslint-rules/runtime-test-boundary.mjs';
import designSystemRules from './eslint-rules/design-system.mjs';
import noComments from './eslint-rules/no-comments.mjs';

const featuresDir = path.join(import.meta.dirname, 'src/features');
const featureNames = fs.existsSync(featuresDir)
  ? fs
      .readdirSync(featuresDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];

const appReverseDependencyBan = {
  group: ['@/app', '@/app/**'],
  message:
    'features는 app에 의존할 수 없다 — 의존 방향은 app → features → lib 단방향이다 (docs/rules/frontend.md).',
};

const apiClientImportPaths = [
  {
    name: 'axios',
    message:
      'HTTP 요청은 lib/api-client.ts만 사용한다 (docs/rules/frontend.md).',
  },
  {
    name: 'ky',
    message:
      'HTTP 요청은 lib/api-client.ts만 사용한다 (docs/rules/frontend.md).',
  },
];

const featureBoundaryConfigs = featureNames.map((name) => {
  const otherFeatureGroups = featureNames
    .filter((other) => other !== name)
    .flatMap((other) => [`@/features/${other}`, `@/features/${other}/**`]);

  return {
    files: [`src/features/${name}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: apiClientImportPaths,
          patterns: [
            ...(otherFeatureGroups.length > 0
              ? [
                  {
                    group: otherFeatureGroups,
                    message:
                      'feature 간 직접 의존 금지 — 공용 계약은 명시적으로 추출한다 (docs/rules/frontend.md).',
                  },
                ]
              : []),
            appReverseDependencyBan,
          ],
        },
      ],
    },
  };
});

const libBoundaryConfig = {
  files: ['src/lib/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: apiClientImportPaths,
        patterns: [
          {
            group: ['@/features', '@/features/**'],
            message:
              'lib은 최하위 계층이다 — features에 의존할 수 없다 (docs/rules/frontend.md).',
          },
          appReverseDependencyBan,
        ],
      },
    ],
  },
};

const apiClientEntryConfig = {
  files: ['src/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': ['error', { paths: apiClientImportPaths }],
    'no-restricted-globals': [
      'error',
      {
        name: 'fetch',
        message:
          'fetch는 lib/api-client.ts에서만 사용한다 (docs/rules/frontend.md).',
      },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: 'Literal[value=/^\\/api\\/v1/]',
        message:
          "'/api/v1' 문자열은 lib/api-client.ts에서만 정의한다 (docs/rules/frontend.md).",
      },
    ],
  },
};

const apiClientFileExemption = {
  files: ['src/lib/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-globals': 'off',
    'no-restricted-syntax': 'off',
  },
};

const designSystemConfig = {
  files: [
    'src/components/**/*.{ts,tsx}',
    'src/features/**/*.{ts,tsx}',
    'src/app/**/*.{ts,tsx}',
  ],
  rules: {
    'local/design-class-name-length': 'error',
    'local/design-no-hex-color': 'error',
    'local/design-no-raw-button': 'error',
  },
};

const designSystemExemptions = [
  {
    files: [
      'src/components/program-cover.tsx',
      'src/features/auth/components/login-button.tsx',
      'src/features/profile/components/public-profile-view.tsx',
    ],
    rules: { '@next/next/no-img-element': 'off' },
  },
  {
    files: ['src/features/landing/cosmos/cosmos-theme.ts'],
    rules: { 'local/design-no-hex-color': 'off' },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: { 'local/design-no-raw-button': 'off' },
  },
];

export default defineConfig([
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    linterOptions: { noInlineConfig: true },
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      '@next/next': nextPlugin,
      local: {
        rules: {
          'runtime-test-boundary': runtimeTestBoundary,
          'no-comments': noComments,
          ...designSystemRules,
        },
      },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      'local/runtime-test-boundary': 'error',
      'local/no-comments': 'error',
    },
  },
  prettier,
  apiClientEntryConfig,
  ...featureBoundaryConfigs,
  libBoundaryConfig,
  apiClientFileExemption,
  designSystemConfig,
  ...designSystemExemptions,
  {
    ignores: [
      '.next/**',
      'coverage/**',
      'node_modules/**',
      'next-env.d.ts',
      'index.d.ts',
      'ds-types/**',
    ],
  },
]);
