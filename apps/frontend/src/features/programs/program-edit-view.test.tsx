import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { EditableProgram } from './api';
import {
  buildProgramEditInput,
  mapProgramEditError,
  toProgramEditForm,
  type ProgramEditErrors,
} from './program-edit-flow';
import { PROGRAM_END_AT_UNDECIDED } from './program-end-at';
import { ProgramEditLoadFailure, ProgramEditView } from './program-edit-view';

const noOp = () => undefined;

/**
 * #867에서 새로 생긴 게시 상태 전환 props다.
 * 대부분의 테스트에서 값 자체는 중요하지 않다 — 필요한 테스트만 덮어쓴다.
 */
const lifecycleActionProps = {
  isLifecycleBusy: false,
  isLifecycleConfirming: false,
  lifecycleError: null,
  // #875 「위험 영역」 노출 여부. 대부분의 기존 테스트는 STAFF 화면을 보므로
  // 기본값은 false — ADMIN 전용 동작은 별도 describe에서만 true로 덮어쓴다.
  isAdmin: false,
  onRequestLifecycleToggle: noOp,
  onCancelLifecycleToggle: noOp,
  onConfirmLifecycleToggle: noOp,
};

const editableProgram: EditableProgram = {
  id: 'program-1',
  name: 'OSS 경진대회',
  organizer: 'SW중심대학사업단',
  category: 'OSS_CONTEST',
  lifecycle: 'PUBLISHED',
  applicationTemplateKey: 'oss-contest',
  applicationTemplateVersion: 1,
  applicationCount: 3,
  categoryLocked: {
    locked: true,
    byApplications: true,
    byTeams: true,
    applicationCount: 3,
    teamCount: 2,
  },
  applicationStartAt: '2026-08-01T09:30:59.000Z',
  applicationEndAt: '2026-08-15T09:30:59.000Z',
  startAt: '2026-08-16T09:30:59.000Z',
  endAt: '2026-08-31T09:30:59.000Z',
  repositoryProvisioningEnabled: true,
  notifyOnDeadline: true,
  description: '프로그램 설명',
  teamMinSize: 2,
  teamMaxSize: 4,
  milestones: [
    {
      id: 'milestone-canonical-id',
      name: '기획서 제출',
      startAt: '2026-08-16T09:30:59.000Z',
      dueAt: '2026-08-20T12:30:59.000Z',
      submissionType: 'TEXT',
      instructions: '최종 결과를 글로 제출해 주세요.',
    },
  ],
};

const fieldErrors: ProgramEditErrors = {
  name: '프로그램명을 입력해 주세요.',
  period: '신청 기간을 확인해 주세요.',
};

describe('ProgramEditView contract', () => {
  it('불러오기 실패에서도 사용자가 계속 이동할 경로를 알려 준다', () => {
    const html = renderToStaticMarkup(
      <ProgramEditLoadFailure
        message="잠시 연결할 수 없습니다."
        onRetry={noOp}
      />,
    );

    expect(html).toContain('다시 시도');
    expect(html).toContain('프로그램 목록으로 돌아갈 수 있습니다');
    expect(html).toContain('href="/programs"');
    expect(html).toContain('프로그램 목록');
  });

  it('renders locked category, template metadata, milestone actions, and the exit link', () => {
    // Given / When
    const html = renderToStaticMarkup(
      <ProgramEditView
        program={editableProgram}
        form={toProgramEditForm(editableProgram)}
        errors={{}}
        toastMessage={null}
        generalAlert={null}
        isSaving={false}
        milestoneEditor={{ mode: 'closed' }}
        deleteTarget={null}
        expandedDocumentsMilestoneId={null}
        isMilestoneBusy={false}
        {...lifecycleActionProps}
        onFieldChange={noOp}
        onSubmit={vi.fn()}
        onAddMilestone={noOp}
        onEditMilestone={noOp}
        onCancelMilestone={noOp}
        onMilestoneFieldChange={noOp}
        onSaveMilestone={vi.fn()}
        onRequestDeleteMilestone={noOp}
        onCancelDelete={noOp}
        onConfirmDelete={vi.fn()}
      />,
    );

    // Then
    expect(html).toContain(
      '신청자가 3명, 팀이 2개 있어 유형을 변경할 수 없습니다',
    );
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('id="program-application-start-at"');
    expect(html).toContain('시간 변경');
    expect(html).toContain('신청·운영·마일스톤 일정');
    // 양식 키(`oss-contest`)는 구현 식별자다 — 사람이 읽을 양식명만 화면에 남는다.
    expect(html).not.toContain('oss-contest');
    expect(html).toContain('OSS경진대회 신청서');
    expect(html).toContain('v1');
    expect(html).toContain('milestone-canonical-id');
    expect(html).toContain('기획서 제출');
    expect(html).toContain('신청 기간');
    expect(html).toContain('aria-label="2026년 8월 1일 (토요일)"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('2026년 8월 1일 (토요일)');
    expect(html).not.toContain('TEXT');
    expect(html).toContain('수정');
    expect(html).toContain('삭제');
    // 페이지를 나가는 길은 제목 위의 이 링크 하나뿐이다.
    expect(html).toContain('href="/programs/program-1"');
    expect(html).toContain('← 프로그램 개요');
  });

  it('마일스톤이 없으면 다음 행동을 문구와 버튼으로 알려 준다', () => {
    const program = { ...editableProgram, milestones: [] };
    const html = renderToStaticMarkup(
      <ProgramEditView
        program={program}
        form={toProgramEditForm(program)}
        errors={{}}
        toastMessage={null}
        generalAlert={null}
        isSaving={false}
        milestoneEditor={{ mode: 'closed' }}
        deleteTarget={null}
        expandedDocumentsMilestoneId={null}
        isMilestoneBusy={false}
        {...lifecycleActionProps}
        onFieldChange={noOp}
        onSubmit={vi.fn()}
        onAddMilestone={noOp}
        onEditMilestone={noOp}
        onCancelMilestone={noOp}
        onMilestoneFieldChange={noOp}
        onSaveMilestone={vi.fn()}
        onRequestDeleteMilestone={noOp}
        onCancelDelete={noOp}
        onConfirmDelete={vi.fn()}
      />,
    );

    expect(html).toContain('아직 등록된 마일스톤이 없습니다');
    expect(html).toContain('위의 ‘추가’를 눌러');
    expect(html).toContain('첫 마일스톤을 만드세요');
  });

  // #355 — 교직원 화면은 내부 구현 용어를 쓰지 않는다.
  // 라벨은 값이 무엇인지 한국어로 말하고, 설명문은 화면에서 할 수 있는 일을 말한다.
  it('내부 구현 용어 대신 교직원이 읽을 수 있는 라벨을 쓴다', () => {
    const html = renderToStaticMarkup(
      <ProgramEditView
        program={editableProgram}
        form={toProgramEditForm(editableProgram)}
        errors={{}}
        toastMessage={null}
        generalAlert={null}
        isSaving={false}
        milestoneEditor={{ mode: 'closed' }}
        deleteTarget={null}
        expandedDocumentsMilestoneId={null}
        isMilestoneBusy={false}
        {...lifecycleActionProps}
        onFieldChange={noOp}
        onSubmit={vi.fn()}
        onAddMilestone={noOp}
        onEditMilestone={noOp}
        onCancelMilestone={noOp}
        onMilestoneFieldChange={noOp}
        onSaveMilestone={vi.fn()}
        onRequestDeleteMilestone={noOp}
        onCancelDelete={noOp}
        onConfirmDelete={vi.fn()}
      />,
    );

    expect(html).toContain('신청서 양식');
    expect(html).toContain('양식 버전');
    expect(html).toContain('신청 승인 시 GitHub 저장소 자동 생성');
    expect(html).toContain(
      '학생이 제출물을 올릴 마일스톤을 등록·수정·삭제할 수 있습니다.',
    );

    for (const internalTerm of [
      '템플릿 키',
      '템플릿 버전',
      '저장소 프로비저닝',
      'canonical ID',
    ]) {
      expect(html).not.toContain(internalTerm);
    }
  });

  it('renders field errors without dropping current input values', () => {
    // Given
    const form = {
      ...toProgramEditForm(editableProgram),
      name: '작성 중인 이름',
    };

    // When
    const html = renderToStaticMarkup(
      <ProgramEditView
        program={editableProgram}
        form={form}
        errors={fieldErrors}
        toastMessage={null}
        generalAlert={null}
        isSaving={false}
        milestoneEditor={{ mode: 'closed' }}
        deleteTarget={null}
        expandedDocumentsMilestoneId={null}
        isMilestoneBusy={false}
        {...lifecycleActionProps}
        onFieldChange={noOp}
        onSubmit={vi.fn()}
        onAddMilestone={noOp}
        onEditMilestone={noOp}
        onCancelMilestone={noOp}
        onMilestoneFieldChange={noOp}
        onSaveMilestone={vi.fn()}
        onRequestDeleteMilestone={noOp}
        onCancelDelete={noOp}
        onConfirmDelete={vi.fn()}
      />,
    );

    // Then
    expect(html).toContain('value="작성 중인 이름"');
    expect(html).toContain(fieldErrors.name);
    expect(html).toContain(fieldErrors.period);
  });

  it('renders delete confirmation, submission conflict alert, and success toast', () => {
    // Given / When
    const html = renderToStaticMarkup(
      <ProgramEditView
        program={editableProgram}
        form={toProgramEditForm(editableProgram)}
        errors={{}}
        toastMessage="저장되었습니다."
        generalAlert="제출물이 있는 마일스톤은 삭제할 수 없습니다."
        isSaving={false}
        milestoneEditor={{ mode: 'closed' }}
        deleteTarget={editableProgram.milestones[0]}
        expandedDocumentsMilestoneId={null}
        isMilestoneBusy={false}
        {...lifecycleActionProps}
        onFieldChange={noOp}
        onSubmit={vi.fn()}
        onAddMilestone={noOp}
        onEditMilestone={noOp}
        onCancelMilestone={noOp}
        onMilestoneFieldChange={noOp}
        onSaveMilestone={vi.fn()}
        onRequestDeleteMilestone={noOp}
        onCancelDelete={noOp}
        onConfirmDelete={vi.fn()}
      />,
    );

    // Then
    expect(html).toContain('role="dialog"');
    expect(html).toContain('마일스톤 삭제');
    expect(html).toContain('삭제 확정');
    expect(html).toContain('제출물이 있는 마일스톤은 삭제할 수 없습니다');
    expect(html).toContain('role="status"');
    // 저장은 더 이상 페이지를 떠나지 않는다 — 안내문도 이동을 말하지 않는다.
    expect(html).toContain('저장되었습니다.');
    expect(html).not.toContain('상세 화면으로 이동합니다');
  });
  it('locks category selection when only teams exist', () => {
    // Given
    const teamOnlyProgram = {
      ...editableProgram,
      applicationCount: 0,
      categoryLocked: {
        locked: true,
        byApplications: false,
        byTeams: true,
        applicationCount: 0,
        teamCount: 2,
      },
    };

    // When
    const html = renderToStaticMarkup(
      <ProgramEditView
        program={teamOnlyProgram}
        form={toProgramEditForm(teamOnlyProgram)}
        errors={{}}
        toastMessage={null}
        generalAlert={null}
        isSaving={false}
        milestoneEditor={{ mode: 'closed' }}
        deleteTarget={null}
        expandedDocumentsMilestoneId={null}
        isMilestoneBusy={false}
        {...lifecycleActionProps}
        onFieldChange={noOp}
        onSubmit={vi.fn()}
        onAddMilestone={noOp}
        onEditMilestone={noOp}
        onCancelMilestone={noOp}
        onMilestoneFieldChange={noOp}
        onSaveMilestone={vi.fn()}
        onRequestDeleteMilestone={noOp}
        onCancelDelete={noOp}
        onConfirmDelete={vi.fn()}
      />,
    );

    // Then
    expect(html).toContain('팀이 2개 있어 유형을 변경할 수 없습니다');
    expect(html).toContain('disabled=""');
  });
  // 종료일이 없던 프로그램은 「미정」으로 열린다 — 날짜를 고르려면 체크를 먼저
  // 풀어야 하고(화면에서는 그때까지 날짜 칸이 비활성이다), 그 뒤에 고른 날짜가 나간다.
  it('allows a legacy undecided end to be set and emits the valid payload', () => {
    const legacyProgram = { ...editableProgram, endAt: null };
    expect(toProgramEditForm(legacyProgram).endAtUndecided).toBe(true);
    const form = {
      ...toProgramEditForm(legacyProgram),
      endAtUndecided: false,
      endAt: '2026-09-01T12:00',
    };

    const input = buildProgramEditInput(form, ['endAt']);

    expect(input.endAt).toBe('2026-09-01T03:00:00.000Z');
    expect(input.applicationEndAt).toBe(legacyProgram.applicationEndAt);
    expect(input.teamMinSize).toBe(2);
    expect(input.teamMaxSize).toBe(4);
  });

  // 비어 있는 것과 「미정」은 다른 뜻이다 — 비어 있는 것은 아직 안 고른 상태이고,
  // 안내는 두 갈래(날짜를 고르기·미정을 선택하기)를 모두 알려 준다.
  it('forbids clearing an existing program end without choosing undecided', () => {
    const form = {
      ...toProgramEditForm(editableProgram),
      endAt: '',
      endAtUndecided: false,
    };

    let error: unknown;
    try {
      buildProgramEditInput(form, ['endAt']);
    } catch (caught) {
      error = caught;
    }

    expect(mapProgramEditError(error).endAt).toBe(
      '종료일을 정하거나 「종료일 미정」을 선택해 주세요.',
    );
  });

  // 체크를 켜면 날짜 칸을 보지 않고 센티널로 되돌린다 — 화면에서 그 칸은 비활성이다.
  it('emits the undecided sentinel when the staff checks undecided', () => {
    const form = {
      ...toProgramEditForm(editableProgram),
      endAtUndecided: true,
      endAt: '',
    };

    expect(buildProgramEditInput(form, ['endAtUndecided']).endAt).toBe(
      PROGRAM_END_AT_UNDECIDED,
    );
  });

  it('rejects moving program start after an existing milestone start on startAt', () => {
    const program = {
      ...editableProgram,
      applicationStartAt: '2026-04-13T03:40:00.000Z',
      applicationEndAt: '2026-08-01T03:40:00.000Z',
      startAt: '2026-08-18T03:41:00.000Z',
      endAt: '2026-08-30T03:41:00.000Z',
      milestones: [
        {
          ...editableProgram.milestones[0],
          startAt: '2026-08-18T03:41:00.000Z',
          dueAt: '2026-08-29T03:41:00.000Z',
        },
      ],
    };
    const form = {
      ...toProgramEditForm(program),
      applicationEndAt: '2026-08-24T12:40',
      startAt: '2026-08-24T12:41',
    };

    let error: unknown;
    try {
      buildProgramEditInput(form, ['applicationEndAt', 'startAt']);
    } catch (caught) {
      error = caught;
    }

    expect(mapProgramEditError(error).startAt).toContain('마일스톤 시작일');
    expect(mapProgramEditError(error).endAt).toBeUndefined();
  });

  it.each([
    ['application end', '2026-08-15T09:30', '운영 시작일 이후'],
    ['milestone due', '2026-08-20T12:30', '모든 마일스톤 마감 이후'],
  ])('rejects a program end at the %s boundary', (_label, endAt, message) => {
    const form = { ...toProgramEditForm(editableProgram), endAt };

    let error: unknown;
    try {
      buildProgramEditInput(form, ['endAt']);
    } catch (caught) {
      error = caught;
    }

    expect(mapProgramEditError(error).endAt).toContain(message);
  });

  // #867 — 「변경사항 저장」은 우측 정렬이고(docs/rules/frontend.md),
  // 오른쪽 끝에 붙는 것이지 양 끝으로 벌어지는 게 아니다.
  it('폼의 제출 버튼은 justify-end이고 justify-between이 아니다', () => {
    const html = renderToStaticMarkup(
      <ProgramEditView
        program={editableProgram}
        form={toProgramEditForm(editableProgram)}
        errors={{}}
        toastMessage={null}
        generalAlert={null}
        isSaving={false}
        milestoneEditor={{ mode: 'closed' }}
        deleteTarget={null}
        expandedDocumentsMilestoneId={null}
        isMilestoneBusy={false}
        {...lifecycleActionProps}
        onFieldChange={noOp}
        onSubmit={vi.fn()}
        onAddMilestone={noOp}
        onEditMilestone={noOp}
        onCancelMilestone={noOp}
        onMilestoneFieldChange={noOp}
        onSaveMilestone={vi.fn()}
        onRequestDeleteMilestone={noOp}
        onCancelDelete={noOp}
        onConfirmDelete={vi.fn()}
      />,
    );

    const footerStart = html.indexOf(
      'class="flex flex-wrap justify-end gap-2"',
    );
    expect(footerStart).toBeGreaterThan(-1);
    // 폼이 끝나는 지점(</form>)까지만 잘라야 한다 — 그 뒤 마일스톤 섹션 헤더는
    // 자기 자신의 justify-between 레이아웃을 갖고 있어서, 창을 너무 넓게 잡으면
    // 그 무관한 justify-between까지 걸려 오탐이 난다.
    const formEnd = html.indexOf('</form>', footerStart);
    expect(formEnd).toBeGreaterThan(-1);
    const footer = html.slice(footerStart, formEnd);
    expect(footer).not.toContain('justify-between');
    expect(footer).toContain('변경사항 저장');
  });

  // #867 — 게시 상태 전환은 되돌릴 수 있으므로(program-edit-lifecycle-section.tsx
  // 상단 주석) destructive 톤을 쓰지 않는다. PUBLISHED에서는 「프로그램 내리기」가
  // outline 버튼으로 뜬다.
  it('PUBLISHED는 게시 상태 섹션과 destructive 톤이 아닌 프로그램 내리기 버튼을 보여준다', () => {
    const html = renderToStaticMarkup(
      <ProgramEditView
        program={editableProgram}
        form={toProgramEditForm(editableProgram)}
        errors={{}}
        toastMessage={null}
        generalAlert={null}
        isSaving={false}
        milestoneEditor={{ mode: 'closed' }}
        deleteTarget={null}
        expandedDocumentsMilestoneId={null}
        isMilestoneBusy={false}
        {...lifecycleActionProps}
        onFieldChange={noOp}
        onSubmit={vi.fn()}
        onAddMilestone={noOp}
        onEditMilestone={noOp}
        onCancelMilestone={noOp}
        onMilestoneFieldChange={noOp}
        onSaveMilestone={vi.fn()}
        onRequestDeleteMilestone={noOp}
        onCancelDelete={noOp}
        onConfirmDelete={vi.fn()}
      />,
    );

    expect(html).toContain('게시 상태');
    expect(html).toContain(
      '현재 프로그램이 공개되어 있으며 신청 기간 안이면 신청을 받고 있습니다.',
    );

    const buttonStart = html.indexOf('프로그램 내리기');
    expect(buttonStart).toBeGreaterThan(-1);
    // data-variant는 class보다 앞서 나오는데, class 문자열 자체가 수백 자라
    // 400자로는 열린 태그 시작까지 못 돌아간다 — button.tsx의 cva 조합 길이만큼 넉넉히 잡는다.
    const buttonTag = html.slice(Math.max(0, buttonStart - 1200), buttonStart);
    expect(buttonTag).toContain('data-variant="outline"');
    expect(buttonTag).not.toContain('text-destructive');
  });

  // ARCHIVED에서는 반대 방향 문구를 쓴다 — 예전 문구(「프로그램 복구하기」)는
  // 다시 나오면 안 된다(#867 완료 기준).
  it('ARCHIVED는 다시 게시하기를 보여주고 예전 문구를 쓰지 않는다', () => {
    const archivedProgram: EditableProgram = {
      ...editableProgram,
      lifecycle: 'ARCHIVED',
    };
    const html = renderToStaticMarkup(
      <ProgramEditView
        program={archivedProgram}
        form={toProgramEditForm(archivedProgram)}
        errors={{}}
        toastMessage={null}
        generalAlert={null}
        isSaving={false}
        milestoneEditor={{ mode: 'closed' }}
        deleteTarget={null}
        expandedDocumentsMilestoneId={null}
        isMilestoneBusy={false}
        {...lifecycleActionProps}
        onFieldChange={noOp}
        onSubmit={vi.fn()}
        onAddMilestone={noOp}
        onEditMilestone={noOp}
        onCancelMilestone={noOp}
        onMilestoneFieldChange={noOp}
        onSaveMilestone={vi.fn()}
        onRequestDeleteMilestone={noOp}
        onCancelDelete={noOp}
        onConfirmDelete={vi.fn()}
      />,
    );

    expect(html).toContain('다시 게시하기');
    expect(html).not.toContain('프로그램 복구하기');
  });

  // isLifecycleConfirming=true일 때 크래시 없이 섹션이 그려지는지만 여기서 본다.
  // Radix AlertDialog의 Portal은 useLayoutEffect가 붙어야 mount되는데,
  // renderToStaticMarkup은 effect를 전혀 돌리지 않는다(SSR 문자열 렌더러라
  // container가 계산되지 않고 Portal이 null을 반환한다) — 그래서 이 파일에서는
  // 다이얼로그가 실제로 뜨는지 확인할 수 없다. 그 부분은 실제 DOM에 mount하는
  // program-edit-page.test.tsx 쪽 컴포넌트 테스트가 맡는다.
  it('isLifecycleConfirming이어도 SSR 렌더링이 깨지지 않는다', () => {
    const html = renderToStaticMarkup(
      <ProgramEditView
        program={editableProgram}
        form={toProgramEditForm(editableProgram)}
        errors={{}}
        toastMessage={null}
        generalAlert={null}
        isSaving={false}
        milestoneEditor={{ mode: 'closed' }}
        deleteTarget={null}
        expandedDocumentsMilestoneId={null}
        isMilestoneBusy={false}
        {...lifecycleActionProps}
        isLifecycleConfirming
        onFieldChange={noOp}
        onSubmit={vi.fn()}
        onAddMilestone={noOp}
        onEditMilestone={noOp}
        onCancelMilestone={noOp}
        onMilestoneFieldChange={noOp}
        onSaveMilestone={vi.fn()}
        onRequestDeleteMilestone={noOp}
        onCancelDelete={noOp}
        onConfirmDelete={vi.fn()}
      />,
    );

    expect(html).toContain('게시 상태');
  });

  // STAFF는 「위험 영역」에서 삭제가 아닌 아카이브 안내만 본다.
  it('isAdmin=false(STAFF)면 삭제 버튼 없이 아카이브 안내를 그린다', () => {
    const html = renderToStaticMarkup(
      <ProgramEditView
        program={editableProgram}
        form={toProgramEditForm(editableProgram)}
        errors={{}}
        toastMessage={null}
        generalAlert={null}
        isSaving={false}
        milestoneEditor={{ mode: 'closed' }}
        deleteTarget={null}
        expandedDocumentsMilestoneId={null}
        isMilestoneBusy={false}
        {...lifecycleActionProps}
        onFieldChange={noOp}
        onSubmit={vi.fn()}
        onAddMilestone={noOp}
        onEditMilestone={noOp}
        onCancelMilestone={noOp}
        onMilestoneFieldChange={noOp}
        onSaveMilestone={vi.fn()}
        onRequestDeleteMilestone={noOp}
        onCancelDelete={noOp}
        onConfirmDelete={vi.fn()}
      />,
    );

    expect(html).toContain('위험 영역');
    expect(html).toContain('아카이브');
    expect(html).not.toContain('연결 데이터까지 모두 삭제');
  });

  it('isAdmin=true(ADMIN)면 게시 상태 아래에 destructive 톤의 위험 영역 섹션을 그린다', () => {
    const html = renderToStaticMarkup(
      <ProgramEditView
        program={editableProgram}
        form={toProgramEditForm(editableProgram)}
        errors={{}}
        toastMessage={null}
        generalAlert={null}
        isSaving={false}
        milestoneEditor={{ mode: 'closed' }}
        deleteTarget={null}
        expandedDocumentsMilestoneId={null}
        isMilestoneBusy={false}
        {...lifecycleActionProps}
        isAdmin
        onFieldChange={noOp}
        onSubmit={vi.fn()}
        onAddMilestone={noOp}
        onEditMilestone={noOp}
        onCancelMilestone={noOp}
        onMilestoneFieldChange={noOp}
        onSaveMilestone={vi.fn()}
        onRequestDeleteMilestone={noOp}
        onCancelDelete={noOp}
        onConfirmDelete={vi.fn()}
      />,
    );

    const lifecycleIndex = html.indexOf('게시 상태');
    const dangerZoneIndex = html.indexOf('위험 영역');
    expect(lifecycleIndex).toBeGreaterThan(-1);
    expect(dangerZoneIndex).toBeGreaterThan(lifecycleIndex);

    // '삭제' 만으로 찾으면 위 안내문("...영구히 삭제합니다...")에 먼저 걸린다 —
    // 버튼은 '>프로그램 영구 삭제<'로 감싸인 정확한 텍스트라 이걸로 구분한다.
    const buttonStart = html.indexOf('>프로그램 영구 삭제<', dangerZoneIndex);
    expect(buttonStart).toBeGreaterThan(-1);
    const buttonTag = html.slice(Math.max(0, buttonStart - 1200), buttonStart);
    expect(buttonTag).toContain('data-variant="destructive"');
  });
});
