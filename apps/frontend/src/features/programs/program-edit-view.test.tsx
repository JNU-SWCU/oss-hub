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
import { ProgramEditView } from './program-edit-view';

const noOp = () => undefined;

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
  it('renders locked category, template metadata, milestone actions, and cancel detail link', () => {
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
    expect(html).toContain('id="program-end-at"');
    expect(html).toContain('프로그램 종료');
    expect(html).toContain('oss-contest');
    expect(html).toContain('v1');
    expect(html).toContain('milestone-canonical-id');
    expect(html).toContain('기획서 제출');
    expect(html).toContain('TEXT');
    expect(html).toContain('수정');
    expect(html).toContain('삭제');
    expect(html).toContain('href="/programs/program-1"');
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
        toastMessage="저장되었습니다. 상세 화면으로 이동합니다."
        generalAlert="제출물이 있는 마일스톤은 삭제할 수 없습니다."
        isSaving={false}
        milestoneEditor={{ mode: 'closed' }}
        deleteTarget={editableProgram.milestones[0]}
        expandedDocumentsMilestoneId={null}
        isMilestoneBusy={false}
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
    expect(html).toContain('저장되었습니다');
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

    const input = buildProgramEditInput(form, true, ['endAt']);

    expect(input.endAt).toBe(new Date(form.endAt).toISOString());
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
      buildProgramEditInput(form, true, ['endAt']);
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

    expect(buildProgramEditInput(form, true, ['endAtUndecided']).endAt).toBe(
      PROGRAM_END_AT_UNDECIDED,
    );
  });

  it.each([
    ['application end', '2026-08-15T09:30'],
    ['milestone due', '2026-08-20T12:30'],
  ])('rejects a program end at the %s boundary', (_label, endAt) => {
    const form = { ...toProgramEditForm(editableProgram), endAt };

    let error: unknown;
    try {
      buildProgramEditInput(form, true, ['endAt']);
    } catch (caught) {
      error = caught;
    }

    expect(mapProgramEditError(error).endAt).toContain(
      '신청 종료일과 모든 마일스톤 마감 이후',
    );
  });
});
