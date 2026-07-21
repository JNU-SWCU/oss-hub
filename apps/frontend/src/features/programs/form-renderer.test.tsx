import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormRenderer } from './form-renderer';
import type { ApplicationFormTemplate } from './types';

const template: ApplicationFormTemplate = {
  key: 'oss-contest',
  version: 1,
  name: 'OSS 경진대회 신청서',
  participation: 'team',
  fields: [
    {
      key: 'projectName',
      label: '프로젝트명',
      inputType: 'text',
      required: true,
    },
    {
      key: 'repositoryUrl',
      label: '저장소 URL',
      inputType: 'url',
      required: false,
    },
  ],
};

describe('FormRenderer', () => {
  it('renders the locked template fields as a read-only preview', () => {
    const html = renderToStaticMarkup(<FormRenderer template={template} />);

    expect(html).toContain('OSS 경진대회 신청서');
    expect(html).toContain('프로젝트명');
    expect(html).toContain('텍스트');
    expect(html).toContain('필수');
    expect(html).toContain('저장소 URL');
    expect(html).toContain('선택');
    expect(html).toContain('팀형 신청');
  });
});
