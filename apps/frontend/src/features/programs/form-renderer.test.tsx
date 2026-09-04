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
    expect(html).toContain('신청자');
    expect(html).toContain('요약');
    expect(html).toContain('name="summary"');
    expect(html).toContain('name="applicantName"');
    expect(html).toContain('합성 신청자');
    expect(html).not.toContain(
      '세부 신청 항목은 원본 양식 확정 후 제공됩니다.',
    );
  });

  it('summary 입력칸이 길이 상한을 실제로 걸어 둔다', () => {
    const key = 'summary' as const;
    // ⚠ 상수만 맞는지 보면 부족하다 — 화면이 그 상수를 **쓰는지**를 봐야 한다.
    const html = renderToStaticMarkup(
      <FormRenderer template={template} mode="edit" values={{}} />,
    );

    // 그 칸의 태그 안에 상한이 들어 있다.
    const tag = html
      .split('<')
      .find((chunk) => chunk.includes(`name="${key}"`));
    expect(tag).toBeDefined();
    expect(tag).toContain(`maxLength="${APPLICATION_ANSWER_MAX_LENGTHS[key]}"`);
  });

  it('상한이 없는 칸에는 maxLength 를 붙이지 않는다', () => {
    // 0 이나 빈 값이 붙으면 아무것도 못 치게 된다.
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
        values={{ title: '초안 제목', summary: '초안 요약' }}
      />,
    );

    expect(html).toContain('초안 요약');
    // auto field remains non-editable (readOnly and/or disabled)
    expect(html).toMatch(/name="applicantName"[^>]*readOnly|readonly/i);
  });
});
