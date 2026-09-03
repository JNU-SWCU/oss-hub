import { describe, expect, it } from 'vitest';
import {
  PROGRAM_TEMPLATE_DEFINITIONS,
  resolveProgramApplicationTemplate,
} from './program-templates';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

const apiTemplates: readonly ApplicationFormTemplate[] = [
  {
    key: 'custom-basic',
    version: 2,
    name: 'API basic',
    participation: 'individual',
    fields: [],
  },
];

describe('resolveProgramApplicationTemplate', () => {
  it('matches by applicationTemplateKey only', () => {
    const program: Pick<ProgramDetail, 'applicationTemplateKey'> = {
      applicationTemplateKey: 'custom-basic',
    };

    expect(resolveProgramApplicationTemplate(program, apiTemplates)?.key).toBe(
      'custom-basic',
    );
  });

  it('falls back to local template definitions by key without category', () => {
    const program: Pick<ProgramDetail, 'applicationTemplateKey'> = {
      applicationTemplateKey: 'oss-contest',
    };

    expect(resolveProgramApplicationTemplate(program, [])?.key).toBe(
      'oss-contest',
    );
    expect(resolveProgramApplicationTemplate(program, [])?.participation).toBe(
      'team',
    );
  });

  it('returns null when the key is unknown', () => {
    const program: Pick<ProgramDetail, 'applicationTemplateKey'> = {
      applicationTemplateKey: 'missing-template',
    };

    expect(resolveProgramApplicationTemplate(program, apiTemplates)).toBeNull();
  });

  it('does not infer template from legacy category metadata', () => {
    expect(
      PROGRAM_TEMPLATE_DEFINITIONS.some(
        (definition) => definition.template.key === 'basic',
      ),
    ).toBe(true);
    expect(
      resolveProgramApplicationTemplate(
        { applicationTemplateKey: 'not-a-real-key' },
        [],
      ),
    ).toBeNull();
  });
});
