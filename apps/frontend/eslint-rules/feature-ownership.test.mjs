import { describe, expect, it } from 'vitest';
import { Linter } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import rule from './feature-ownership.mjs';

function lint(
  code,
  filename = '/synthetic/src/features/programs/teams/screen.ts',
) {
  return new Linter({ cwd: '/synthetic' }).verify(
    code,
    [
      {
        files: ['**/*.ts'],
        languageOptions: { parser: typescriptParser },
        plugins: { local: { rules: { ownership: rule } } },
        rules: { 'local/ownership': 'error' },
      },
    ],
    { filename },
  );
}

describe('program and role ownership boundaries', () => {
  it.each([
    "import { value } from '@/features/programs/catalog/api';",
    "import type { ProgramDetail } from '../catalog/dto';",
    "import { value } from './internal-model';",
    "import { value } from '../program-contract';",
  ])('accepts established entries and same-owner modules: %s', (code) => {
    expect(lint(code)).toEqual([]);
  });

  it.each([
    "import { value } from '@/features/programs/catalog/private-state';",
    "import { value } from '../catalog/private-state';",
    "import type { Value } from '../catalog/private-state';",
    "export { value } from '../catalog/private-state';",
    "export * from '../catalog/private-state';",
    "void import('../catalog/private-state');",
    "require('../catalog/private-state');",
  ])('rejects internal cross-owner paths: %s', (code) => {
    expect(lint(code).map((message) => message.ruleId)).toEqual([
      'local/ownership',
    ]);
  });

  it('resolves relative imports from nested components', () => {
    expect(
      lint(
        "import { value } from '../../catalog/private-state';",
        '/synthetic/src/features/programs/teams/components/panel.ts',
      ),
    ).toEqual([expect.objectContaining({ ruleId: 'local/ownership' })]);
  });

  it('keeps onboarding independent from access administration', () => {
    expect(
      lint(
        "import { value } from '../access-administration/admin-access-api';",
        '/synthetic/src/features/roles/onboarding/api.ts',
      ),
    ).toEqual([expect.objectContaining({ ruleId: 'local/ownership' })]);
  });

  it('allows test-owned compositions without weakening runtime imports', () => {
    expect(
      lint(
        "import { value } from '../catalog/private-state';",
        '/synthetic/src/features/programs/teams/screen.test.ts',
      ),
    ).toEqual([]);
  });
});
