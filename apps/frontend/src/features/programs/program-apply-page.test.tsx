import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  BlockedView,
  ProgramApplyFormView,
  ProgramApplySuccessView,
  type ProgramApplyTeamProps,
} from './program-apply-views';
import type { StudentApplication } from './student-application-api';
import type { ApplicationFormTemplate, ProgramDetail } from './types';
import type { ProgramTeam } from './api';

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
  ],
};

const canonicalTemplate: ApplicationFormTemplate = {
  ...template,
  fields: template.fields.filter((field) => field.key === 'applicantName'),
};

const noop = () => undefined;

const leaderTeam: ProgramTeam = {
  id: 'team-1',
  name: '합성 팀',
  memberCount: 1,
  minMembers: 1,
  maxMembers: 4,
  hasApplication: false,
  canInvite: true,
  canRemoveMembers: true,
  canLeave: true,
  isLeader: true,
  members: [
    {
      userId: 'user-1',
      nickname: 'leader-nick',
      name: '팀장',
      isLeader: true,
    },
  ],
};

const memberTeam: ProgramTeam = {
  ...leaderTeam,
  canInvite: false,
  canRemoveMembers: false,
  canLeave: true,
  isLeader: false,
};

/** 팀장 + 팀원 둘. 신청 화면에서도 로스터는 있는 그대로 보인다. */
const leaderTeamWithMember: ProgramTeam = {
  ...leaderTeam,
  memberCount: 2,
  members: [
    ...leaderTeam.members,
    {
      userId: 'user-2',
      nickname: 'member-nick',
      name: '팀원',
      isLeader: false,
    },
  ],
};

/**
 * 신청을 낸 뒤의 팀장. 서버는 제출 이후에도 초대·제외 권한을 그대로 준다
 * (`canInvite`가 꺼지지 않는다) — 신청 화면이 초대·제외를 그리지 않는 것은
 * 화면의 선택이고 권한 계약을 보수적으로 지어낸 결과가 아니다.
 */
const submittedLeaderTeam: ProgramTeam = {
  ...leaderTeamWithMember,
  hasApplication: true,
  canInvite: true,
  canRemoveMembers: true,
  canLeave: true,
};

const testTeamProps = {
  programId: program.id,
  team: leaderTeam,
  // 공유 팀 컴포넌트의 「내 행」 판정 기준 — 여기서는 팀장 본인이다.
  sessionNickname: 'leader-nick',
  invitation: null,
  inviteOpen: false,
  inviteTriggerRef: createRef<HTMLButtonElement>(),
  createName: '',
  teamError: null,
  creating: false,
  onOpenInvite: noop,
  onCloseInvite: noop,
  onCreateNameChange: noop,
  onTeamChanged: noop,
} satisfies ProgramApplyTeamProps;

const handlers = {
  onChange: noop,
  onTogglePublicationPlanned: noop,
  onRepositoryModeChange: noop,
  onToggleConsent: noop,
  onRequestSubmit: noop,
  onRequestCancel: noop,
  onCloseConfirmation: noop,
  onConfirm: noop,
} as const;

const baseValues = {
  title: '',
  isRepositoryPublicationPlanned: true,
  repositoryConnectionMode: 'new' as const,
  repositoryUrl: '',
  personalDataConsent: false,
};

function renderForm(
  overrides: Partial<Parameters<typeof ProgramApplyFormView>[0]> = {},
) {
  return renderToStaticMarkup(
    <ProgramApplyFormView
      program={program}
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
      {...testTeamProps}
      {...handlers}
      {...overrides}
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
    answers: { applicantName: '합성 학생', title: '제목' },
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
  it('새 신청서는 단계 없이 한 화면에 프로필·팀 이름·구성·저장소·동의·제출을 모두 둔다', () => {
    const html = renderForm({ team: null });

    expect(html).toContain('합성 프로그램 신청');
    expect(html).toContain('@synthetic-student');
    expect(html).toContain('계정에 연결된 GitHub');
    expect(html).toContain('합성 학생');
    expect(html).toContain('name="applicantName"');
    expect(html).toMatch(/name="applicantName"[^>]*readOnly|readonly/i);
    expect(html).toContain('id="apply-team-name"');
    expect(html).toContain('새 저장소 발급받기');
    expect(html).toContain('개인정보 수집·이용 동의');
    expect(html).toContain('신청 제출');

    // 단계 이동도, 학생이 눌러야 하는 새로고침도 없다.
    expect(html).not.toContain('다음');
    expect(html).not.toContain('이전');
    expect(html).not.toContain('aria-label="작성 단계"');
    expect(html).not.toContain('팀·초대 새로고침');
    expect(html).not.toContain('팀 새로고침');
    // 신청 화면은 팀을 해체·탈퇴·제외하는 자리가 아니다.
    expect(html).not.toContain('팀에서 제외');
    expect(html).not.toContain('팀 나가기');
    expect(html).not.toContain('받은 팀 초대');
    expect(html).not.toContain('참여 코드');
    expect(html.match(/합성 프로그램 신청/g)?.length).toBe(1);
    expect(html.match(/data-slot="page-header"/g)?.length).toBe(1);
    expect(html.match(/data-slot="page-body"/g)?.length).toBe(1);
  });

  it('팀이 아직 없어도 로스터 자리는 이 화면 안에 함께 있다', () => {
    const html = renderForm({ team: null });

    // 팀 이름 입력과 구성원 영역이 같은 화면에 있다 — 별도 마법사로 넘기지 않는다.
    expect(html).toContain('id="apply-team-name"');
    expect(html).toContain('신청 제출');
    expect(html).not.toContain('팀 만들고 계속');
    expect(html).not.toContain('팀 없이 계속');
  });

  it('canonical 템플릿은 신청자 이름만 두고 제목 입력은 없다', () => {
    const html = renderForm({ template: canonicalTemplate, team: null });

    expect(html).toContain('합성 학생');
    expect(html).not.toContain('name="title"');
  });

  it('제목 필드는 dirty-state 커버용 커스텀 템플릿에서만 보인다', () => {
    const html = renderForm({ team: null });

    expect(html).toContain('name="title"');
    expect(html).toContain('합성 학생');
  });

  it('기존 팀 이름은 이름 변경 API가 없으므로 읽기 전용으로 보여 준다', () => {
    const html = renderForm({ team: leaderTeam });

    expect(html).toContain('합성 팀');
    expect(html).toContain('id="apply-team-name"');
    expect(html).toMatch(/id="apply-team-name"[^>]*disabled/);
  });

  it('팀 이름 검증 실패는 그 입력칸 옆에 남는다', () => {
    const html = renderForm({
      team: null,
      teamError: '팀 이름을 입력해 주세요.',
    });

    expect(html).toContain('팀 이름을 입력해 주세요.');
    expect(html).toContain('role="alert"');
  });

  it('구성원 목록은 신청 화면에서도 제외 컨트롤 없이 그려진다', () => {
    const html = renderForm({ team: leaderTeamWithMember });

    expect(html).toContain('member-nick');
    expect(html).not.toMatch(/aria-label="[^"]*팀에서 제외"/);
    expect(html).not.toContain('팀에서 제외');
  });

  it('저장소 발급을 사용하지 않는 프로그램에서는 연결 방식을 표시하지 않는다', () => {
    const html = renderForm({
      program: { ...program, repositoryProvisioningEnabled: false },
    });

    expect(html).not.toContain('새 저장소 발급받기');
    expect(html).not.toContain('내 저장소 연결하기');
  });

  it('저장소를 직접 연결하면 URL 입력을 함께 보여준다', () => {
    const html = renderForm({
      values: { ...baseValues, repositoryConnectionMode: 'own' },
    });

    expect(html).toContain('https://github.com/team/repo');
    expect(html).toContain('기존 GitHub 공개 저장소를 연결합니다.');
  });

  it('저장소 URL 사전 검증 실패를 배너로 표시한다', () => {
    const html = renderForm({
      values: { ...baseValues, repositoryConnectionMode: 'own' },
      errors: {
        repositoryUrl:
          '연결하려는 저장소를 찾을 수 없거나 비공개 저장소입니다. GitHub에 공개된 저장소만 연결할 수 있습니다.',
      },
    });

    expect(html).toContain(
      '연결하려는 저장소를 찾을 수 없거나 비공개 저장소입니다. GitHub에 공개된 저장소만 연결할 수 있습니다.',
    );
  });

  it('저장소 URL·동의 오류를 공통 배너로 표시한다', () => {
    const html = renderForm({
      errors: {
        personalDataConsent:
          '개인정보 수집·이용에 동의해야 지원할 수 있습니다.',
      },
    });

    expect(html).toContain('개인정보 수집·이용에 동의해야 지원할 수 있습니다.');
  });

  it('초대로 합류한 팀원은 로스터만 보고 제출하지 않는다', () => {
    const html = renderForm({ team: memberTeam });

    expect(html).toContain('합성 팀');
    expect(html).toContain('팀장이 신청서를 제출할 때까지 기다립니다.');
    expect(html).not.toContain('신청 제출');
    expect(html).not.toContain('개인정보 수집·이용 동의');
    expect(html).not.toContain('id="apply-team-name"');
  });

  it('제출 후 수정 화면은 초대도 제외도 다루지 않고 로스터만 보여 준다', () => {
    const html = renderForm({
      team: submittedLeaderTeam,
      values: { ...baseValues, title: '기존 제목' },
      mode: 'edit',
      canManage: true,
    });

    // 권한 계약은 그대로다 — 화면이 그것을 다시 유추하지 않는다.
    expect(submittedLeaderTeam.canInvite).toBe(true);
    expect(html).toContain('member-nick');
    expect(html).toContain('수정 내용 저장');
    expect(html).toContain('신청 취소');
    expect(html).not.toContain('id="invite-search"');
    expect(html).not.toContain('보낸 초대');
    expect(html).not.toMatch(/aria-label="[^"]*팀에서 제외"/);
    expect(html).not.toContain('팀 새로고침');
    expect(html).not.toContain('팀·초대 새로고침');
    expect(html).not.toContain('id="apply-team-name"');
  });

  it('수정 화면에는 저장소 연결·동의 섹션을 다시 보여주지 않는다', () => {
    const html = renderForm({
      team: memberTeam,
      values: { ...baseValues, title: '기존 제목' },
      mode: 'edit',
      canManage: true,
    });

    expect(html).not.toContain('새 저장소 발급받기');
    expect(html).not.toContain('개인정보 수집·이용 동의');
    expect(html).not.toContain('aria-label="작성 단계"');
    expect(html).not.toContain('aria-label="작성 진행률"');
    expect(html).not.toContain('팀 구성·제출');
  });

  it('제출 확인창은 하나뿐이고 승인 이후 제한 문구를 표시한다', () => {
    const html = renderForm({
      values: {
        ...baseValues,
        title: '제목',
        personalDataConsent: true,
      },
      confirmation: 'submit',
    });

    expect(html).toContain('신청서를 제출하시겠습니까?');
    expect(html).toContain('승인된 이후에는 수정 및 취소가 불가능합니다');
    expect(html.match(/신청서를 제출하시겠습니까\?/g)?.length).toBe(1);
  });

  it('수정할 문항이 없는 승인 대기 신청에는 취소만 표시한다', () => {
    const html = renderForm({
      template: canonicalTemplate,
      team: memberTeam,
      values: {
        ...baseValues,
        title: '기존 제목',
        isRepositoryPublicationPlanned: false,
      },
      mode: 'edit',
      canManage: true,
    });

    expect(html).not.toContain('수정 내용 저장');
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

  it('관리 권한이 없는 팀원에게는 취소·저장 버튼 대신 권한 안내를 보여준다', () => {
    const html = renderToStaticMarkup(
      <BlockedView reason="manage-not-allowed" application={null} />,
    );

    expect(html).toContain('신청서를 수정할 권한이 없습니다');
    expect(html).toContain('신청서를 낸 사람과 팀장만');
    expect(html).not.toContain('신청 취소');
    expect(html).not.toContain('수정 내용 저장');
    expect(html).not.toContain('신청 기간이 아닙니다');
  });

  it('team-required blocked state does not send the student to /teams or overview', () => {
    const html = renderToStaticMarkup(
      <BlockedView
        reason="team-required"
        application={null}
        programId={program.id}
      />,
    );

    expect(html).toContain('팀 구성이 필요합니다');
    expect(html).not.toContain('/programs/program-1/teams');
    expect(html).not.toContain('프로그램 개요');
    // 아직 팀이 없는 사람을 팀 화면으로 보내지 않는다.
    expect(html).not.toContain('/my-team');
    expect(html).not.toContain('우리 팀 보기');
  });

  it('이미 판정된 신청은 사유와 함께 우리 팀으로 돌아갈 길을 준다', () => {
    const html = renderToStaticMarkup(
      <BlockedView
        reason="already-applied"
        application={rejectedApplication('주제가 맞지 않습니다.')}
        programId="program:1"
      />,
    );

    expect(html).toContain('반려 사유');
    expect(html).toContain('주제가 맞지 않습니다.');
    expect(html).toContain('수정할 수 없는 신청입니다');
    expect(html).toContain('href="/programs/program%3A1/my-team"');
  });

  it('programId를 모르면 돌아갈 주소를 지어내지 않는다', () => {
    const html = renderToStaticMarkup(
      <BlockedView reason="already-applied" application={null} />,
    );

    expect(html).toContain('수정할 수 없는 신청입니다');
    expect(html).not.toContain('/my-team');
  });

  it('반려된 신청은 사유를 반려 사유 상자로 그린다', () => {
    const html = renderToStaticMarkup(
      <BlockedView
        reason="already-applied"
        application={rejectedApplication(
          '제출한 요약이 프로그램 주제와 맞지 않습니다.',
        )}
      />,
    );

    expect(html).toContain('반려 사유');
    expect(html).toContain('제출한 요약이 프로그램 주제와 맞지 않습니다.');
    expect(html).toContain(
      '승인 또는 반려된 신청서는 수정하거나 취소할 수 없습니다.',
    );
    expect(html).toContain('whitespace-pre-wrap');
    expect(html).toContain('break-keep');
    expect(html).toContain('[overflow-wrap:anywhere]');
  });

  it('자르지 않으므로 역할 요청 상한을 넘긴 사유도 끝까지 그린다', () => {
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
        application={rejectedApplication(long)}
      />,
    );

    expect(html).toContain('재신청 마감은 8월 20일입니다.');
    expect(html).not.toContain('…');
  });

  it.each([
    ['빈 사유', ''],
    ['공백뿐인 사유', '   \n\t  '],
    ['사유 없음', null],
  ] as readonly (readonly [string, string | null])[])(
    '%s는 빈 반려 사유 상자를 그리지 않는다',
    (_label, reason) => {
      const html = renderToStaticMarkup(
        <BlockedView
          reason="already-applied"
          application={rejectedApplication(reason)}
        />,
      );

      expect(html).not.toContain('반려 사유');
      expect(html).toContain('수정할 수 없는 신청입니다');
    },
  );

  it('승인된 신청에는 반려 사유 상자를 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <BlockedView
        reason="already-applied"
        application={{
          ...rejectedApplication('되돌리기 전 남아 있던 사유'),
          status: 'APPROVED',
        }}
      />,
    );

    expect(html).not.toContain('반려 사유');
    expect(html).not.toContain('되돌리기 전 남아 있던 사유');
  });

  it('신청서 없이 막힌 화면은 지금과 같다', () => {
    const html = renderToStaticMarkup(
      <BlockedView reason="already-applied" application={null} />,
    );

    expect(html).not.toContain('반려 사유');
    expect(html).toContain('수정할 수 없는 신청입니다');
  });

  it('성공 상태를 표시한다', () => {
    const html = renderToStaticMarkup(
      <ProgramApplySuccessView applicationId="app-1" programId={program.id} />,
    );
    expect(html).toContain('신청이 접수되었습니다');
    expect(html).toContain('app-1');
    expect(html).toContain('/dashboard');
  });

  it('제출 직후에는 방금 신청한 프로그램의 우리 팀 화면으로 바로 간다', () => {
    const html = renderToStaticMarkup(
      <ProgramApplySuccessView applicationId="app-1" programId="program:1" />,
    );

    expect(html).toContain('우리 팀 보기');
    expect(html).toContain('href="/programs/program%3A1/my-team"');
    // 팀 id나 쿼리를 화면이 지어내지 않는다.
    expect(html).not.toContain('teamId');
    expect(html).not.toContain('?team');
  });

  it('수정 저장 직후에도 같은 팀 화면 동선을 준다', () => {
    const html = renderToStaticMarkup(
      <ProgramApplySuccessView
        applicationId="app-1"
        programId={program.id}
        mode="edit"
      />,
    );

    expect(html).toContain('신청서가 수정되었습니다');
    expect(html).toContain('href="/programs/program-1/my-team"');
    expect(html).toContain('내 대시보드로');
  });
});
