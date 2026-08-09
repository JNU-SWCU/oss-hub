import path from 'node:path';
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import moduleZoneBoundary from './eslint-rules/module-zone-boundary.mjs';

// ADR-003 — 각 기능 모듈의 domain·dto는 그 모듈의 내부 표현이며, 다른
// 모듈이 직접 참조하지 않는다. common·prisma는 모듈이 아니라 전 모듈이
// 공유하는 기반 계층이라 경계 대상에서 제외한다.
//
// 모듈 목록을 미리 읽지 않는다. 경계 판정은 lint 시점에 파일 경로에서
// zone(= `src` 아래 첫 세그먼트)을 뽑아 하므로, 새 모듈이 생기거나
// 폴더가 이동해도 이 파일을 손대지 않는다.
const srcDir = path.join(import.meta.dirname, 'src');
const sharedDirs = new Set(['common', 'prisma']);

// ADR-003 DEC-42 — github 모듈(옛 collection)의 공개 surface는 COLLECTION_READ_PORT
// 토큰·CollectionReadPort 인터페이스·DTO뿐이다.
//
// 예전에는 collection 폴더를 `readdirSync`로 스캔해 deny list를 만들었는데,
// 그러면 (1) 폴더를 옮기는 순간 설정 로드가 ENOENT로 죽고 (2) 상대경로 문자열
// 패턴이라 깊이 3 이상에서 조용히 무력화됐다. 지금은 **allowlist + 절대경로 판정**이라
// 폴더 위치와 중첩 깊이 어느 쪽에도 의존하지 않는다.
const collectionPublicFiles = [
  // 수집 쪽 공개 surface — DEC-42.
  'collection.module',
  'collection-read.port',
  // 프로비저닝 쪽 공개 surface.
  //
  // 합병 전 `repositories/` 는 캡슐화 대상이 아니었으므로 아래 파일들은 원래
  // 자유롭게 참조됐다. 순수 이동 PR 에서 규칙을 조이면 이동과 정책 변경이
  // 한 커밋에 섞이므로, 합병 전 계약을 그대로 보존한다.
  // 프로비저닝 surface 를 port 뒤로 좁히는 것은 별건이다(ADR-010 §7).
  'repositories.module',
  'repositories.service',
  'repositories.repository',
  'repositories-read.port',
  'repositories.integration-support',
  'github-app.client',
  'github-app.error',
];
const collectionPublicDirs = ['dto'];
// 계층 폴더(P20) 도입으로 공개 표면 일부가 zone 루트를 떠났다.
// 합병 전 계약을 유지하기 위해 경로 단위로 명시한다.
const collectionPublicPaths = [
  'service/repositories.service',
  'repository/repositories.repository',
];
const collectionInternalMessage =
  'github 모듈 밖에서는 COLLECTION_READ_PORT 토큰·CollectionReadPort·DTO만 참조한다 — concrete 구현 직접 import 금지 (ADR-003 DEC-42).';

// github(수집)은 데이터를 제공하는 쪽이며 소비자를 역참조하지 않는다.
const collectionConsumerZones = ['programs', 'ranking', 'system-status'];
const collectionReverseImportMessage =
  'github 구현은 소비자 모듈(programs/ranking/system-status)을 역참조하지 않는다 (ADR-003 DEC-42).';

// ADR-003 — controller는 Prisma에 직접 접근하지 않는다. Service/Repository만
// PrismaService를 주입받을 수 있다.
const controllerPrismaMessage =
  'controller는 Prisma에 직접 접근하지 않는다 — service를 거쳐 repository/port로 위임한다 (ADR-003).';

const moduleZoneBoundaryOptions = {
  srcRoot: srcDir,
  sharedZones: [...sharedDirs],
  internalDirs: ['domain', 'dto'],
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
    // 계층 리뷰 규칙 ① — Controller 가 Prisma 를 직접 부르지 않는다.
    {
      fileSuffix: '.controller.ts',
      denyPaths: ['prisma/prisma.service'],
      message: controllerPrismaMessage,
    },
    // 계층 리뷰 규칙 ③ — Service 에 Prisma query 가 직접 들어가지 않는다.
    //
    // 예외는 `github/` 안의 수집 서비스들이다. 이들은 아직 repository 계층으로
    // 흡수되지 않았고, 그 흡수는 이 이동 PR 의 범위가 아니다(파일 이동과 로직
    // 변경을 같은 PR 에 담지 않는다). 그래서 지금은 `programs`·`ranking` 에만 건다.
    {
      fileSuffix: '.service.ts',
      denyPaths: ['prisma/prisma.service'],
      zones: ['programs', 'ranking'],
      // 이미 위반 중인 둘. 이 목록은 **늘리지 않는다** — 줄이기만 한다.
      // 여기서 고치지 않는 이유는 파일 이동과 로직 변경을 같은 PR 에 담지 않기
      // 때문이며, repository 계층 흡수는 별건이다.
      knownDebt: [
        'programs/service/program-lifecycle.service.ts',
        'programs/service/student-dashboard.service.ts',
      ],
      message:
        'service 는 Prisma 를 직접 부르지 않는다 — repository 계층으로 위임한다 (ADR-010 §8).',
    },
  ],
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
  // 모듈 경계 — 상대경로 깊이와 무관하게 한 규칙이 전부 본다.
  // 예전에는 모듈마다 config를 만들고 `../x`·`../../x` 문자열로 막았는데,
  // 깊이 3 이상에서 조용히 통과했고 회귀 fixture도 깊이 1 고정이라 못 잡았다.
  {
    files: ['src/**/*.ts'],
    plugins: { boundary: { rules: { 'module-zone': moduleZoneBoundary } } },
    rules: {
      'boundary/module-zone': ['error', moduleZoneBoundaryOptions],
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
