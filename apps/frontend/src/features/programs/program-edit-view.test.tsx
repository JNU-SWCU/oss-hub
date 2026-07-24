import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { EditableProgram } from './api';
import { toProgramEditForm, type ProgramEditErrors } from './program-edit-flow';
import { ProgramEditView } from './program-edit-view';

const noOp = () => undefined;

const editableProgram: EditableProgram = {
  id: 'program-1',
  name: 'OSS 경진대회',
  organizer: 'SW중심대학사업단',
  category: 'OSS_CONTEST',
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
  repositoryProvisioningEnabled: true,
  description: '프로그램 설명',
  teamMinSize: 2,
  teamMaxSize: 4,
  milestones: [
    {
      id: 'milestone-canonical-id',
      name: '기획서 제출',
      dueAt: '2026-08-20T12:30:59.000Z',
      submissionType: 'REPOSITORY_RELEASE',
      instructions: '릴리스 태그를 제출해 주세요.',
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
    expect(html).toContain('oss-contest');
    expect(html).toContain('v1');
    expect(html).toContain('milestone-canonical-id');
    expect(html).toContain('기획서 제출');
    expect(html).toContain('REPOSITORY_RELEASE');
    expect(html).toContain('수정');
    expect(html).toContain('삭제');
    expect(html).toContain('href="/programs/program-1"');
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
});
