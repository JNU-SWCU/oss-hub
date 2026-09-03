// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgramEditBasicForm } from './program-edit-basic-form';
import type { EditableProgram } from './api';
import type { ProgramEditForm } from './program-edit-flow';

function programFixture(participation: 'individual' | 'team'): EditableProgram {
  return {
    id: 'synthetic-program',
    name: '합성 프로그램',
    organizer: '합성 사업단',
    trackType: 'CURRICULAR',
    lifecycle: 'PUBLISHED',
    applicationTemplateKey: participation === 'team' ? 'capstone' : 'basic',
    applicationTemplateVersion: 1,
    applicationCount: 0,
    applicationStartAt: '2026-08-01T00:00:00.000Z',
    applicationEndAt: '2026-08-31T09:00:00.000Z',
    startAt: '2026-09-01T09:00:00.000Z',
    endAt: '2026-12-31T09:00:00.000Z',
    repositoryProvisioningEnabled: true,
    notifyOnDeadline: true,
    description: '합성 설명',
    teamMinSize: participation === 'team' ? 2 : 1,
    teamMaxSize: participation === 'team' ? 4 : 1,
    milestones: [],
  };
}

function formFixture(): ProgramEditForm {
  return {
    name: '합성 프로그램',
    organizer: '합성 사업단',
    trackType: 'CURRICULAR',
    applicationStartAt: '2026-08-01T09:00',
    applicationEndAt: '2026-08-31T18:00',
    startAt: '2026-09-01T09:00',
    originalStartAt: '2026-09-01T09:00',
    endAt: '2026-12-31T18:00',
    endAtUndecided: false,
    originalApplicationStartAt: '2026-08-01T09:00',
    originalApplicationEndAt: '2026-08-31T18:00',
    originalEndAt: '2026-12-31T18:00',
    milestoneStartAts: [],
    milestoneDueAts: [],
    repositoryProvisioningEnabled: true,
    notifyOnDeadline: true,
    description: '합성 설명',
    teamMinSize: '2',
    teamMaxSize: '4',
  };
}

function inputsWithoutAccessibleName(html: string): readonly string[] {
  const container = document.createElement('div');
  container.innerHTML = html;
  const labelled = new Set(
    [...container.querySelectorAll('label[for]')].map(
      (label) => label.getAttribute('for') ?? '',
    ),
  );
  return [...container.querySelectorAll('input, select, textarea')]
    .filter((element) => {
      if (element.getAttribute('type') === 'hidden') return false;
      if (element.hasAttribute('aria-label')) return false;
      if (element.hasAttribute('aria-labelledby')) return false;
      const id = element.getAttribute('id');
      if (id !== null && labelled.has(id)) return false;
      return element.closest('label') === null;
    })
    .map((element) => {
      const type = element.getAttribute('type') ?? 'text';
      return `${element.tagName.toLowerCase()}[type=${type}]`;
    });
}

function render(participation: 'individual' | 'team'): string {
  return renderToStaticMarkup(
    <ProgramEditBasicForm
      program={programFixture(participation)}
      form={formFixture()}
      errors={{}}
      isSaving={false}
      onFieldChange={() => undefined}
      onSubmit={() => undefined}
    />,
  );
}

describe('프로그램 편집 폼의 입력 이름표', () => {
  it('팀형 프로그램에서 이름표 없는 입력이 하나도 없다', () => {
    expect(inputsWithoutAccessibleName(render('team'))).toEqual([]);
  });

  it('개인형 프로그램에서도 이름표 없는 입력이 없다', () => {
    expect(inputsWithoutAccessibleName(render('individual'))).toEqual([]);
  });

  it('검사기 자체가 동작한다 — 이름표 없는 입력을 실제로 잡아낸다', () => {
    expect(
      inputsWithoutAccessibleName('<input type="datetime-local" />'),
    ).toEqual(['input[type=datetime-local]']);
  });
});
