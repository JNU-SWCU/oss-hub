import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ProgramApplyFormView,
  ProgramApplySuccessView,
} from './program-apply-page';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

const program: ProgramDetail = {
  id: 'program-1',
  name: '합성 프로그램',
  organizer: '합성 주관',
  category: 'BASIC',
  description: '설명',
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: '2026-07-31T23:59:59.000Z',
  },
  viewer: { role: 'STUDENT', applicationStatus: null },
  milestones: [],
};

const template: ApplicationFormTemplate = {
  key: 'basic',
  version: 1,
  name: '기본 신청서',
  participation: 'individual',
  fields: [
    {
      key: 'applicantName',
      type: 'auto',
      label: '신청자',
      required: true,
    },
    { key: 'title', type: 'text', label: '제목', required: true },
    { key: 'summary', type: 'textarea', label: '요약', required: true },
  ],
};

describe('ProgramApply views', () => {
  it('ready 상태에서 편집 가능한 제목·요약 필드를 렌더한다', () => {
    const html = renderToStaticMarkup(
      <ProgramApplyFormView
        program={program}
        template={template}
        applicantName="합성 학생"
        values={{ title: '', summary: '' }}
        errors={{}}
        serverError={null}
        submitting={false}
        onChange={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect(html).toContain('합성 프로그램 신청');
    expect(html).toContain('신청 제출');
    expect(html).toContain('name="title"');
    expect(html).toContain('name="summary"');
    expect(html).toContain('합성 학생');
    expect(html).not.toContain('TicketStub');
    expect(html).not.toContain('원본 양식 확정 후');
  });

  it('검증·서버 오류 상태를 표시한다', () => {
    const html = renderToStaticMarkup(
      <ProgramApplyFormView
        program={program}
        template={template}
        applicantName="합성 학생"
        values={{ title: '', summary: '' }}
        errors={{ title: '제목을 입력해 주세요.' }}
        serverError="이미 제출한 신청이 있습니다."
        submitting={false}
        onChange={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect(html).toContain('제목을 입력해 주세요.');
    expect(html).toContain('제출 실패');
    expect(html).toContain('이미 제출한 신청이 있습니다.');
  });

  it('성공 상태를 표시한다', () => {
    const html = renderToStaticMarkup(
      <ProgramApplySuccessView program={program} applicationId="app-1" />,
    );
    expect(html).toContain('신청이 접수되었습니다');
    expect(html).toContain('app-1');
    expect(html).toContain('/programs/program-1');
  });
});
