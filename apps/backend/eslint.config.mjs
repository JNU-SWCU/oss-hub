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

// ADR-003 DEC-42 — collection 모듈의 공개 surface는 COLLECTION_READ_PORT
// 토큰·CollectionReadPort 인터페이스·DTO뿐이다. concrete 구현(서비스·repository·
// client·guard·scheduler·controller 등)은 collection 폴더를 스캔해 자동으로
// deny list를 만들므로, 새 내부 파일이 추가돼도 이 파일을 손대지 않아도 된다.
const collectionDir = path.join(srcDir, 'collection');
const collectionPublicFiles = new Set([
  'collection.module',
  'collection-read.port',
]);
const collectionPublicDirs = new Set(['dto']);
const collectionInternalSpecifiers = fs
  .readdirSync(collectionDir, { withFileTypes: true })
  .flatMap((entry) => {
    if (entry.isDirectory()) {
      return collectionPublicDirs.has(entry.name) ? [] : [`${entry.name}/*`];
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) {
      return [];
    }
    const base = entry.name.slice(0, -'.ts'.length);
    return collectionPublicFiles.has(base) ? [] : [base];
  });
const collectionInternalGroups = collectionInternalSpecifiers.flatMap(
  (name) => [`../collection/${name}`, `../../collection/${name}`],
);
const collectionInternalMessage =
  'collection 모듈 밖에서는 COLLECTION_READ_PORT 토큰·CollectionReadPort·DTO만 참조한다 — concrete 구현 직접 import 금지 (ADR-003 DEC-42).';

// collection은 데이터를 제공하는 쪽이며 소비자(programs/ranking/system-status)를
// 역참조하지 않는다. auth 등 collection이 실제로 의존하는 공유 모듈은 이 목록에
// 없으므로 영향받지 않는다.
const collectionConsumerModuleNames = ['programs', 'ranking', 'system-status'];
const collectionReverseImportGroups = collectionConsumerModuleNames.flatMap(
  (other) => [
    `../${other}`,
    `../${other}/*`,
    `../../${other}`,
    `../../${other}/*`,
  ],
);
const collectionReverseImportMessage =
  'collection 구현은 소비자 모듈(programs/ranking/system-status)을 역참조하지 않는다 (ADR-003 DEC-42).';

// ADR-003 — controller는 Prisma에 직접 접근하지 않는다. Service/Repository만
// PrismaService를 주입받을 수 있다.
const controllerPrismaImportPattern = {
  group: ['../prisma/prisma.service', '../../prisma/prisma.service'],
  message:
    'controller는 Prisma에 직접 접근하지 않는다 — service를 거쳐 repository/port로 위임한다 (ADR-003).',
};

const moduleBoundaryConfigs = moduleNames.flatMap((name) => {
  const domainDtoGroups = moduleNames
    .filter((other) => other !== name)
    .flatMap((other) => [
      `../${other}/domain/*`,
      `../../${other}/domain/*`,
      `../${other}/dto/*`,
      `../../${other}/dto/*`,
    ]);

  const basePatterns = [];
  if (domainDtoGroups.length > 0) {
    basePatterns.push({
      group: domainDtoGroups,
      message:
        '다른 모듈의 domain·dto는 module 경계 밖에서 직접 참조하지 않는다 (ADR-003).',
    });
  }
  if (name !== 'collection' && collectionInternalGroups.length > 0) {
    basePatterns.push({
      group: collectionInternalGroups,
      message: collectionInternalMessage,
    });
  }
  if (name === 'collection' && collectionReverseImportGroups.length > 0) {
    basePatterns.push({
      group: collectionReverseImportGroups,
      message: collectionReverseImportMessage,
    });
  }

  // 두 파일셋(controller/그 외)으로 나눠 서로 겹치지 않게 한다. flat config는
  // 같은 파일에 매치되는 여러 config의 같은 rule을 병합하지 않고 마지막
  // 것으로 덮어쓰므로, 겹치는 files를 만들면 안 된다.
  const configs = [];
  if (basePatterns.length > 0) {
    configs.push({
      files: [`src/${name}/**/*.ts`],
      ignores: [`src/${name}/**/*.controller.ts`],
      rules: {
        'no-restricted-imports': ['error', { patterns: basePatterns }],
      },
    });
  }
  configs.push({
    files: [`src/${name}/**/*.controller.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...basePatterns, controllerPrismaImportPattern] },
      ],
    },
  });

  return configs;
});

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
];

// ADR-003 DEC-42 — canonical* 계열과 legacy inert 테이블(collectionRun,
// githubRawObservation)은 collection 구현만 만질 수 있는 Prisma delegate다.
// 속성 이름만 보는 AST 셀렉터라 어떤 변수명(prisma/this.prisma/db 등)으로
// 접근하든 잡아낸다.
const collectionDelegateRestrictedSyntax = {
  selector:
    'MemberExpression[property.name=/^(canonical[A-Z]|collectionRun|githubRawObservation)/]',
  message:
    'collection Prisma delegate(canonical*/collectionRun/githubRawObservation)는 collection 구현 밖에서 접근하지 않는다 — CollectionReadPort로만 조회한다 (ADR-003 DEC-42).',
};

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
  // collection 폴더 밖(common·prisma·app.module.ts 등, moduleBoundaryConfigs가
  // 다루지 않는 위치)에서도 collection concrete 구현을 직접 참조할 수 없다.
  {
    files: ['src/*.ts', 'src/common/**/*.ts', 'src/prisma/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns:
            collectionInternalGroups.length > 0
              ? [
                  {
                    group: collectionInternalGroups,
                    message: collectionInternalMessage,
                  },
                ]
              : [],
        },
      ],
    },
  },
  // 환경변수 소비 지점은 runtime-config manifest 하나로 고정한다. 키를 직접
  // 읽는 것만 금지하며, process.env 객체 전체를 loadRuntimeConfig에 넘기는
  // 것은 manifest가 키 목록을 소유하므로 허용한다. 이 규칙이 소비 계약을
  // 구조로 보장하므로 env 계약 검사기는 소스를 AST로 훑지 않는다.
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...envRestrictedSyntax],
    },
  },
  // collection 구현 밖에서는 canonical*/collectionRun/githubRawObservation
  // Prisma delegate를 직접 만질 수 없다 — CollectionReadPort로만 조회한다
  // (ADR-003 DEC-42). collection 폴더는 제외되므로(config 병합 규칙상 이 config가
  // collection 파일에는 매치되지 않아 위 env 규칙만 남는다) 구현 내부에서는
  // 그대로 delegate를 쓸 수 있다.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/collection/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...envRestrictedSyntax,
        collectionDelegateRestrictedSyntax,
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
