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
    { key: 'applicantName', type: 'auto', label: '신청자', required: true },
    { key: 'title', type: 'text', label: '제목', required: true },
    { key: 'summary', type: 'textarea', label: '요약', required: true },
  ],
};

const handlers = {
  onChange: () => undefined,
  onTogglePublicationPlanned: () => undefined,
  onRequestSubmit: () => undefined,
  onRequestCancel: () => undefined,
  onCloseConfirmation: () => undefined,
  onConfirm: () => undefined,
} as const;

function renderForm(overrides: { readonly serverError?: string | null } = {}) {
  return renderToStaticMarkup(
    <ProgramApplyFormView
      program={program}
      template={template}
      applicantName="합성 학생"
      values={{
        title: '',
        summary: '',
        isRepositoryPublicationPlanned: true,
      }}
      errors={{}}
      serverError={overrides.serverError ?? null}
      mode="create"
      canCancel={false}
      confirmation={null}
      submitting={false}
      {...handlers}
    />,
  );
}

describe('ProgramApply views', () => {
  it('신청 정책과 편집 가능한 제목·요약 필드를 렌더한다', () => {
    const html = renderForm();

    expect(html).toContain('합성 프로그램 신청');
    expect(html).toContain('신청 제출');
    expect(html).toContain('신청 기간 내 ‘승인 대기’ 상태');
    expect(html).toContain('name="title"');
    expect(html).toContain('name="summary"');
    expect(html).toContain('합성 학생');
    expect(html).toContain('선정 시 저장소를 공개할 예정입니다');
  });

  it('제출 확인창에 승인 이후 제한 문구를 표시한다', () => {
    const html = renderToStaticMarkup(
      <ProgramApplyFormView
        program={program}
        template={template}
        applicantName="합성 학생"
        values={{
          title: '제목',
          summary: '요약',
          isRepositoryPublicationPlanned: true,
        }}
        errors={{}}
        serverError={null}
        mode="create"
        canCancel={false}
        confirmation="submit"
        submitting={false}
        {...handlers}
      />,
    );

    expect(html).toContain('신청서를 제출하시겠습니까?');
    expect(html).toContain('승인된 이후에는 수정 및 취소가 불가능합니다');
    expect(html).toContain('돌아가서 확인');
  });

  it('승인 대기 신청에는 수정과 신청 취소 동작을 표시한다', () => {
    const html = renderToStaticMarkup(
      <ProgramApplyFormView
        program={program}
        template={template}
        applicantName="합성 학생"
        values={{
          title: '기존 제목',
          summary: '기존 요약',
          isRepositoryPublicationPlanned: false,
        }}
        errors={{}}
        serverError={null}
        mode="edit"
        canCancel
        confirmation={null}
        submitting={false}
        {...handlers}
      />,
    );

    expect(html).toContain('수정 내용 저장');
    expect(html).toContain('신청 취소');
    expect(html).toContain('제출 시 선택한 저장소 공개 예정 여부');
    expect(html).toContain('disabled=""');
  });

  it('서버 오류 상태를 표시한다', () => {
    const html = renderForm({ serverError: '이미 판정된 신청입니다.' });

    expect(html).toContain('저장 실패');
    expect(html).toContain('이미 판정된 신청입니다.');
  });

  it('성공 상태를 표시한다', () => {
    const html = renderToStaticMarkup(
      <ProgramApplySuccessView program={program} applicationId="app-1" />,
    );
    expect(html).toContain('신청이 접수되었습니다');
    expect(html).toContain('app-1');
    expect(html).toContain('/dashboard');
  });
});
