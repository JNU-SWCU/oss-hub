import { ProgramCategory } from '@prisma/client';
import {
  getProgramTemplate,
  getTemplateByKey,
  listProgramTemplates,
  V1_APPLICATION_FIELDS,
} from './program-template.registry';

describe('program-template.registry', () => {
  it('7종 템플릿이 동일 v1 fields를 공유한다', () => {
    const templates = listProgramTemplates();

    expect(templates).toHaveLength(7);
    for (const template of templates) {
      expect(template.version).toBe(1);
      expect(template.fields).toEqual(V1_APPLICATION_FIELDS);
      expect(template.fields.map((field) => field.key)).toEqual([
        'applicantName',
        'title',
        'summary',
      ]);
    }
  });

  it('카테고리·key로 조회하고 한국어 name을 가진다', () => {
    const byCategory = getProgramTemplate(ProgramCategory.BASIC);
    const byKey = getTemplateByKey('basic');

    expect(byCategory).toEqual(byKey);
    expect(byCategory.name).toBe('기본 신청서');
    expect(getTemplateByKey('missing')).toBeUndefined();
    expect(getProgramTemplate(ProgramCategory.OSS_CONTEST).name).toBe(
      'OSS경진대회 신청서',
    );
    expect(getProgramTemplate(ProgramCategory.OSS_CONTEST).participation).toBe(
      'TEAM',
    );
  });

  it('auto 신청자 필드는 required 표시다', () => {
    const applicant = V1_APPLICATION_FIELDS.find(
      (field) => field.key === 'applicantName',
    );

    expect(applicant).toEqual({
      key: 'applicantName',
      type: 'auto',
      label: '신청자',
      required: true,
    });
  });
});
