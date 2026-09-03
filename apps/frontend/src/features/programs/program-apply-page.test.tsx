import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  BlockedView,
  ProgramApplyFormView,
  ProgramApplySuccessView,
} from './program-apply-views';
import type { StudentApplication } from './student-application-api';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

const program: ProgramDetail = {
  id: 'program-1',
  name: '합성 프로그램',
  organizer: '합성 주관',
  trackType: 'EXTRACURRICULAR',

  applicationTemplateKey: 'basic',
  lifecycle: 'PUBLISHED',
  description: '설명',
  repositoryProvisioningEnabled: true,
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

/** 반려된 내 신청서. 사유 말고는 표시에 영향을 주지 않는 값들로 채운다. */
function rejectedApplication(
  rejectionReason: string | null,
): StudentApplication {
  return {
    id: 'application-1',
    programId: program.id,
    status: 'REJECTED',
    teamId: null,
    answers: { applicantName: '합성 학생', title: '제목', summary: '요약' },
    submittedAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    isRepositoryPublicationPlanned: false,
    rejectionReason,
    isManager: true,
    canManage: false,
    canEdit: false,
    canCancel: false,
  };
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
    expect(html).toContain('새 저장소 발급받기');
    expect(html).toContain('내 저장소 연결하기');
    expect(html).toContain('외부 저장소는 공개 저장소만 연결');
    expect(html).toContain('개인정보 수집·이용 동의');
    expect(html).toContain('약관 보기');
  });

  it('저장소 발급을 사용하지 않는 프로그램에서는 연결 방식을 표시하지 않는다', () => {
    const html = renderToStaticMarkup(
      <ProgramApplyFormView
        program={{ ...program, repositoryProvisioningEnabled: false }}
        template={template}
        applicantName="합성 학생"
        githubHandle="synthetic-student"
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

    expect(html).not.toContain('새 저장소 발급받기');
    expect(html).not.toContain('내 저장소 연결하기');
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
    expect(html).toContain(
      'GitHub에 공개(Public)로 연동된 저장소만 연결할 수 있습니다.',
    );
  });

  // #9 QA econovation 배치 — 제출 시점 URL 사전 검증 실패를 필드 오류로 보여준다.
  it('저장소 URL 사전 검증 실패를 배너로 표시한다', () => {
    const html = renderToStaticMarkup(
      <ProgramApplyFormView
        program={program}
        template={template}
        applicantName="합성 학생"
        githubHandle="synthetic-student"
        values={{ ...baseValues, repositoryConnectionMode: 'own' }}
        errors={{
          repositoryUrl:
            '연결하려는 저장소를 찾을 수 없거나 비공개 저장소입니다. GitHub에 공개된 저장소만 연결할 수 있습니다.',
        }}
        serverError={null}
        mode="create"
        canManage={false}
        confirmation={null}
        submitting={false}
        {...handlers}
      />,
    );

    expect(html).toContain(
      '연결하려는 저장소를 찾을 수 없거나 비공개 저장소입니다. GitHub에 공개된 저장소만 연결할 수 있습니다.',
    );
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

    expect(html).not.toContain('새 저장소 발급받기');
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
    const html = renderForm({
      serverError: '이미 승인되거나 반려된 신청입니다.',
    });

    expect(html).toContain('저장 실패');
    expect(html).toContain('이미 승인되거나 반려된 신청입니다.');
  });

  /**
   * 신청자도 팀장도 아닌 팀원(#1083). 취소를 누르면 팀 전체의 신청서가 하드 삭제되던
   * 자리라, 버튼이 아예 없어야 한다 — 「기간이 아니다」로 둘러대지도 않는다.
   */
  it('관리 권한이 없는 팀원에게는 취소·저장 버튼 대신 권한 안내를 보여준다', () => {
    const html = renderToStaticMarkup(
      <BlockedView
        reason="manage-not-allowed"
        program={program}
        application={null}
      />,
    );

    expect(html).toContain('신청서를 수정할 권한이 없습니다');
    expect(html).toContain('신청서를 낸 사람과 팀장만');
    expect(html).not.toContain('신청 취소');
    expect(html).not.toContain('수정 내용 저장');
    expect(html).not.toContain('신청 기간이 아닙니다');
  });

  it('team-required blocked state keeps detail CTA and shows team setup CTA', () => {
    const html = renderToStaticMarkup(
      <BlockedView
        reason="team-required"
        program={program}
        application={null}
      />,
    );

    expect(html).toContain('/programs/program-1');
    expect(html).not.toContain('/programs/program-1/teams');
  });

  /**
   * 반려 사유 표시(#722).
   *
   * 대시보드의 반려 알림이 "신청 상세에서 반려 사유를 확인해 주세요"라며 이 화면으로
   * 보낸다. 그 약속을 지키는 자리가 여기다 — 사유가 실려 오는 곳은
   * `GET .../applications/me` 하나뿐이라 여기서 안 그리면 학생은 어디에서도 못 본다.
   */
  it('반려된 신청은 사유를 반려 사유 상자로 그린다', () => {
    // Given / When
    const html = renderToStaticMarkup(
      <BlockedView
        reason="already-applied"
        program={program}
        application={rejectedApplication(
          '제출한 요약이 프로그램 주제와 맞지 않습니다.',
        )}
      />,
    );

    // Then — 사실(수정 불가)과 이유(사유)가 같은 화면에 함께 선다
    expect(html).toContain('반려 사유');
    expect(html).toContain('제출한 요약이 프로그램 주제와 맞지 않습니다.');
    expect(html).toContain(
      '승인 또는 반려된 신청서는 수정하거나 취소할 수 없습니다.',
    );
    // 교직원이 넣은 줄바꿈을 살리고 한글 문장이 어색하게 갈리지 않게 한다.
    expect(html).toContain('whitespace-pre-wrap');
    expect(html).toContain('break-keep');
    // `break-keep`(=word-break:keep-all)만으로는 공백 없는 긴 주소·핸들이 안 끊겨
    // 좁은 화면에서 상자와 페이지가 가로로 늘어난다. 자르지 않기로 한 뒤로는
    // 사유가 길어질 수 있어 이 비상 줄바꿈이 유일한 방어다.
    expect(html).toContain('[overflow-wrap:anywhere]');
  });

  it('자르지 않으므로 역할 요청 상한을 넘긴 사유도 끝까지 그린다', () => {
    // 번호 매긴 보완 목록은 신청 반려에서 흔한 형식이라 6줄을 예사로 넘는다.
    // 뒤를 자르면 마지막 줄(재신청 마감 같은 실행 정보)이 통째로 사라진다.
    const long = [
      '제출하신 요약이 프로그램 주제와 맞지 않습니다.',
      '보완할 점',
      '1. 해결하려는 문제를 한 문장으로 정리해 주세요.',
      '2. 기여할 오픈소스 저장소와 예상 작업 범위를 적어 주세요.',
      '3. 팀원 역할 분담을 적어 주세요.',
      '4. 일정 계획을 적어 주세요.',
      '재신청 마감은 8월 20일입니다.',
    ].join('\n');

    const html = renderToStaticMarkup(
      <BlockedView
        reason="already-applied"
        program={program}
        application={rejectedApplication(long)}
      />,
    );

    expect(html).toContain('재신청 마감은 8월 20일입니다.');
    expect(html).not.toContain('…');
  });

  /**
   * 사유가 비어 있으면 **상자를 아예 그리지 않는다.** 라벨만 뜨고 안이 비면 사용자는
   * 사유가 아직 안 온 줄 알고 기다린다. 반려 사실은 사유가 없어도 남는다.
   */
  it.each([
    ['빈 사유', ''],
    ['공백뿐인 사유', '   \n\t  '],
    ['사유 없음', null],
  ] as readonly (readonly [string, string | null])[])(
    '%s는 빈 반려 사유 상자를 그리지 않는다',
    (_label, reason) => {
      // Given / When
      const html = renderToStaticMarkup(
        <BlockedView
          reason="already-applied"
          program={program}
          application={rejectedApplication(reason)}
        />,
      );

      // Then
      expect(html).not.toContain('반려 사유');
      expect(html).toContain('수정할 수 없는 신청입니다');
    },
  );

  // 승인된 신청은 반려가 아니다 — 사유 칸이 어쩌다 채워져 있어도 그리지 않는다.
  it('승인된 신청에는 반려 사유 상자를 그리지 않는다', () => {
    // Given / When
    const html = renderToStaticMarkup(
      <BlockedView
        reason="already-applied"
        program={program}
        application={{
          ...rejectedApplication('되돌리기 전 남아 있던 사유'),
          status: 'APPROVED',
        }}
      />,
    );

    // Then
    expect(html).not.toContain('반려 사유');
    expect(html).not.toContain('되돌리기 전 남아 있던 사유');
  });

  // 신청서를 조회하지도 않은 갈래(팀 미구성 등)는 그릴 것이 없다.
  it('신청서 없이 막힌 화면은 지금과 같다', () => {
    const html = renderToStaticMarkup(
      <BlockedView
        reason="already-applied"
        program={program}
        application={null}
      />,
    );

    expect(html).not.toContain('반려 사유');
    expect(html).toContain('수정할 수 없는 신청입니다');
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
