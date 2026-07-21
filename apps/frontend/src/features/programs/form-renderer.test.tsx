import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormRenderer } from './form-renderer';
import type { ApplicationFormTemplate } from './types';

const template: ApplicationFormTemplate = {
  key: 'oss-contest',
  version: 1,
  name: 'OSS 경진대회 신청서',
  participation: 'team',
};

describe('FormRenderer', () => {
  it('renders only the server-owned template metadata', () => {
    const html = renderToStaticMarkup(<FormRenderer template={template} />);

    expect(html).toContain('OSS 경진대회 신청서');
    expect(html).toContain('oss-contest v1');
    expect(html).toContain('팀형 신청');
    expect(html).toContain('세부 신청 항목은 원본 양식 확정 후 제공됩니다.');
  });
});
