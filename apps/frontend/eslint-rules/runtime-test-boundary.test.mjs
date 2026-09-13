import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import rule from './runtime-test-boundary.mjs';

const RULE_ID = 'local/runtime-test-boundary';
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function writeRel(root, relPath, contents) {
  const absPath = path.join(root, relPath);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, contents);
  return absPath;
}

async function createProject() {
  const root = await mkdtemp(path.join(tmpdir(), 'runtime-test-boundary-'));
  temporaryRoots.push(root);
  await writeRel(
    root,
    'package.json',
    `${JSON.stringify({ name: 'runtime-test-boundary-fixture', private: true })}\n`,
  );
  await writeRel(
    root,
    'tsconfig.json',
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2017',
          module: 'esnext',
          moduleResolution: 'bundler',
          jsx: 'preserve',
          strict: true,
          noEmit: true,
          baseUrl: '.',
          paths: { '@/*': ['./src/*'] },
        },
        include: [
          '**/*.ts',
          '**/*.tsx',
          '**/*.mts',
          '**/*.cts',
          '**/*.js',
          '**/*.mjs',
        ],
      },
      null,
      2,
    )}\n`,
  );
  await writeRel(root, 'src/lib/utils.ts', 'export const runtimeUtil = 1;\n');
  await writeRel(
    root,
    'src/lib/sample-data.ts',
    'export const sampleData = 1;\n',
  );
  await writeRel(
    root,
    'src/lib/mock-format.ts',
    'export const mockFormat = 1;\n',
  );
  await writeRel(
    root,
    'src/lib/seed-format.ts',
    'export const seedFormat = 1;\n',
  );
  await writeRel(
    root,
    'src/features/dashboard/fixtures.ts',
    'export const dashboardFixture = { id: "synthetic-dashboard" };\n',
  );
  await writeRel(
    root,
    'src/features/reviews/review-screen-test-support.tsx',
    'export function context() { return { id: "synthetic-review" }; }\n',
  );
  await writeRel(
    root,
    'src/app/_shell/zero-surface-member-test-support.ts',
    'export const ZERO_SURFACE_STAFF = { memberKind: "STAFF" };\n',
  );
  await writeRel(
    root,
    'src/features/programs/program-creation-test-fixtures.ts',
    'export const completedAuthoringState = { currentStep: "review" };\n',
  );
  await writeRel(
    root,
    'test-support/local-review/fixture-response.ts',
    'export function resolveLocalReviewResponse() { return { status: 200 }; }\n',
  );
  await writeRel(
    root,
    'test-support/local-review/handlers/account-handlers.ts',
    'export function resetLocalReviewRoleSelection() {}\n',
  );
  await writeRel(root, 'test-support/helper.ts', 'export const helper = 1;\n');
  await writeRel(root, 'test-support/legacy.ts', 'export const legacy = 1;\n');
  await writeRel(
    root,
    'test-support/indexed/index.ts',
    'export const indexed = 1;\n',
  );
  await writeRel(
    root,
    'src/__tests__/owned.ts',
    'export const testsOwned = 1;\n',
  );
  await writeRel(
    root,
    'src/__mocks__/owned.ts',
    'export const mocksOwned = 1;\n',
  );
  await writeRel(
    root,
    'src/features/programs/program.fixture.ts',
    'export const programFixture = 1;\n',
  );
  await writeRel(
    root,
    'src/lib/fixture-format.ts',
    'export const fixtureFormat = 1;\n',
  );
  await writeRel(
    root,
    'src/lib/test-support-ish.ts',
    'export const testSupportIsh = 1;\n',
  );
  await writeRel(root, 'src/e2e-notes.ts', 'export const e2eNotes = 1;\n');
  await writeRel(
    root,
    'e2e/environment.ts',
    'export const e2eEnvironment = { frontendPort: 3300 };\n',
  );
  await writeRel(
    root,
    'e2e/support/program-authoring-flow.ts',
    'export function expectCleanState() { return true; }\n',
  );
  return root;
}

async function lintRel(root, relPath, packageConfiguration = false) {
  const eslint = new ESLint({
    cwd: root,
    ignore: packageConfiguration,
    overrideConfigFile: packageConfiguration
      ? path.resolve(import.meta.dirname, '../eslint.config.mjs')
      : true,
    overrideConfig: packageConfiguration
      ? undefined
      : {
          files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
          languageOptions: {
            parser: typescriptParser,
            parserOptions: {
              ecmaFeatures: { jsx: true },
            },
          },
          plugins: {
            local: {
              rules: {
                'runtime-test-boundary': rule,
              },
            },
          },
          rules: {
            [RULE_ID]: 'error',
          },
        },
  });
  const results = await eslint.lintFiles([path.join(root, relPath)]);
  expect(results).toHaveLength(1);
  const messages = results.flatMap((result) => result.messages);
  for (const message of messages) {
    expect(message.ruleId).toBe(RULE_ID);
  }
  return messages;
}

describe('runtime-test-boundary', () => {
  it('rejects the retired local-review-api dynamic import of fixture-response', async () => {
    const root = await createProject();
    await writeRel(
      root,
      'src/app/local-review-api/[...path]/route.ts',
      `export async function GET() {
  const { resolveLocalReviewResponse } =
    await import('../../../../test-support/local-review/fixture-response');
  return resolveLocalReviewResponse();
}
`,
    );

    const messages = await lintRel(
      root,
      'src/app/local-review-api/[...path]/route.ts',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.messageId).toBe('runtimeImport');
    expect(messages[0]?.message).toContain(
      '../../../../test-support/local-review/fixture-response',
    );
    expect(messages[0]?.message).toContain(
      'test-support/local-review/fixture-response.ts',
    );
  });

  it('rejects the retired local-review activation dynamic import of account-handlers', async () => {
    const root = await createProject();
    await writeRel(
      root,
      'src/app/local-review/[fixture]/route.ts',
      `export async function GET() {
  const { resetLocalReviewRoleSelection } =
    await import('../../../../test-support/local-review/handlers/account-handlers');
  resetLocalReviewRoleSelection();
}
`,
    );

    const messages = await lintRel(
      root,
      'src/app/local-review/[fixture]/route.ts',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.messageId).toBe('runtimeImport');
  });

  it.each([
    {
      name: 'static import of test-support',
      file: 'src/lib/runtime-static.ts',
      source: `import { helper } from '../../test-support/helper';
export const value = helper;
`,
    },
    {
      name: 'named reexport of test-support',
      file: 'src/lib/runtime-reexport.ts',
      source: `export { helper } from '../../test-support/helper';
`,
    },
    {
      name: 'export-all of colocated fixtures.ts',
      file: 'src/features/dashboard/runtime-barrel.ts',
      source: `export * from './fixtures';
`,
    },
    {
      name: 'type-only import of fixtures.ts',
      file: 'src/features/dashboard/runtime-type.ts',
      source: `import type { dashboardFixture } from './fixtures';
export type Fixture = typeof dashboardFixture;
`,
    },
    {
      name: 'type-only reexport of review-screen-test-support',
      file: 'src/features/reviews/runtime-type-reexport.ts',
      source: `export type { context } from './review-screen-test-support';
`,
    },
    {
      name: 'no-substitution template dynamic import',
      file: 'src/app/runtime-template.ts',
      source: `export async function load() {
  return import(\`../../test-support/helper\`);
}
`,
    },
    {
      name: 'unshadowed require of test-support',
      file: 'src/lib/runtime-require.ts',
      source: `export const helper = require('../../test-support/helper');
`,
    },
    {
      name: 'TS import-equals require of test-support',
      file: 'src/lib/runtime-import-equals.ts',
      source: `import helper = require('../../test-support/helper');
export const value = helper;
`,
    },
    {
      name: 'alias to colocated *-test-support helper',
      file: 'src/lib/runtime-alias-support.ts',
      source: `import { context } from '@/features/reviews/review-screen-test-support';
export const value = context;
`,
    },
    {
      name: 'alias to zero-surface-member-test-support',
      file: 'src/lib/runtime-alias-shell.ts',
      source: `import { ZERO_SURFACE_STAFF } from '@/app/_shell/zero-surface-member-test-support';
export const value = ZERO_SURFACE_STAFF;
`,
    },
    {
      name: '.js specifier resolving to test-support TS',
      file: 'src/lib/runtime-js-ext.ts',
      source: `import { legacy } from '../../test-support/legacy.js';
export const value = legacy;
`,
    },
    {
      name: 'extensionless directory index in test-support',
      file: 'src/lib/runtime-index.ts',
      source: `import { indexed } from '../../test-support/indexed';
export const value = indexed;
`,
    },
    {
      name: 'deep relative import of test-support',
      file: 'src/a/b/c/d/runtime-deep.ts',
      source: `import { helper } from '../../../../../test-support/helper';
export const value = helper;
`,
    },
    {
      name: 'next.config.ts importing e2e',
      file: 'next.config.ts',
      source: `import { e2eEnvironment } from './e2e/environment';
const config = { env: e2eEnvironment };
export default config;
`,
    },
    {
      name: 'explicit *-test-fixtures helper from runtime',
      file: 'src/features/programs/runtime-authoring.ts',
      source: `import { completedAuthoringState } from './program-creation-test-fixtures';
export const value = completedAuthoringState;
`,
    },
    {
      name: '__tests__ root via relative import',
      file: 'src/lib/runtime-tests-root.ts',
      source: `import { testsOwned } from '../__tests__/owned';
export const value = testsOwned;
`,
    },
    {
      name: '__mocks__ root via relative import',
      file: 'src/lib/runtime-mocks-root.ts',
      source: `import { mocksOwned } from '../__mocks__/owned';
export const value = mocksOwned;
`,
    },
    {
      name: 'colocated *.fixture.ts from runtime',
      file: 'src/features/programs/runtime-fixture-file.ts',
      source: `import { programFixture } from './program.fixture';
export const value = programFixture;
`,
    },
    {
      name: 'other.config.ts is not an excluded importer',
      file: 'other.config.ts',
      source: `import { e2eEnvironment } from './e2e/environment';
export default { env: e2eEnvironment };
`,
    },
    {
      name: 'nested playwright.config.ts is not the exact runner exclusion',
      file: 'config/playwright.config.ts',
      source: `import { e2eEnvironment } from '../e2e/environment';
export default { use: e2eEnvironment };
`,
    },
  ])('rejects runtime $name', async ({ file, source }) => {
    const root = await createProject();
    await writeRel(root, file, source);
    const messages = await lintRel(root, file);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]?.messageId).toBe('runtimeImport');
  });

  it.each([
    {
      name: 'runtime importing runtime alias and sample/mock/seed filenames',
      file: 'src/lib/runtime-ok.ts',
      source: `import { runtimeUtil } from '@/lib/utils';
import { sampleData } from './sample-data';
import { mockFormat } from './mock-format';
import { seedFormat } from './seed-format';
export const value = runtimeUtil + sampleData + mockFormat + seedFormat;
`,
    },
    {
      name: 'runtime filename containing e2e/fixture words is not test-owned',
      file: 'src/lib/runtime-substring.ts',
      source: `import { fixtureFormat } from './fixture-format';
import { testSupportIsh } from './test-support-ish';
import { e2eNotes } from '../e2e-notes';
export const value = fixtureFormat + testSupportIsh + e2eNotes;
`,
    },
    {
      name: 'colocated test importing test-support',
      file: 'src/features/programs/milestone-document-upload-policy.test.ts',
      source: `import { helper } from '../../../test-support/helper';
export const value = helper;
`,
    },
    {
      name: 'colocated *-test-support helper importing runtime',
      file: 'src/features/reviews/review-screen-test-support.tsx',
      source: `import { runtimeUtil } from '@/lib/utils';
export function context() { return runtimeUtil; }
`,
    },
    {
      name: 'test importing colocated *-test-support',
      file: 'src/app/_shell/zero-surface-member-reach.test.tsx',
      source: `import { ZERO_SURFACE_STAFF } from './zero-surface-member-test-support';
export const value = ZERO_SURFACE_STAFF;
`,
    },
    {
      name: 'runtime-dir test importing e2e support',
      file: 'src/features/programs/program-authoring-e2e-fixture.test.ts',
      source: `import { expectCleanState } from '../../../e2e/support/program-authoring-flow';
export const value = expectCleanState();
`,
    },
    {
      name: 'playwright.config.ts importing e2e/environment',
      file: 'playwright.config.ts',
      source: `import { e2eEnvironment } from './e2e/environment';
export default { use: e2eEnvironment };
`,
    },
    {
      name: 'vitest.config.mts importing e2e/environment',
      file: 'vitest.config.mts',
      source: `import { e2eEnvironment } from './e2e/environment';
export default { env: e2eEnvironment };
`,
    },
    {
      name: 'test-support helper importing runtime fixtures.ts is still a test importer',
      file: 'test-support/local-review/fixture-response.ts',
      source: `import { dashboardFixture } from '@/features/dashboard/fixtures';
export function resolveLocalReviewResponse() { return dashboardFixture; }
`,
    },
    {
      name: 'computed dynamic import is not reported',
      file: 'src/lib/runtime-computed.ts',
      source: `export async function load(name: string) {
  return import(name);
}
`,
    },
    {
      name: 'substituted template dynamic import is not reported',
      file: 'src/lib/runtime-template-computed.ts',
      source: `export async function load(name: string) {
  return import(\`../../test-support/\${name}\`);
}
`,
    },
    {
      name: 'unresolved specifier is not reported as a test-owned hit',
      file: 'src/lib/runtime-missing.ts',
      source: `import { missing } from '../../test-support/does-not-exist';
export const value = missing;
`,
    },
    {
      name: 'shadowed require is not reported',
      file: 'src/lib/runtime-shadowed-require.ts',
      source: `function require(id: string) { return id; }
export const value = require('../../test-support/helper');
`,
    },
  ])('accepts $name', async ({ file, source }) => {
    const root = await createProject();
    await writeRel(root, file, source);
    const messages = await lintRel(root, file);
    expect(messages).toEqual([]);
  });

  it.each([
    {
      name: 'missing package configuration',
      config: null,
      error: /requires the package tsconfig\.json/,
    },
    {
      name: 'malformed package configuration',
      config: '{',
      error: /expected/,
    },
    {
      name: 'invalid compiler resolution option',
      config: JSON.stringify({
        compilerOptions: { moduleResolution: 'unsupported-resolution' },
      }),
      error: /moduleResolution/,
    },
  ])('fails explicitly for $name', async ({ config, error }) => {
    const root = await createProject();
    await writeRel(
      root,
      'src/runtime.ts',
      "import { helper } from '../test-support/helper';\n",
    );
    if (config === null) {
      await rm(path.join(root, 'tsconfig.json'));
    } else {
      await writeRel(root, 'tsconfig.json', config);
    }
    await expect(lintRel(root, 'src/runtime.ts')).rejects.toThrow(error);
  });
});

describe('actual frontend ESLint configuration', () => {
  it.each([
    {
      file: 'src/app/local-review-api/[...path]/route.ts',
      source:
        "export const GET = () => import('../../../../test-support/local-review/fixture-response');\n",
    },
    {
      file: 'src/lib/runtime-alias.ts',
      source: "export { testsOwned } from '@/__tests__/owned';\n",
    },
    {
      file: 'next.config.ts',
      source:
        "import { helper } from './test-support/helper';\nexport default { helper };\n",
    },
    ...['jsx', 'mts', 'cts'].map((extension) => ({
      file: `src/lib/runtime.${extension}`,
      source: "export { helper } from '../../test-support/helper';\n",
    })),
    {
      file: 'config/playwright.config.ts',
      source: "export { helper } from '../test-support/helper';\n",
    },
  ])('rejects the runtime edge in $file', async ({ file, source }) => {
    const root = await createProject();
    await writeRel(root, file, source);

    const messages = await lintRel(root, file, true);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.messageId).toBe('runtimeImport');
    expect(messages[0]?.severity).toBe(2);
  });

  it.each([
    {
      file: 'src/lib/runtime.test.ts',
      source: "export { helper } from '../../test-support/helper';\n",
    },
    {
      file: 'playwright.config.ts',
      source: "export { e2eEnvironment } from './e2e/environment';\n",
    },
    {
      file: 'src/lib/runtime.ts',
      source: "export { fixtureFormat } from './fixture-format';\n",
    },
  ])('permits the legitimate edge in $file', async ({ file, source }) => {
    const root = await createProject();
    await writeRel(root, file, source);

    expect(await lintRel(root, file, true)).toEqual([]);
  });
});
