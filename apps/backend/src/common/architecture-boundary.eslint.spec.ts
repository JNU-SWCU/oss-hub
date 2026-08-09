import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Linter } from 'eslint';

/**
 * ADR-003 DEC-42 — eslint.config.mjs가 강제하는 4가지 layered/collection 경계
 * 규칙을 실제 ESLint 설정(eslint.config.mjs)으로 검증한다. text grep이 아니라
 * ESLint Node API로 실제 파일을 실제 파서(AST)로 훑어 RED(위반 fixture가
 * 정확한 노드에서 실패)·GREEN(허용 패턴이 통과)·mutation(fixture를 살짝
 * 바꾸면 판정이 뒤집힘)을 함께 증명한다.
 *
 * fixture는 backend 루트(`{src,test,prisma}` 밖)가 아니라 실제 모듈 폴더
 * 안에 임시로 써야 glob(`src/<module>/**`)이 매치된다. 각 테스트가 파일을
 * 쓰고 lint한 뒤 즉시 지우므로 `pnpm lint`/`tsc`/`build`에는 절대 남지 않는다.
 *
 * Jest는 CJS/vm 샌드박스에서 실행되어 ESLint가 flat config(.mjs)를 로드할 때
 * 쓰는 동적 import()가 그 샌드박스 안에서는 실패한다
 * ("--experimental-vm-modules 없이 호출됐다"). 그래서 실제 lint 실행은
 * scripts/lint-fixture-runner.mjs를 평범한 Node 자식 프로세스로 띄워
 * 위임하고, 이 스펙은 결과 메시지만 JSON으로 받는다.
 */

const backendRoot = path.join(__dirname, '..', '..');
const runnerPath = path.join(backendRoot, 'scripts', 'lint-fixture-runner.mjs');
const writtenFiles = new Set<string>();

afterEach(() => {
  for (const absPath of writtenFiles) {
    fs.rmSync(absPath, { force: true });
  }
  writtenFiles.clear();
});

function writeFixture(relPath: string, content: string): void {
  const absPath = path.join(backendRoot, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf8');
  writtenFiles.add(absPath);
}

function lintFixture(relPath: string): Linter.LintMessage[] {
  const absPath = path.join(backendRoot, relPath);
  const stdout = execFileSync(
    process.execPath,
    [runnerPath, backendRoot, absPath],
    { encoding: 'utf8' },
  );
  return JSON.parse(stdout) as Linter.LintMessage[];
}

function boundaryMessages(
  messages: Linter.LintMessage[],
): Linter.LintMessage[] {
  return messages.filter(
    (message) =>
      message.ruleId === 'boundary/module-zone' ||
      message.ruleId === 'no-restricted-imports' ||
      message.ruleId === 'no-restricted-syntax',
  );
}

describe('backend architecture boundary lint (ADR-003 DEC-42)', () => {
  describe('규칙 1 — controller의 Prisma 직접 import 금지', () => {
    const redPath =
      'src/programs/__lint_fixture_red_controller_prisma.controller.ts';
    const redContent = `import { Controller } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('fixture')
export class LintFixtureRedControllerPrismaController {
  constructor(private readonly prisma: PrismaService) {}
}
`;

    it('RED: controller가 PrismaService를 직접 import하면 정확히 그 import 노드에서 실패한다', () => {
      // Given: programs 모듈의 controller가 PrismaService를 직접 주입받는다.
      writeFixture(redPath, redContent);

      // When: 실제 eslint.config.mjs로 lint한다.
      const messages = boundaryMessages(lintFixture(redPath));

      // Then: boundary/module-zone이 PrismaService import 줄(2행)에서 발화한다.
      expect(messages).toHaveLength(1);
      expect(messages[0]?.ruleId).toBe('boundary/module-zone');
      expect(messages[0]?.line).toBe(2);
      expect(messages[0]?.message).toContain(
        'controller는 Prisma에 직접 접근하지 않는다',
      );
    });

    it('mutation: 같은 import를 .service.ts로 옮기면(controller가 아니면) 위반이 사라진다', () => {
      // Given: 정확히 같은 PrismaService import를 service 파일로만 옮긴다.
      const mutatedPath =
        'src/github/__lint_fixture_red_controller_prisma.mutated.service.ts';
      const mutatedContent = redContent
        .replace("import { Controller } from '@nestjs/common';\n", '')
        .replace("@Controller('fixture')\n", '')
        .replace(
          'LintFixtureRedControllerPrismaController',
          'LintFixtureRedControllerPrismaService',
        );
      writeFixture(mutatedPath, mutatedContent);

      // When: 같은 규칙으로 lint한다.
      const messages = boundaryMessages(lintFixture(mutatedPath));

      // Then: 규칙이 "PrismaService import" 자체가 아니라 "controller 파일"이라는
      // 정확한 노드/파일 컨텍스트에서만 발화함을 증명한다.
      //
      // fixture 를 `github` zone 에 두는 이유: service 계층의 Prisma 직접 사용은
      // `programs`·`ranking` 에서 별도로 금지된다(ADR-010 §8). `github` 은 아직
      // 그 이관이 끝나지 않아 규칙 대상이 아니므로, 여기서는 controller 규칙만 남는다.
      expect(messages).toHaveLength(0);
    });

    it('GREEN: controller가 service를 DTO 계약으로 참조하면 통과한다', () => {
      // Given: controller가 Prisma가 아니라 같은 모듈의 service를 참조한다.
      writeFixture(
        'src/programs/__lint_fixture_green_service.ts',
        `export class LintFixtureGreenService {
  list(): string[] {
    return [];
  }
}
`,
      );
      const controllerPath =
        'src/programs/__lint_fixture_green_controller_service.controller.ts';
      writeFixture(
        controllerPath,
        `import { Controller, Get } from '@nestjs/common';
import { LintFixtureGreenService } from './__lint_fixture_green_service';

@Controller('fixture-green')
export class LintFixtureGreenControllerServiceController {
  constructor(private readonly service: LintFixtureGreenService) {}

  @Get()
  list(): string[] {
    return this.service.list();
  }
}
`,
      );

      // When: lint한다.
      const messages = boundaryMessages(lintFixture(controllerPath));

      // Then: controller→service DTO 경계는 위반이 없다.
      expect(messages).toHaveLength(0);
    });
  });

  describe('규칙 2 — collection concrete 구현의 모듈 외부 import 금지', () => {
    const redPath = 'src/ranking/__lint_fixture_red_collection_internal.ts';
    const redContent = `import { CollectionReadService } from '../github/service/collection-read.service';

export function useFixture(service: CollectionReadService): CollectionReadService {
  return service;
}
`;

    it('RED: collection 밖에서 CollectionReadService(concrete)를 직접 import하면 그 import 노드에서 실패한다', () => {
      // Given: ranking(소비자)이 collection의 concrete 구현을 직접 import한다.
      writeFixture(redPath, redContent);

      // When: lint한다.
      const messages = boundaryMessages(lintFixture(redPath));

      // Then: boundary/module-zone이 1행(import 선언)에서 발화한다.
      expect(messages).toHaveLength(1);
      expect(messages[0]?.ruleId).toBe('boundary/module-zone');
      expect(messages[0]?.line).toBe(1);
      expect(messages[0]?.message).toContain('COLLECTION_READ_PORT');
    });

    it('mutation: 같은 자리에서 concrete 대신 port를 import하면 위반이 사라진다', () => {
      // Given: 동일 파일에서 import 대상만 concrete → port로 바꾼다.
      const mutatedPath =
        'src/ranking/__lint_fixture_red_collection_internal.mutated.ts';
      const mutatedContent = `import type { CollectionReadPort } from '../github/collection-read.port';

export function useFixture(service: CollectionReadPort): CollectionReadPort {
  return service;
}
`;
      writeFixture(mutatedPath, mutatedContent);

      // When: lint한다.
      const messages = boundaryMessages(lintFixture(mutatedPath));

      // Then: 허용된 public surface(port)는 통과 — 규칙이 "collection을 참조한다"가
      // 아니라 "concrete 구현을 참조한다"라는 정확한 import 대상에서만 발화함을 증명한다.
      expect(messages).toHaveLength(0);
    });

    it('GREEN: service→repository DTO 경계(같은 모듈 내부)는 통과한다', () => {
      // Given: 같은 모듈 안에서 persistence DTO만 오가는 service/repository 쌍.
      writeFixture(
        'src/ranking/__lint_fixture_green_repository.ts',
        `export interface LintFixtureRankingRow {
  readonly id: string;
}

export class LintFixtureGreenRepository {
  findAll(): LintFixtureRankingRow[] {
    return [];
  }
}
`,
      );
      const servicePath =
        'src/ranking/__lint_fixture_green_service_repository.ts';
      writeFixture(
        servicePath,
        `import { LintFixtureGreenRepository } from './__lint_fixture_green_repository';

export class LintFixtureGreenServiceRepositoryConsumer {
  constructor(private readonly repository: LintFixtureGreenRepository) {}

  list(): unknown {
    return this.repository.findAll();
  }
}
`,
      );

      // When: lint한다.
      const messages = boundaryMessages(lintFixture(servicePath));

      // Then: 위반 없음.
      expect(messages).toHaveLength(0);
    });

    it('GREEN: cross-module port injection(COLLECTION_READ_PORT 토큰)은 통과한다', () => {
      // Given: 실제 ranking.service.ts와 동일한 패턴으로 port token을 주입받는다.
      const portPath = 'src/ranking/__lint_fixture_green_port_injection.ts';
      writeFixture(
        portPath,
        `import { Inject, Injectable } from '@nestjs/common';
import {
  COLLECTION_READ_PORT,
  type CollectionReadPort,
} from '../github/collection-read.port';

@Injectable()
export class LintFixtureGreenPortInjectionService {
  constructor(
    @Inject(COLLECTION_READ_PORT)
    private readonly collection: CollectionReadPort,
  ) {}
}
`,
      );

      // When: lint한다.
      const messages = boundaryMessages(lintFixture(portPath));

      // Then: 토큰+인터페이스는 허용 surface이므로 위반 없음.
      expect(messages).toHaveLength(0);
    });
  });

  describe('규칙 3 — collection Prisma delegate(canonical*)의 구현 밖 접근 금지', () => {
    const redPath = 'src/ranking/__lint_fixture_red_delegate.ts';
    const redContent = `import { PrismaService } from '../prisma/prisma.service';

export async function useFixture(prisma: PrismaService): Promise<unknown> {
  return prisma.canonicalOrganizationState.findMany();
}
`;

    it('RED: collection 밖에서 canonical* delegate에 직접 접근하면 그 MemberExpression 노드에서 실패한다', () => {
      // Given: ranking이 CollectionReadPort를 거치지 않고 canonical delegate를 직접 만진다.
      writeFixture(redPath, redContent);

      // When: lint한다.
      const messages = boundaryMessages(lintFixture(redPath));

      // Then: no-restricted-syntax가 4행(prisma.canonicalOrganizationState)에서 발화한다.
      expect(messages).toHaveLength(1);
      expect(messages[0]?.ruleId).toBe('no-restricted-syntax');
      expect(messages[0]?.line).toBe(4);
      expect(messages[0]?.message).toContain('collection Prisma delegate');
    });

    it('mutation: 같은 자리에서 canonical delegate 대신 평범한 delegate(user)를 쓰면 위반이 사라진다', () => {
      // Given: 속성 이름만 canonicalOrganizationState → user로 바꾼다.
      const mutatedPath = 'src/ranking/__lint_fixture_red_delegate.mutated.ts';
      const mutatedContent = redContent.replace(
        'prisma.canonicalOrganizationState',
        'prisma.user',
      );
      writeFixture(mutatedPath, mutatedContent);

      // When: lint한다.
      const messages = boundaryMessages(lintFixture(mutatedPath));

      // Then: 셀렉터가 "prisma 사용" 전체가 아니라 canonical*/collectionRun/
      // githubRawObservation이라는 정확한 property 이름에서만 발화함을 증명한다.
      expect(messages).toHaveLength(0);
    });

    it('GREEN: collection 구현 내부에서는 canonical* delegate 접근이 허용된다', () => {
      // Given: collection 폴더 안(구현부)에 동일한 delegate 접근을 둔다.
      const insidePath =
        'src/github/__lint_fixture_green_delegate_inside.ts';
      writeFixture(
        insidePath,
        `import { PrismaService } from '../prisma/prisma.service';

export async function useFixture(prisma: PrismaService): Promise<unknown> {
  return prisma.canonicalOrganizationState.findMany();
}
`,
      );

      // When: lint한다.
      const messages = boundaryMessages(lintFixture(insidePath));

      // Then: collection 구현 내부는 예외이므로 위반 없음.
      expect(messages).toHaveLength(0);
    });
  });

  describe('규칙 4 — collection → consumer(programs/ranking/system-status) 역방향 import 금지', () => {
    const redPath = 'src/github/__lint_fixture_red_reverse_import.ts';
    const redContent = `import { ProgramsService } from '../programs/service/programs.service';

export function useFixture(service: ProgramsService): ProgramsService {
  return service;
}
`;

    it('RED: collection 구현이 programs를 역참조하면 그 import 노드에서 실패한다', () => {
      // Given: collection이 소비자 모듈(programs)을 거꾸로 import한다.
      writeFixture(redPath, redContent);

      // When: lint한다.
      const messages = boundaryMessages(lintFixture(redPath));

      // Then: boundary/module-zone이 1행에서 발화한다.
      expect(messages).toHaveLength(1);
      expect(messages[0]?.ruleId).toBe('boundary/module-zone');
      expect(messages[0]?.line).toBe(1);
      expect(messages[0]?.message).toContain('소비자 모듈');
    });

    it('mutation: 같은 collection 파일에서 실제로 의존하는 auth 모듈을 import하면 위반이 사라진다', () => {
      // Given: collection이 실제로 의존하는 공유 모듈(auth)을 import하도록 바꾼다.
      const mutatedPath =
        'src/github/__lint_fixture_red_reverse_import.mutated.ts';
      const mutatedContent = `import { AuthModule } from '../auth/auth.module';

export function useFixture(): typeof AuthModule {
  return AuthModule;
}
`;
      writeFixture(mutatedPath, mutatedContent);

      // When: lint한다.
      const messages = boundaryMessages(lintFixture(mutatedPath));

      // Then: 규칙이 "다른 모듈 import 전체"가 아니라 programs/ranking/system-status라는
      // 정확한 소비자 모듈 목록에서만 발화함을 증명한다.
      expect(messages).toHaveLength(0);
    });
  });

  // 이 저장소가 실제로 겪은 실패 모드를 고정한다.
  //
  // 예전 경계는 `../other/domain/*`·`../../other/domain/*` 같은 상대경로 문자열이었다.
  // 그래서 깊이 3 이상(`src/a/b/c/file.ts`)에서는 `../../../other/...`가 패턴에
  // 매치되지 않아 **규칙이 조용히 통과했다.** 회귀 fixture도 깊이 1에 고정돼
  // 있었으므로 테스트는 GREEN인 채로 경계만 사라지는 상태였다.
  //
  // 계층 폴더 도입(`controller/`·`service/`·`repository/`)은 파일을 정확히 그
  // 깊이로 밀어넣는 작업이므로, 이 커버리지가 없으면 이동과 동시에 경계가 증발한다.
  describe('규칙 5 — 경계는 상대경로 깊이에 의존하지 않는다', () => {
    const cases = [
      { depth: 1, dir: 'src/ranking', up: '..' },
      { depth: 2, dir: 'src/ranking/service', up: '../..' },
      { depth: 3, dir: 'src/ranking/service/internal', up: '../../..' },
    ] as const;

    for (const { depth, dir, up } of cases) {
      it(`RED: 깊이 ${depth}에서 다른 모듈의 domain을 참조하면 실패한다`, () => {
        // Given: 같은 위반을 서로 다른 중첩 깊이에 놓는다.
        const relPath = `${dir}/__lint_fixture_depth${depth}_domain.ts`;
        writeFixture(
          relPath,
          `import type { ProgramStatus } from '${up}/programs/domain/program-status';

export type Fixture = ProgramStatus;
`,
        );

        // When: lint한다.
        const messages = boundaryMessages(lintFixture(relPath));

        // Then: 깊이와 무관하게 같은 규칙이 같은 자리에서 발화한다.
        expect(messages).toHaveLength(1);
        expect(messages[0]?.ruleId).toBe('boundary/module-zone');
        expect(messages[0]?.line).toBe(1);
        expect(messages[0]?.message).toContain('domain');
      });

      it(`RED: 깊이 ${depth}에서 collection concrete 구현을 참조하면 실패한다`, () => {
        // Given: 캡슐화 위반도 같은 깊이 축으로 검사한다.
        const relPath = `${dir}/__lint_fixture_depth${depth}_collection.ts`;
        writeFixture(
          relPath,
          `import type { CollectionReadService } from '${up}/github/collection-read.service';

export type Fixture = CollectionReadService;
`,
        );

        // When: lint한다.
        const messages = boundaryMessages(lintFixture(relPath));

        // Then: 공개 surface allowlist 밖이므로 깊이와 무관하게 막힌다.
        expect(messages).toHaveLength(1);
        expect(messages[0]?.ruleId).toBe('boundary/module-zone');
        expect(messages[0]?.message).toContain('COLLECTION_READ_PORT');
      });

      it(`mutation: 깊이 ${depth}에서 port로 바꾸면 위반이 사라진다`, () => {
        // Given: 같은 자리에서 대상만 concrete → port로 바꾼다.
        const relPath = `${dir}/__lint_fixture_depth${depth}_collection.mutated.ts`;
        writeFixture(
          relPath,
          `import type { CollectionReadPort } from '${up}/github/collection-read.port';

export type Fixture = CollectionReadPort;
`,
        );

        // When: lint한다.
        const messages = boundaryMessages(lintFixture(relPath));

        // Then: 규칙이 "깊은 경로 전부"가 아니라 캡슐화 경계에서만 발화함을 증명한다.
        expect(messages).toHaveLength(0);
      });
    }
  });
});
