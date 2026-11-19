import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../../../test-support/render-with-query';
import { ProgramMailCompose } from './program-mail-compose';

const applicant = (id: string, mailAvailable: boolean) => ({
  id,
  displayName: id,
  nickname: id,
  mailAvailable,
});
const teams = [
  {
    id: 'one',
    name: 'One',
    status: 'APPROVED' as const,
    deadlineEligible: true,
    applicants: [applicant('eligible', true), applicant('unavailable', false)],
  },
  {
    id: 'two',
    name: 'Two',
    status: 'APPROVED' as const,
    deadlineEligible: false,
    applicants: [applicant('other', true)],
  },
];
let mounted: Awaited<ReturnType<typeof renderWithQuery>> | undefined;
afterEach(async () => {
  await mounted?.unmount();
});

async function render(
  audience: typeof teams,
  selectedIds: readonly string[] = [],
) {
  const selection = vi.fn<(ids: ReadonlySet<string>) => void>();
  mounted = await renderWithQuery(
    <ProgramMailCompose
      model={{
        recipients: {
          programId: 'program',
          programName: 'Program',
          teams: audience,
        },
        selectedIds: new Set(selectedIds),
        subject: '',
        body: '',
      }}
      onChange={{ selection, subject: vi.fn(), body: vi.fn() }}
    />,
  );
  return selection;
}

async function choose(name: string) {
  const button = [...document.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === name,
  );
  if (!button) throw new TypeError('Missing bulk action: ' + name);
  await act(async () => button.click());
}

it.each([
  ['전체 선택', ['eligible', 'other']],
  ['24시간 이내 필수 서류 미제출자 선택', ['eligible']],
] as const)('projects the selected IDs for %s', async (name, ids) => {
  const selection = await render(teams);
  await choose(name);
  expect(selection).toHaveBeenCalledExactlyOnceWith(new Set(ids));
});

it('clears an existing recipient selection', async () => {
  const selection = await render(teams, ['eligible']);
  await choose('선택 해제');
  expect(selection).toHaveBeenCalledExactlyOnceWith(new Set());
});

it('cannot select recipients from an empty audience', async () => {
  const selection = await render([]);
  await choose('전체 선택');
  expect(
    document.querySelector('[role="checkbox"], input[type="checkbox"]'),
  ).toBeNull();
  expect(selection).toHaveBeenCalledExactlyOnceWith(new Set());
});

it('exposes both mail input limits to the browser', async () => {
  await render(teams);
  expect(
    document.querySelector<HTMLInputElement>('#program-mail-subject')
      ?.maxLength,
  ).toBe(200);
  expect(
    document.querySelector<HTMLTextAreaElement>('#program-mail-body')
      ?.maxLength,
  ).toBe(4000);
});
