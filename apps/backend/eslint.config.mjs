import fs from 'node:fs';
import path from 'node:path';
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// ADR-003 — 각 기능 모듈의 domain·dto는 그 모듈의 내부 표현이며, 다른
// 모듈이 직접 참조하지 않는다. common·prisma는 모듈이 아니라 전 모듈이
// 공유하는 기반 계층이라 경계 대상에서 제외한다. moduleNames는 src의
// 실제 폴더를 읽어 생성하므로 새 모듈이 추가돼도 이 파일을 손대지
// 않아도 규칙이 자동으로 확장된다.
const srcDir = path.join(import.meta.dirname, 'src');
const sharedDirs = new Set(['common', 'prisma']);
const moduleNames = fs
  .readdirSync(srcDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !sharedDirs.has(entry.name))
  .map((entry) => entry.name);

const moduleBoundaryConfigs = moduleNames.flatMap((name) => {
  const restrictedGroups = moduleNames
    .filter((other) => other !== name)
    .flatMap((other) => [
      `../${other}/domain/*`,
      `../../${other}/domain/*`,
      `../${other}/dto/*`,
      `../../${other}/dto/*`,
    ]);

  if (restrictedGroups.length === 0) {
    return [];
  }

  return [
    {
      files: [`src/${name}/**/*.ts`],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: restrictedGroups,
                message:
                  '다른 모듈의 domain·dto는 module 경계 밖에서 직접 참조하지 않는다 (ADR-003).',
              },
            ],
          },
        ],
      },
    },
  ];
});

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
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
  ...moduleBoundaryConfigs,
  {
    ignores: ['eslint.config.mjs', 'dist', 'node_modules'],
  },
);
