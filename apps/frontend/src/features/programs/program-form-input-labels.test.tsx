// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgramEditBasicForm } from './program-edit-basic-form';
import type { EditableProgram } from './api';
import type { ProgramEditForm } from './program-edit-flow';
import type { ProgramCategory } from './program-templates';

/**
 * 프로그램 편집 폼의 모든 입력이 **접근 가능한 이름**을 갖는지 검사한다.
 *
 * 편집 화면의 「신청 기간」 날짜 2개와 「팀 인원」 숫자 2개에 `id`·`htmlFor`·
 * `aria-label` 이 전부 없었다(QA13). 화면 읽기 도구에는 이름 없는 상자 넷으로만
 * 들리고, 눈으로 봐도 어느 쪽이 시작이고 어느 쪽이 마감인지 순서로 짐작해야 했다.
 * **같은 저장소의 생성 화면은 처음부터 제대로 돼 있었다** — 편집만 빠져 있었다.
 *
 * 그래서 입력을 하나씩 세지 않고 **폼 전체를 훑어** 이름 없는 입력이 0개인지 본다.
 * 새 입력을 붙일 때 이름표를 빠뜨리면 여기서 걸린다 — 이 결함은 «한 번 고치면 끝» 이
 * 아니라 «폼이 자랄 때마다 다시 생기는» 종류다.
 */

function programFixture(category: ProgramCategory): EditableProgram {
  return {
    categoryLocked: {
      locked: false,
      byApplications: false,
      byTeams: false,
      applicationCount: 0,
      teamCount: 0,
    },
    id: 'synthetic-program',
    name: '합성 프로그램',
    organizer: '합성 사업단',
    category,
    lifecycle: 'PUBLISHED',
    applicationTemplateKey: 'capstone',
    applicationTemplateVersion: 1,
    applicationCount: 0,
    applicationStartAt: '2026-08-01T00:00:00.000Z',
    applicationEndAt: '2026-08-31T09:00:00.000Z',
    endAt: '2026-12-31T09:00:00.000Z',
    repositoryProvisioningEnabled: true,
    description: '합성 설명',
    teamMinSize: 2,
    teamMaxSize: 4,
    milestones: [],
  };
}

function formFixture(category: ProgramCategory): ProgramEditForm {
  return {
    name: '합성 프로그램',
    organizer: '합성 사업단',
    category,
    applicationStartAt: '2026-08-01T09:00',
    applicationEndAt: '2026-08-31T18:00',
    endAt: '2026-12-31T18:00',
    originalApplicationStartAt: '2026-08-01T09:00',
    originalApplicationEndAt: '2026-08-31T18:00',
    originalEndAt: '2026-12-31T18:00',
    milestoneDueAts: [],
    repositoryProvisioningEnabled: true,
    description: '합성 설명',
    teamMinSize: '2',
    teamMaxSize: '4',
  };
}

/** `<label for>` · `aria-label` · `aria-labelledby` · 감싸는 `<label>` 중 하나라도 있으면 이름이 있다. */
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

function render(category: ProgramCategory): string {
  return renderToStaticMarkup(
    <ProgramEditBasicForm
      program={programFixture(category)}
      form={formFixture(category)}
      errors={{}}
      isSaving={false}
      onFieldChange={() => undefined}
      onSubmit={() => undefined}
    />,
  );
}

describe('프로그램 편집 폼의 입력 이름표', () => {
  // 팀형 — 「팀 인원」 입력 2개가 함께 그려진다.
  it('팀형 프로그램에서 이름표 없는 입력이 하나도 없다', () => {
    expect(inputsWithoutAccessibleName(render('CAPSTONE'))).toEqual([]);
  });

  // 개인형 — 팀 인원 블록이 빠진 상태에서도 나머지가 온전한지.
  it('개인형 프로그램에서도 이름표 없는 입력이 없다', () => {
    expect(inputsWithoutAccessibleName(render('BASIC'))).toEqual([]);
  });

  it('검사기 자체가 동작한다 — 이름표 없는 입력을 실제로 잡아낸다', () => {
    expect(
      inputsWithoutAccessibleName('<input type="datetime-local" />'),
    ).toEqual(['input[type=datetime-local]']);
  });
});
