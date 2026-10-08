import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Linter } from 'eslint';

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
      writeFixture(redPath, redContent);

      const messages = boundaryMessages(lintFixture(redPath));

      expect(messages).toHaveLength(1);
      expect(messages[0]?.ruleId).toBe('boundary/module-zone');
      expect(messages[0]?.line).toBe(2);
      expect(messages[0]?.message).toContain(
        'controller는 Prisma에 직접 접근하지 않는다',
      );
    });

    it('mutation: 같은 import를 .service.ts로 옮기면(controller가 아니면) 위반이 사라진다', () => {
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

      const messages = boundaryMessages(lintFixture(mutatedPath));

      expect(messages).toHaveLength(0);
    });

    it('GREEN: controller가 service를 DTO 계약으로 참조하면 통과한다', () => {
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

      const messages = boundaryMessages(lintFixture(controllerPath));

      expect(messages).toHaveLength(0);
    });
  });

  describe('규칙 2 — collection concrete 구현의 모듈 외부 import 금지', () => {
    const redPath =
      'src/ranking/service/__lint_fixture_red_collection_internal.service.ts';
    const redContent = `import { CollectionReadService } from '../../github/service/collection-read.service';

export function useFixture(service: CollectionReadService): CollectionReadService {
  return service;
}
`;

    it('RED: ranking 또는 programs SERVICE가 github/service/collection-read.service를 import하면 실패한다', () => {
      writeFixture(redPath, redContent);

      const messages = boundaryMessages(lintFixture(redPath));

      expect(messages).toHaveLength(1);
      expect(messages[0]?.ruleId).toBe('boundary/module-zone');
      expect(messages[0]?.line).toBe(1);
      expect(messages[0]?.message).toContain('concrete repository');
      expect(messages[0]?.message).not.toContain('COLLECTION_READ_PORT');
    });

    it('mutation: collection-read.port 또는 github repository를 service에서 import해도 실패한다', () => {
      const mutatedPath =
        'src/ranking/service/__lint_fixture_red_collection_internal.mutated.service.ts';
      const mutatedContent = `import { PublicRankingRepository } from '../../github/repository/public-ranking.repository';

export function useFixture(
  repository: PublicRankingRepository,
): PublicRankingRepository {
  return repository;
}
`;
      writeFixture(mutatedPath, mutatedContent);

      const messages = boundaryMessages(lintFixture(mutatedPath));

      expect(messages).toHaveLength(1);
      expect(messages[0]?.ruleId).toBe('boundary/module-zone');
      expect(messages[0]?.message).toContain('concrete repository');
    });

    it('GREEN: 소비자 Service는 자기 repository를 쓴다', () => {
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

      const messages = boundaryMessages(lintFixture(servicePath));

      expect(messages).toHaveLength(0);
    });

    it('GREEN: 소비자 Repository는 PrismaService를 import해도 된다', () => {
      const repositoryPath =
        'src/ranking/repository/__lint_fixture_green_prisma.repository.ts';
      writeFixture(
        repositoryPath,
        `import { PrismaService } from '../../prisma/prisma.service';

export class LintFixtureGreenRankingRepository {
  constructor(private readonly prisma: PrismaService) {}
}
`,
      );

      const messages = boundaryMessages(lintFixture(repositoryPath));

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
      writeFixture(redPath, redContent);

      const messages = boundaryMessages(lintFixture(redPath));

      expect(messages).toHaveLength(1);
      expect(messages[0]?.ruleId).toBe('no-restricted-syntax');
      expect(messages[0]?.line).toBe(4);
      expect(messages[0]?.message).toContain('collection Prisma delegate');
    });

    it('mutation: 같은 자리에서 canonical delegate 대신 평범한 delegate(user)를 쓰면 위반이 사라진다', () => {
      const mutatedPath = 'src/ranking/__lint_fixture_red_delegate.mutated.ts';
      const mutatedContent = redContent.replace(
        'prisma.canonicalOrganizationState',
        'prisma.user',
      );
      writeFixture(mutatedPath, mutatedContent);

      const messages = boundaryMessages(lintFixture(mutatedPath));

      expect(messages).toHaveLength(0);
    });

    it('GREEN: collection 구현 내부에서는 canonical* delegate 접근이 허용된다', () => {
      const insidePath = 'src/github/__lint_fixture_green_delegate_inside.ts';
      writeFixture(
        insidePath,
        `import { PrismaService } from '../prisma/prisma.service';

export async function useFixture(prisma: PrismaService): Promise<unknown> {
  return prisma.canonicalOrganizationState.findMany();
}
`,
      );

      const messages = boundaryMessages(lintFixture(insidePath));

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
      writeFixture(redPath, redContent);

      const messages = boundaryMessages(lintFixture(redPath));

      expect(messages).toHaveLength(1);
      expect(messages[0]?.ruleId).toBe('boundary/module-zone');
      expect(messages[0]?.line).toBe(1);
      expect(messages[0]?.message).toContain('소비자 모듈');
    });

    it('mutation: 같은 collection 파일에서 실제로 의존하는 auth 모듈을 import하면 위반이 사라진다', () => {
      const mutatedPath =
        'src/github/__lint_fixture_red_reverse_import.mutated.ts';
      const mutatedContent = `import { AuthModule } from '../auth/auth.module';

export function useFixture(): typeof AuthModule {
  return AuthModule;
}
`;
      writeFixture(mutatedPath, mutatedContent);

      const messages = boundaryMessages(lintFixture(mutatedPath));

      expect(messages).toHaveLength(0);
    });
  });

  describe('규칙 5 — 경계는 상대경로 깊이에 의존하지 않는다', () => {
    const cases = [
      { depth: 1, dir: 'src/ranking', up: '..' },
      { depth: 2, dir: 'src/ranking/service', up: '../..' },
      { depth: 3, dir: 'src/ranking/service/internal', up: '../../..' },
    ] as const;

    for (const { depth, dir, up } of cases) {
      it(`RED: 깊이 ${depth}에서 다른 모듈의 dto를 참조하면 실패한다`, () => {
        const relPath = `${dir}/__lint_fixture_depth${depth}_dto.ts`;
        writeFixture(
          relPath,
          `import type { ProgramDetailDto } from '${up}/programs/dto/program-detail.dto';

export type Fixture = ProgramDetailDto;
`,
        );

        const messages = boundaryMessages(lintFixture(relPath));

        expect(messages).toHaveLength(1);
        expect(messages[0]?.ruleId).toBe('boundary/module-zone');
        expect(messages[0]?.line).toBe(1);
        expect(messages[0]?.message).toContain('dto');
      });

      it(`깊이 ${depth}에서 다른 모듈의 domain 참조는 허용한다`, () => {
        const relPath = `${dir}/__lint_fixture_depth${depth}_domain.ts`;
        writeFixture(
          relPath,
          `import type { ProgramStatus } from '${up}/programs/domain/program-status';

export type Fixture = ProgramStatus;
`,
        );

        expect(boundaryMessages(lintFixture(relPath))).toHaveLength(0);
      });

      it(`RED: 깊이 ${depth}에서 collection concrete 구현을 참조하면 실패한다`, () => {
        const relPath = `${dir}/__lint_fixture_depth${depth}_collection.ts`;
        writeFixture(
          relPath,
          `import type { CollectionReadService } from '${up}/github/collection-read.service';

export type Fixture = CollectionReadService;
`,
        );

        const messages = boundaryMessages(lintFixture(relPath));

        expect(messages).toHaveLength(1);
        expect(messages[0]?.ruleId).toBe('boundary/module-zone');
        expect(messages[0]?.message).toContain('concrete repository');
        expect(messages[0]?.message).not.toContain('COLLECTION_READ_PORT');
      });

      it(`mutation: 깊이 ${depth}에서 github repository를 service가 import해도 실패한다`, () => {
        const relPath = `${dir}/__lint_fixture_depth${depth}_collection.mutated.ts`;
        writeFixture(
          relPath,
          `import { PublicRankingRepository } from '${up}/github/repository/public-ranking.repository';

export type Fixture = PublicRankingRepository;
`,
        );

        const messages = boundaryMessages(lintFixture(relPath));

        expect(messages).toHaveLength(1);
        expect(messages[0]?.ruleId).toBe('boundary/module-zone');
        expect(messages[0]?.message).toContain('concrete repository');
      });

      it(`GREEN: 깊이 ${depth}에서 공개 surface(collection-schedule)는 통과한다`, () => {
        const relPath = `${dir}/__lint_fixture_depth${depth}_collection.allowed.ts`;
        writeFixture(
          relPath,
          `import { nextScheduledCollectionAt } from '${up}/github/collection-schedule';

export const fixture = nextScheduledCollectionAt;
`,
        );

        const messages = boundaryMessages(lintFixture(relPath));

        expect(messages).toHaveLength(0);
      });
    }
  });

  describe('규칙 6 — provision 이벤트 순수 계약만 공개, 구현은 비공개', () => {
    it('GREEN: 생산자 Repository가 repository-provision-event 순수 계약을 import하면 통과한다', () => {
      const relPath =
        'src/programs/repository/__lint_fixture_provision_event.allowed.repository.ts';
      writeFixture(
        relPath,
        `import { repositoryAccessSyncEventData } from '../../github/repository-provision-event';

export const fixture = repositoryAccessSyncEventData;
`,
      );

      const messages = boundaryMessages(lintFixture(relPath));

      expect(messages).toHaveLength(0);
    });

    it('RED: 같은 생산자가 이 이벤트를 쓰는 github concrete repository를 import하면 여전히 막힌다', () => {
      const relPath =
        'src/programs/repository/__lint_fixture_provision_event.concrete.repository.ts';
      writeFixture(
        relPath,
        `import { RepositoryProvisionStateRepository } from '../../github/repository/repository-provision-state.repository';

export type Fixture = RepositoryProvisionStateRepository;
`,
      );

      const messages = boundaryMessages(lintFixture(relPath));

      expect(messages).toHaveLength(1);
      expect(messages[0]?.ruleId).toBe('boundary/module-zone');
      expect(messages[0]?.line).toBe(1);
      expect(messages[0]?.message).toContain('concrete repository');
    });

    it('RED: 이벤트를 소비하는 github 내부 구현(outbox consumer)은 계속 비공개다', () => {
      const relPath =
        'src/programs/repository/__lint_fixture_provision_event.consumer.repository.ts';
      writeFixture(
        relPath,
        `import { RepositoryOutboxConsumer } from '../../github/repository-outbox.consumer';

export type Fixture = RepositoryOutboxConsumer;
`,
      );

      const messages = boundaryMessages(lintFixture(relPath));

      expect(messages).toHaveLength(1);
      expect(messages[0]?.ruleId).toBe('boundary/module-zone');
      expect(messages[0]?.line).toBe(1);
      expect(messages[0]?.message).toContain('concrete repository');
    });
  });

  describe('규칙 7 — 운영 코드는 테스트 코드를 참조하지 않는다 (#1427)', () => {
    describe('a. boundary/module-zone testBoundary — apps/backend/test/** import 금지', () => {
      it('RED: 운영 파일이 apps/backend/test/e2e-program-authoring을 import하면 그 import 노드에서 실패한다', () => {
        const redPath = 'src/programs/__lint_fixture_red_test_boundary.ts';
        writeFixture(
          redPath,
          `import { e2eProgramAuthoringExternalPorts } from '../../test/e2e-program-authoring/e2e-external-ports';

export const fixture = e2eProgramAuthoringExternalPorts;
`,
        );

        const messages = boundaryMessages(lintFixture(redPath));

        expect(messages).toHaveLength(1);
        expect(messages[0]?.ruleId).toBe('boundary/module-zone');
        expect(messages[0]?.line).toBe(1);
        expect(messages[0]?.message).toContain('테스트 코드를 참조하지 않는다');
      });

      it('GREEN: 테스트 파일(.spec.ts) 자신이 같은 경로를 import하면 면제된다', () => {
        const greenPath =
          'src/programs/__lint_fixture_green_test_boundary.spec.ts';
        writeFixture(
          greenPath,
          `import { e2eProgramAuthoringExternalPorts } from '../../test/e2e-program-authoring/e2e-external-ports';

describe('fixture', () => {
  it('imports the e2e port', () => {
    expect(e2eProgramAuthoringExternalPorts).toBeDefined();
  });
});
`,
        );

        const messages = boundaryMessages(lintFixture(greenPath));

        expect(messages).toHaveLength(0);
      });
    });

    describe('b. no-restricted-imports — @nestjs/testing 금지', () => {
      it('RED: 운영 파일이 @nestjs/testing을 import하면 실패한다', () => {
        const redPath = 'src/programs/__lint_fixture_red_nestjs_testing.ts';
        writeFixture(
          redPath,
          `import { Test } from '@nestjs/testing';

export const fixture = Test;
`,
        );

        const messages = boundaryMessages(lintFixture(redPath));

        expect(messages).toHaveLength(1);
        expect(messages[0]?.ruleId).toBe('no-restricted-imports');
        expect(messages[0]?.line).toBe(1);
        expect(messages[0]?.message).toContain('@nestjs/testing');
      });

      it('GREEN: 테스트 파일(.spec.ts)은 @nestjs/testing을 import해도 된다', () => {
        const greenPath =
          'src/programs/__lint_fixture_green_nestjs_testing.spec.ts';
        writeFixture(
          greenPath,
          `import { Test } from '@nestjs/testing';

describe('fixture', () => {
  it('uses Test', () => {
    expect(Test).toBeDefined();
  });
});
`,
        );

        const messages = boundaryMessages(lintFixture(greenPath));

        expect(messages).toHaveLength(0);
      });
    });

    describe("c. no-restricted-syntax — NODE_ENV를 'test'와 비교하는 분기 금지", () => {
      it("RED: 운영 파일이 NODE_ENV를 'test'와 비교하면 그 BinaryExpression에서 실패한다", () => {
        const redPath = 'src/programs/__lint_fixture_red_node_env_test.ts';
        writeFixture(
          redPath,
          `export function useFixture(config: { NODE_ENV: string }): boolean {
  return config.NODE_ENV === 'test';
}
`,
        );

        const messages = boundaryMessages(lintFixture(redPath));

        expect(messages).toHaveLength(1);
        expect(messages[0]?.ruleId).toBe('no-restricted-syntax');
        expect(messages[0]?.line).toBe(2);
        expect(messages[0]?.message).toContain('NODE_ENV');
      });

      it("GREEN: 테스트 파일(.spec.ts)은 NODE_ENV를 'test'와 비교해도 된다", () => {
        const greenPath =
          'src/programs/__lint_fixture_green_node_env_test.spec.ts';
        writeFixture(
          greenPath,
          `describe('fixture', () => {
  it('compares NODE_ENV', () => {
    const config = { NODE_ENV: 'test' };
    expect(config.NODE_ENV === 'test').toBe(true);
  });
});
`,
        );

        const messages = boundaryMessages(lintFixture(greenPath));

        expect(messages).toHaveLength(0);
      });
    });
  });
});
