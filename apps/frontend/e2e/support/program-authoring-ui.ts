import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { e2eEnvironment } from '../environment';
import { expectApiStatus } from './program-authoring-flow';

export const PROGRAM_AUTHORING_CONTROL_PATH = '/api/v1/_e2e/program-authoring';

export type E2eProgramAuthoringGraph = {
  readonly programId: string;
  readonly milestoneId: string;
  readonly documentId: string;
};

export async function resetProgramAuthoringControl(
  page: Page,
): Promise<string> {
  const response = await page.request.post(
    `${PROGRAM_AUTHORING_CONTROL_PATH}/reset`,
  );
  await expectApiStatus(response, 200);
  const value: unknown = await response.json();
  if (
    !isRecord(value) ||
    typeof value.now !== 'string' ||
    !Number.isFinite(Date.parse(value.now))
  )
    throw new Error('E2E reset response must include a valid clock.');
  return value.now;
}

export async function selectScheduleRange(
  page: Page,
  input: {
    readonly rangeLabel: string;
    readonly startAt: string;
    readonly endAt: string;
  },
): Promise<void> {
  await page
    .locator('[data-schedule-range-selector]')
    .filter({ hasText: input.rangeLabel })
    .click();
  const calendar = page.getByLabel(`${input.rangeLabel} 날짜 선택 달력`);
  await selectCalendarDate(calendar, input.startAt.slice(0, 10));
  await selectCalendarDate(calendar, input.endAt.slice(0, 10));
  await page
    .getByRole('button', {
      name: `${input.rangeLabel} 일정 입력`,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel(`${input.rangeLabel} 시작일`)
    .fill(input.startAt.slice(0, 10));
  await dialog
    .getByLabel(`${input.rangeLabel} 시작 시각`)
    .fill(input.startAt.slice(11, 16));
  await dialog
    .getByLabel(`${input.rangeLabel} 종료일`)
    .fill(input.endAt.slice(0, 10));
  await dialog
    .getByLabel(`${input.rangeLabel} 종료 시각`)
    .fill(input.endAt.slice(11, 16));
  await dialog.getByRole('button', { name: '저장' }).click();
}

export async function fixtureProgramId(page: Page): Promise<string> {
  const response = await page.request.get(
    `${PROGRAM_AUTHORING_CONTROL_PATH}/fixture`,
  );
  await expectApiStatus(response, 200);
  const value: unknown = await response.json();
  if (
    !isRecord(value) ||
    typeof value.programId !== 'string' ||
    value.programId.length === 0
  ) {
    throw new Error('E2E fixture must expose its deterministic program id.');
  }
  return value.programId;
}

export async function adoptProgramGraph(
  page: Page,
  programId: string,
): Promise<E2eProgramAuthoringGraph> {
  const response = await page.request.post(
    `${PROGRAM_AUTHORING_CONTROL_PATH}/adopt`,
    { data: { programId } },
  );
  await expectApiStatus(response, 201);
  return graph(await response.json());
}

export function assertAdoptedProgramId(
  graph: E2eProgramAuthoringGraph,
  programId: string,
): void {
  if (graph.programId !== programId) {
    throw new Error('Adopted graph does not match the UI-created program.');
  }
}

export function programIdFromDetailUrl(value: string): string | null {
  const segments = new URL(value).pathname.split('/').filter(Boolean);
  const [root, encodedProgramId] = segments;
  if (
    segments.length !== 2 ||
    root !== 'programs' ||
    encodedProgramId === undefined ||
    encodedProgramId === 'new'
  ) {
    return null;
  }
  return decodeURIComponent(encodedProgramId);
}

export async function uploadFixtureTemplate(
  page: Page,
  milestoneId: string,
  documentId: string,
): Promise<void> {
  await expectApiStatus(
    await page.request.post(
      `/api/v1/milestones/${encodeURIComponent(milestoneId)}/documents/${encodeURIComponent(documentId)}/template`,
      {
        headers: originHeaders(),
        multipart: {
          file: {
            name: 'fixture-template.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-1.4\ntemplate\n'),
          },
        },
      },
    ),
    201,
  );
}

export async function submitProgramApplication(
  page: Page,
  programId: string,
  mode: 'new' | 'own',
): Promise<void> {
  await page.goto(`/programs/${encodeURIComponent(programId)}/apply`);
  await page.getByLabel('제목 *').fill(`E2E ${mode} 신청`);
  await page.getByLabel('요약 *').fill('결정론적 신청 데이터');
  await page
    .getByRole('radio', {
      name: mode === 'new' ? '새 저장소 발급받기' : '내 저장소 연결하기',
    })
    .check();
  if (mode === 'own') {
    await page
      .getByLabel('연결할 저장소 URL')
      .fill('https://github.com/e2e-org/owned-public');
  }
  await page.getByLabel(/개인정보 수집·이용 동의/).check();
  await page.getByRole('button', { name: '신청 제출' }).click();
  await page.getByRole('button', { name: '신청서 제출' }).click();
  await expect(page.getByText('신청이 접수되었습니다')).toBeVisible();
}

export function originHeaders(): { readonly Origin: string } {
  return { Origin: e2eEnvironment.baseUrl };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function graph(value: unknown): E2eProgramAuthoringGraph {
  if (!isRecord(value))
    throw new Error('E2E graph response must be an object.');
  const programId = identifier(value, 'programId');
  const milestoneId = identifier(value, 'milestoneId');
  const documentId = identifier(value, 'documentId');
  return { programId, milestoneId, documentId };
}

function identifier(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`E2E graph field ${key} must be a non-empty string.`);
  }
  return value;
}

async function selectCalendarDate(
  calendar: ReturnType<Page['getByLabel']>,
  date: string,
): Promise<void> {
  const target = calendar.locator(`[data-calendar-date="${date}"]`);
  for (let month = 0; month < 24; month += 1) {
    if ((await target.count()) > 0) {
      await target.click();
      return;
    }
    const next = calendar.getByRole('button', { name: '다음 달' });
    await expect(next).toBeEnabled();
    await next.click();
  }
  throw new Error(`Calendar did not reach ${date}.`);
}
