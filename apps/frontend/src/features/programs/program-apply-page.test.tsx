import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  BlockedView,
  ProgramApplyFormView,
  ProgramApplySuccessView,
} from './program-apply-views';
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
  onRepositoryModeChange: () => undefined,
  onToggleConsent: () => undefined,
  onRequestSubmit: () => undefined,
  onRequestCancel: () => undefined,
  onCloseConfirmation: () => undefined,
  onConfirm: () => undefined,
} as const;

const baseValues = {
  title: '',
  summary: '',
  isRepositoryPublicationPlanned: true,
  repositoryConnectionMode: 'new',
  repositoryUrl: '',
  personalDataConsent: false,
} as const;

function renderForm(overrides: { readonly serverError?: string | null } = {}) {
  return renderToStaticMarkup(
    <ProgramApplyFormView
      program={program}
      template={template}
      applicantName="합성 학생"
      githubHandle="synthetic-student"
      values={baseValues}
      errors={{}}
      serverError={overrides.serverError ?? null}
      mode="create"
      canManage={false}
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

  it('새 신청서 작성에서 GitHub 계정 연동 안내와 저장소 연결 방식·동의 체크박스를 표시한다', () => {
    const html = renderForm();

    expect(html).toContain('@synthetic-student');
    expect(html).toContain('계정에 연결된 GitHub');
    expect(html).toContain('새 저장소를 만들어 받습니다');
    expect(html).toContain('이미 쓰던 저장소를 연결합니다');
    expect(html).toContain('개인정보 수집·이용 동의');
    expect(html).toContain('약관 보기');
  });

  it('저장소를 직접 연결하면 URL 입력을 함께 보여준다', () => {
    const html = renderToStaticMarkup(
      <ProgramApplyFormView
        program={program}
        template={template}
        applicantName="합성 학생"
        githubHandle="synthetic-student"
        values={{ ...baseValues, repositoryConnectionMode: 'own' }}
        errors={{}}
        serverError={null}
        mode="create"
        canManage={false}
        confirmation={null}
        submitting={false}
        {...handlers}
      />,
    );

    expect(html).toContain('https://github.com/team/repo');
  });

  it('팀형 프로그램은 팀 구성 섹션에 팀 이름·팀원을 표시한다', () => {
    const teamTemplate: ApplicationFormTemplate = {
      ...template,
      participation: 'team',
    };
    const html = renderToStaticMarkup(
      <ProgramApplyFormView
        program={program}
        template={teamTemplate}
        applicantName="합성 학생"
        githubHandle="synthetic-student"
        team={{
          id: 'team-1',
          name: '합성 팀',
          memberCount: 2,
          minMembers: 2,
          maxMembers: 4,
          locked: false,
          isLeader: true,
          members: [
            {
              userId: 'user-1',
              nickname: 'leader-nick',
              name: '팀장',
              isLeader: true,
            },
            {
              userId: 'user-2',
              nickname: 'member-nick',
              name: null,
              isLeader: false,
            },
          ],
        }}
        values={baseValues}
        errors={{}}
        serverError={null}
        mode="create"
        canManage={false}
        confirmation={null}
        submitting={false}
        {...handlers}
      />,
    );

    expect(html).toContain('합성 팀');
    expect(html).toContain('@leader-nick');
    expect(html).toContain('@member-nick');
    expect(html).toContain('/programs/program-1/teams');
  });

  it('저장소 URL·동의 오류를 공통 배너로 표시한다', () => {
    const html = renderToStaticMarkup(
      <ProgramApplyFormView
        program={program}
        template={template}
        applicantName="합성 학생"
        githubHandle="synthetic-student"
        values={baseValues}
        errors={{
          personalDataConsent:
            '개인정보 수집·이용에 동의해야 지원할 수 있습니다.',
        }}
        serverError={null}
        mode="create"
        canManage={false}
        confirmation={null}
        submitting={false}
        {...handlers}
      />,
    );

    expect(html).toContain('개인정보 수집·이용에 동의해야 지원할 수 있습니다.');
  });

  it('수정 화면에는 저장소 연결·동의 섹션을 다시 보여주지 않는다', () => {
    const html = renderToStaticMarkup(
      <ProgramApplyFormView
        program={program}
        template={template}
        applicantName="합성 학생"
        githubHandle="synthetic-student"
        values={{ ...baseValues, title: '기존 제목', summary: '기존 요약' }}
        errors={{}}
        serverError={null}
        mode="edit"
        canManage
        confirmation={null}
        submitting={false}
        {...handlers}
      />,
    );

    expect(html).not.toContain('새 저장소를 만들어 받습니다');
    expect(html).not.toContain('개인정보 수집·이용 동의');
  });

  it('제출 확인창에 승인 이후 제한 문구를 표시한다', () => {
    const html = renderToStaticMarkup(
      <ProgramApplyFormView
        program={program}
        template={template}
        applicantName="합성 학생"
        values={{
          ...baseValues,
          title: '제목',
          summary: '요약',
          personalDataConsent: true,
        }}
        errors={{}}
        serverError={null}
        mode="create"
        canManage={false}
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
          ...baseValues,
          title: '기존 제목',
          summary: '기존 요약',
          isRepositoryPublicationPlanned: false,
        }}
        errors={{}}
        serverError={null}
        mode="edit"
        canManage
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

  it('team-required blocked state keeps detail CTA and shows team setup CTA', () => {
    const html = renderToStaticMarkup(
      <BlockedView reason="team-required" program={program} />,
    );

    expect(html).toContain('/programs/program-1');
    expect(html).toContain('/programs/program-1/teams');
    expect(html).toContain('팀 구성으로 이동');
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
