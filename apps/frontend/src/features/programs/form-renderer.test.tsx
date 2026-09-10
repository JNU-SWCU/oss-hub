import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { APPLICATION_ANSWER_MAX_LENGTHS } from './application-answer-limits';
import { FormRenderer } from './form-renderer';
import { V1_APPLICATION_FIELDS } from './program-templates';
import type { ApplicationFormTemplate } from './types';

const template: ApplicationFormTemplate = {
  key: 'oss-contest',
  version: 1,
  name: 'OSS 경진대회 신청서',
  participation: 'team',
  fields: V1_APPLICATION_FIELDS,
} as const;

const textareaTemplate: ApplicationFormTemplate = {
  key: 'custom-notes',
  version: 3,
  name: '메모 양식',
  participation: 'individual',
  fields: [
    {
      key: 'notes' as ApplicationFormTemplate['fields'][number]['key'],
      type: 'textarea',
      label: '메모',
      required: false,
    },
  ],
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
    expect(html).toContain('팀 신청');
    expect(html).toContain('aria-label="OSS 경진대회 신청서 템플릿 미리보기"');
    expect(html).toContain('신청자');
    expect(html).toContain('name="applicantName"');
    expect(html).toContain('합성 신청자');
    expect(html).not.toContain('name="summary"');
    expect(html).not.toContain('aria-label="신청 정보"');
    expect(html).not.toContain(
      '세부 신청 항목은 원본 양식 확정 후 제공됩니다.',
    );
  });

  it('showMetadata=false 는 템플릿 메타를 숨기고 신청 정보 섹션만 남긴다', () => {
    const html = renderToStaticMarkup(
      <FormRenderer
        template={template}
        mode="edit"
        showMetadata={false}
        values={{ applicantName: '합성 신청자' }}
      />,
    );

    expect(html).toContain('aria-label="신청 정보"');
    expect(html).toContain('신청자');
    expect(html).toContain('name="applicantName"');
    expect(html).toContain('합성 신청자');
    expect(html).not.toContain('OSS 경진대회 신청서');
    expect(html).not.toContain('oss-contest v1');
    expect(html).not.toContain('팀 신청');
    expect(html).not.toContain('템플릿 미리보기');
  });

  it('textarea 입력칸은 값과 이름을 렌더하고 상한이 없으면 maxLength 를 붙이지 않는다', () => {
    const html = renderToStaticMarkup(
      <FormRenderer
        template={textareaTemplate}
        mode="edit"
        values={{ notes: '초안 메모' }}
      />,
    );

    expect(html).toContain('메모');
    expect(html).toContain('초안 메모');
    const tag = html.split('<').find((chunk) => chunk.includes('name="notes"'));
    expect(tag).toBeDefined();
    expect(tag).not.toMatch(/maxlength/i);
  });
  it('textarea 입력칸이 길이 상한을 실제로 걸어 둔다', () => {
    const key = 'title' as const;
    const html = renderToStaticMarkup(
      <FormRenderer
        template={{
          ...textareaTemplate,
          fields: [
            {
              key,
              type: 'textarea',
              label: '메모',
              required: false,
            },
          ],
        }}
        mode="edit"
        values={{}}
      />,
    );

    const tag = html
      .split('<')
      .find((chunk) => chunk.includes(`name="${key}"`));
    expect(tag).toBeDefined();
    expect(tag).toContain(`maxLength="${APPLICATION_ANSWER_MAX_LENGTHS[key]}"`);
  });

  it('상한이 없는 칸에는 maxLength 를 붙이지 않는다', () => {
    const html = renderToStaticMarkup(
      <FormRenderer template={template} mode="edit" values={{}} />,
    );
    const tag = html
      .split('<')
      .find((chunk) => chunk.includes('name="applicantName"'));
    expect(tag).toBeDefined();
    expect(tag).not.toMatch(/maxlength/i);
  });

  it('edit mode keeps auto fields read-only and enables text fields', () => {
    const html = renderToStaticMarkup(
      <FormRenderer
        template={template}
        mode="edit"
        values={{ applicantName: '합성 신청자' }}
      />,
    );

    expect(html).toContain('합성 신청자');
    expect(html).toMatch(/name="applicantName"[^>]*readOnly|readonly/i);
  });
});
