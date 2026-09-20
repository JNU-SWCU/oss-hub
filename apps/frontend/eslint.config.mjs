import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'eslint/config';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import typescriptParser from '@typescript-eslint/parser';
import runtimeTestBoundary from './eslint-rules/runtime-test-boundary.mjs';
import designSystemRules from './eslint-rules/design-system.mjs';

// docs/rules/frontend.md — 의존 방향은 app → features → lib 단방향이며,
// feature는 다른 feature의 내부 경로에 직접 의존하지 않는다.
// featureNames는 src/features의 실제 폴더를 읽어 생성하므로 새 feature가
// 추가돼도 이 파일을 손대지 않고 규칙이 자동으로 확장된다.
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

// docs/rules/frontend.md — HTTP 요청은 반드시 lib/api-client.ts를 거친다.
// axios·ky 등 별도 HTTP 클라이언트의 신규 도입을 어디서든 차단한다.
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

// 위 두 블록 밖의 파일(src/app/** 등)에도 axios·ky 금지가 적용되도록
// src 전역에 한 번 더 건다. no-restricted-globals·no-restricted-syntax는
// lib/api-client.ts 전용 예외를 아래에서 별도로 끈다.
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

// api-client.ts와 그 테스트는 /api/v1·fetch 자체를 검증 대상으로 삼으므로
// lib 전체를 예외로 둔다 — 그 밖의 lib 파일은 여전히 features 의존 금지가 적용된다.
const apiClientFileExemption = {
  files: ['src/lib/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-globals': 'off',
    'no-restricted-syntax': 'off',
  },
};

// docs/design.md R-08a·R-08b·R-38 — 디자인 시스템 규칙을 lint로 강제한다(#1310).
// 범위는 규칙문대로 src/{components,features,app}. 기존 위반은 eslint-suppressions.json이
// 파일·규칙 단위로 억제하고 새 위반만 막는다. 억제된 위반을 고치면 `pnpm lint:prune`.
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
    // R-08b 규칙문의 예외 — canvas 전용 테마 상수
    files: ['src/features/landing/cosmos/cosmos-theme.ts'],
    rules: { 'local/design-no-hex-color': 'off' },
  },
  {
    // 프리미티브 소유자만 <button>을 직접 쓴다
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: { 'local/design-no-raw-button': 'off' },
  },
];

export default defineConfig([
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
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
          ...designSystemRules,
        },
      },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      'local/runtime-test-boundary': 'error',
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
    ignores: ['.next/**', 'coverage/**', 'node_modules/**'],
  },
]);
