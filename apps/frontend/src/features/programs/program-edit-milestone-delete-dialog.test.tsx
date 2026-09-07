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

/**
 * 마일스톤 삭제는 되돌릴 수 없다 — 확인창은 그 사실을 반드시 말해야 한다.
 * 종전 문구(「마일스톤 삭제」 / 「… 마일스톤을 삭제합니다. 제출물이 있으면 삭제할 수
 * 없습니다.」)는 언제 막히는지만 말하고 무엇이 사라지는지는 말하지 않았다.
 */
describe('milestone delete confirmation copy', () => {
  it('states the irreversible outcome in the title', () => {
    // Given / When
    const html = renderDeleteDialog();

    // Then
    expect(html).toContain('마일스톤을 되돌릴 수 없이 삭제할까요?');
  });

  it('names what disappears with the milestone', () => {
    // Given / When
    const html = renderDeleteDialog();

    // Then
    expect(html).toContain(
      `${milestone.name}에 등록된 제출 항목과 양식 파일도 함께 삭제됩니다.`,
    );
  });

  it('keeps the server-side refusal rule visible', () => {
    // Given / When
    const html = renderDeleteDialog();

    // Then
    expect(html).toContain(
      '학생이 올린 제출물이 하나라도 있으면 삭제되지 않습니다.',
    );
  });

  it('does not repeat the title in the description', () => {
    // Given / When
    const html = renderDeleteDialog();

    // Then
    expect(html).not.toContain(`${milestone.name} 마일스톤을 삭제합니다`);
  });

  it('lets assistive technology read the warning as the dialog description', () => {
    // Given / When
    const html = renderDeleteDialog();

    // Then
    expect(html).toContain('aria-describedby="milestone-delete-description"');
    expect(html).toContain('id="milestone-delete-description"');
  });
});
