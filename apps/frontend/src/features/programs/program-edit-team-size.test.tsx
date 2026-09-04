import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { EditableProgram } from './api';
import { buildProgramEditInput, toProgramEditForm } from './program-edit-flow';
import { ProgramEditView } from './program-edit-view';

const noOp = () => undefined;

/**
 * 참여 유형이 **개인형**인 템플릿(`basic`)을 쓰면서 팀 인원이 1..1 이 아닌 프로그램이다.
 * #936 이 만들어진 자리가 정확히 여기다 — 수정 화면이 팀 인원 칸을 렌더하지 않아
 * 교직원이 다른 항목만 고쳐도 정원이 1..1 로 깎였다.
 */
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
  expandedDocumentsMilestoneId: null,
  isMilestoneBusy: false,
  isLifecycleBusy: false,
  isLifecycleConfirming: false,
  lifecycleError: null,
  canDeleteProgram: false,
  onRequestLifecycleToggle: noOp,
  onCancelLifecycleToggle: noOp,
  onConfirmLifecycleToggle: noOp,
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
    // Given / When
    const html = renderToStaticMarkup(
      <ProgramEditView
        program={individualProgram}
        form={toProgramEditForm(individualProgram)}
        {...viewProps}
        onSubmit={vi.fn()}
        onSaveMilestone={vi.fn()}
        onConfirmDelete={vi.fn()}
      />,
    );

    // Then: 칸이 있어야 교직원이 정원을 고칠 수 있다.
    expect(html).toContain('id="program-team-min-size"');
    expect(html).toContain('id="program-team-max-size"');
    expect(html).toContain('value="3"');
    expect(html).toContain('value="5"');
  });

  it('저장 payload가 개인형 프로그램의 팀 인원도 그대로 싣는다', () => {
    // Given
    const form = toProgramEditForm(individualProgram);

    // When
    const input = buildProgramEditInput(form, []);

    // Then: 예전에는 여기가 null 이었고, 서버가 그것을 1..1 로 해석했다.
    expect(input).toMatchObject({ teamMinSize: 3, teamMaxSize: 5 });
  });

  it('빈 칸은 0이 아니라 null로 나가 서버에서 변경 없음이 된다', () => {
    // Given: 값이 비어 있는 폼. `Number('')`는 0이라 그대로 실으면 저장이 거부된다.
    const form = {
      ...toProgramEditForm(individualProgram),
      teamMinSize: '',
      teamMaxSize: '',
    };

    // When
    const input = buildProgramEditInput(form, []);

    // Then
    expect(input).toMatchObject({ teamMinSize: null, teamMaxSize: null });
  });
});
