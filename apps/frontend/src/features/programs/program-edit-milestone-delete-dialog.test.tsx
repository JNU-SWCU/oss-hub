import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EditableMilestone } from './api';
import { ProgramEditMilestones } from './program-edit-milestones';

const noOp = () => undefined;

const milestone: EditableMilestone = {
  id: 'milestone-1',
  name: '기획서 제출',
  startAt: '2026-08-16T09:30:59.000Z',
  dueAt: '2026-08-20T12:30:59.000Z',
  submissionType: 'TEXT',
  instructions: null,
};

function renderDeleteDialog(): string {
  return renderToStaticMarkup(
    <ProgramEditMilestones
      milestones={[milestone]}
      editor={{ mode: 'closed' }}
      deleteTarget={milestone}
      operationStartAt="2026-08-16T09:30:59.000Z"
      operationEndAt="2026-08-31T09:30:59.000Z"
      contextEvents={[]}
      isBusy={false}
      canonicalDocumentsByMilestoneId={new Map([[milestone.id, []]])}
      onAdd={noOp}
      onEdit={noOp}
      onCancelEdit={noOp}
      onFieldChange={noOp}
      onSave={noOp}
      onRequestDelete={noOp}
      onCancelDelete={noOp}
      onConfirmDelete={noOp}
    />,
  );
}

describe('milestone delete confirmation copy', () => {
  it('states the irreversible outcome in the title', () => {
    const html = renderDeleteDialog();

    expect(html).toContain('마일스톤을 되돌릴 수 없이 삭제할까요?');
  });

  it('states template unavailability without promising storage deletion', () => {
    const html = renderDeleteDialog();

    expect(html).toContain(
      '양식 파일은 OSS Hub에서 더 이상 이용할 수 없습니다.',
    );
    expect(html).not.toContain('양식 파일도 함께 삭제됩니다');
  });

  it('keeps the server-side refusal rule visible', () => {
    const html = renderDeleteDialog();

    expect(html).toContain(
      '학생이 올린 제출물이 하나라도 있으면 삭제되지 않습니다.',
    );
  });

  it('does not repeat the title in the description', () => {
    const html = renderDeleteDialog();

    expect(html).not.toContain(`${milestone.name} 마일스톤을 삭제합니다`);
  });

  it('lets assistive technology read the warning as the dialog description', () => {
    const html = renderDeleteDialog();

    expect(html).toContain('aria-describedby="milestone-delete-description"');
    expect(html).toContain('id="milestone-delete-description"');
  });
});
