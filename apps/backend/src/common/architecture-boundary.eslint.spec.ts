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
      message.ruleId === 'no-restricted-imports' ||
      message.ruleId === 'no-restricted-syntax',
  );
}

describe('backend architecture boundary lint (ADR-003 DEC-42)', () => {
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

  describe('규칙 7 — 운영 코드는 테스트 코드를 참조하지 않는다 (#1427)', () => {
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
