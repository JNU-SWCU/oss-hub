import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { EditableProgram } from './api';
import { buildProgramEditInput, toProgramEditForm } from './program-edit-flow';
import { ProgramEditView } from './program-edit-view';

const noOp = () => undefined;

const individualProgram: EditableProgram = {
  id: 'program-1',
  name: '신입생 SW역량 강화 캠프',
  organizer: 'SW중심대학사업단',
  trackType: 'EXTRACURRICULAR',

  applicationTemplateKey: 'basic',
  lifecycle: 'PUBLISHED',
  applicationTemplateVersion: 1,
  applicationCount: 0,
  applicationStartAt: '2026-08-01T09:30:59.000Z',
  applicationEndAt: '2026-08-15T09:30:59.000Z',
  startAt: '2026-08-16T09:30:59.000Z',
  endAt: '2026-08-31T09:30:59.000Z',
  repositoryProvisioningEnabled: false,
  notifyOnDeadline: false,
  description: '프로그램 설명',
  teamMinSize: 3,
  teamMaxSize: 5,
  milestones: [],
};

const viewProps = {
  errors: {},
  toastMessage: null,
  generalAlert: null,
  isSaving: false,
  milestoneEditor: { mode: 'closed' } as const,
  deleteTarget: null,
  isMilestoneBusy: false,
  canDeleteProgram: false,
  onProgramDeleted: noOp,
  onFieldChange: noOp,
  onAddMilestone: noOp,
  onEditMilestone: noOp,
  onCancelMilestone: noOp,
  onMilestoneFieldChange: noOp,
  onRequestDeleteMilestone: noOp,
  onCancelDelete: noOp,
};

describe('개인형 유형 프로그램의 팀 인원 (#936)', () => {
  it('수정 화면이 참여 유형과 무관하게 팀 인원 칸을 보여 준다', () => {
    const html = renderToStaticMarkup(
      <ProgramEditView
        onCoverChange={() => undefined}
        program={individualProgram}
        form={toProgramEditForm(individualProgram)}
        {...viewProps}
        onSubmit={vi.fn()}
        onSaveMilestone={vi.fn()}
        onConfirmDelete={vi.fn()}
      />,
    );

    expect(html).toContain('id="program-team-min-size"');
    expect(html).toContain('id="program-team-max-size"');
    expect(html).toContain('value="3"');
    expect(html).toContain('value="5"');
  });

  it('저장 payload가 개인형 프로그램의 팀 인원도 그대로 싣는다', () => {
    const form = toProgramEditForm(individualProgram);

    const input = buildProgramEditInput(form, []);

    expect(input).toMatchObject({ teamMinSize: 3, teamMaxSize: 5 });
  });

  it('빈 칸은 0이 아니라 null로 나가 서버에서 변경 없음이 된다', () => {
    const form = {
      ...toProgramEditForm(individualProgram),
      teamMinSize: '',
      teamMaxSize: '',
    };

    const input = buildProgramEditInput(form, []);

    expect(input).toMatchObject({ teamMinSize: null, teamMaxSize: null });
  });
});
