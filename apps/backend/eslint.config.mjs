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
  // 환경변수 소비 지점은 runtime-config manifest 하나로 고정한다. 키를 직접
  // 읽는 것만 금지하며, process.env 객체 전체를 loadRuntimeConfig에 넘기는
  // 것은 manifest가 키 목록을 소유하므로 허용한다. 이 규칙이 소비 계약을
  // 구조로 보장하므로 env 계약 검사기는 소스를 AST로 훑지 않는다.
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
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
      ],
    },
  },
  {
    // canonical 소비 지점. 여기서만 env.KEY를 직접 읽는다.
    files: ['src/runtime-config/runtime-config.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // 테스트는 환경을 직접 조립·복원해야 하므로 규칙 대상이 아니다.
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
    ignores: ['eslint.config.mjs', 'dist', 'node_modules'],
  },
);
