import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormRenderer } from './form-renderer';
import { V1_APPLICATION_FIELDS } from './program-templates';
import type { ApplicationFormTemplate } from './types';

const template: ApplicationFormTemplate = {
  key: 'oss-contest',
  version: 1,
  name: 'OSS 경진대회 신청서',
  participation: 'team',
  fields: V1_APPLICATION_FIELDS,
};

describe('FormRenderer', () => {
  it('renders template metadata and v1 field inputs', () => {
    const html = renderToStaticMarkup(
      <FormRenderer
        template={template}
        mode="preview"
        values={{ applicantName: '합성 신청자' }}
      />,
    );

    expect(html).toContain('OSS 경진대회 신청서');
    expect(html).toContain('oss-contest v1');
    expect(html).toContain('팀형 신청');
    expect(html).toContain('신청자');
    expect(html).toContain('제목');
    expect(html).toContain('요약');
    expect(html).toContain('name="title"');
    expect(html).toContain('name="summary"');
    expect(html).toContain('name="applicantName"');
    expect(html).toContain('합성 신청자');
    expect(html).not.toContain('세부 신청 항목은 원본 양식 확정 후 제공됩니다.');
  });

  it('edit mode keeps auto fields read-only and enables text fields', () => {
    const html = renderToStaticMarkup(
      <FormRenderer
        template={template}
        mode="edit"
        values={{ title: '초안 제목', summary: '초안 요약' }}
      />,
    );

    expect(html).toContain('초안 제목');
    expect(html).toContain('초안 요약');
    expect(html).toContain('name="title"');
    // auto field remains non-editable (readOnly and/or disabled)
    expect(html).toMatch(/name="applicantName"[^>]*readOnly|readonly/i);
  });
});
