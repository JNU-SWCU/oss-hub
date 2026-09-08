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

const lifecycleActionProps = {
  canDeleteProgram: false,
  onProgramDeleted: noOp,
};

const editableProgram: EditableProgram = {
  id: 'program-1',
  name: 'OSS 경진대회',
  organizer: 'SW중심대학사업단',
  trackType: 'EXTRACURRICULAR',
  lifecycle: 'PUBLISHED',
  applicationTemplateKey: 'oss-contest',
  applicationTemplateVersion: 1,
  applicationCount: 3,
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

  it('renders track type, template metadata, milestone actions, and the exit link', () => {
    const html = renderToStaticMarkup(
      <ProgramEditView
        program={editableProgram}
        form={toProgramEditForm(editableProgram)}
        errors={fieldErrors}
        toastMessage={null}
        generalAlert={null}
        isSaving={false}
        milestoneEditor={{ mode: 'closed' }}
        deleteTarget={null}
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

    expect(html).toContain('비교과');
    expect(html).not.toContain('id="program-application-start-at"');
    expect(html).toContain('data-program-schedule-summaries');
    const basicFieldsEnd = html.indexOf('마감 알림');
    const scheduleSection = html.indexOf('신청 · 운영 일정');
    const programSave = html.indexOf('프로그램 정보 저장');
    expect(basicFieldsEnd).toBeGreaterThan(-1);
    expect(scheduleSection).toBeGreaterThan(basicFieldsEnd);
    expect(programSave).toBeGreaterThan(scheduleSection);
    expect(html).toContain(
      '기본 정보, 신청·운영 일정, 저장소와 알림 설정을 함께 저장합니다.',
    );
    expect(html).toContain('id="program-save-scope" class="sr-only"');
    expect(html).toContain('aria-describedby="program-save-scope"');
    expect(html).toContain('신청 기간 수정');
    expect(html).toContain('운영 기간 수정');
    expect(html).toContain('class="inline-flex size-11');
    expect(html).toContain('data-slot="tooltip-trigger"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="application-schedule-error"');
    expect(html).toContain('신청 기간을 확인해 주세요.');
    expect(html).not.toContain('시간 변경');
    expect(html).not.toContain('신청·운영·마일스톤 일정');
    expect(html).not.toContain('날짜 선택 달력');
    expect(html).not.toContain('oss-contest');
    expect(html).toContain('OSS경진대회 신청서');
    expect(html).toContain('v1');
    expect(html).toContain('milestone-canonical-id');
    expect(html).toContain('기획서 제출');
    expect(html).toContain('신청 기간');
    expect(html).toContain('2026년 8월 1일 (토요일)');
    expect(html).not.toContain('TEXT');
    expect(html).toContain('aria-label="기획서 제출 수정"');
    expect(html).toContain('aria-label="기획서 제출 삭제"');
    expect(html).toContain('data-canonical-id="milestone-canonical-id"');
    expect(html).toContain('시작');
    expect(html).toContain('마감');
    expect(html).toContain('운영자 공지');
    expect(html).not.toContain('제출 안내가 없습니다.');
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
  it('keeps track type editable regardless of team count', () => {
    const teamOnlyProgram = {
      ...editableProgram,
      applicationCount: 0,
    };
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

    expect(html).toContain('교과/비교과');
    expect(html).not.toContain('유형을 변경할 수 없습니다');
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
    ['milestone due', '2026-08-20T12:30', '모든 마일스톤 마감과 같거나 이후'],
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
    expect(footer).toContain('프로그램 정보 저장');
  });

  it.each(['PUBLISHED', 'ARCHIVED'] as const)(
    '%s 프로그램은 권한이 있으면 삭제 섹션만 보여준다',
    (lifecycle) => {
      const program = { ...editableProgram, lifecycle };
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
          isMilestoneBusy={false}
          {...lifecycleActionProps}
          canDeleteProgram
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
      expect(html).toContain('>프로그램 삭제<');
      expect(html.match(/>프로그램 삭제</g)).toHaveLength(1);
      expect(html).not.toContain('게시 상태');
      expect(html).not.toContain('프로그램 내리기');
      expect(html).not.toContain('다시 게시하기');
      expect(html).not.toContain('프로그램 복구하기');
    },
  );

  it('canDeleteProgram=false면 삭제 섹션과 아카이브 안내를 모두 숨긴다', () => {
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

    expect(html).not.toContain('위험 영역');
    expect(html).not.toContain('아카이브');
    expect(html).not.toContain('프로그램 삭제');
  });
});
