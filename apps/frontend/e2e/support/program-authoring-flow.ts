import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import type { APIResponse, Download, Page } from '@playwright/test';

const ONE_HOUR_MS = 60 * 60 * 1000;
// 캘린더에 고정된 날짜 대신 실행 시점 벽시계 기준 +2시간을 고정 앵커로 삼는다 —
// 테스트 전체가 끝날 때까지 신청/운영 기간이 실행 중 닫히지 않을 만큼만 여유를 두고, 백엔드
// 마감 알림 판정 창(deadlineWindow, `실행 시점~+24시간`)에 마일스톤 마감(앵커+9시간)이 들어오게
// 한다. KST 자정 경계를 넘어 실행되는 잔여 위험은 인지된 트레이드오프다.
const scheduleAnchor = new Date(Date.now() + 2 * ONE_HOUR_MS);

export const PROGRAM_AUTHORING_E2E = {
  now: scheduleAnchor.toISOString(),
  seoulNow: toSeoulOffsetIso(scheduleAnchor),
  artifactRoot: '.omo/artifacts/program-authoring-and-document-flow/12-e2e',
  programName: 'e2e:program-authoring:happy-program',
  requiredDocumentName: 'e2e:program-authoring:required-document',
  informationalMilestoneName: 'e2e:program-authoring:information-milestone',
  requiredMilestoneName: 'e2e:program-authoring:required-milestone',
  actors: {
    staff: BigInt('8100001'),
    student: BigInt('8100002'),
    foreignStudent: BigInt('8100003'),
  },
} as const;

export type DownloadedArtifact = {
  readonly name: string;
  readonly sha256: string;
  readonly size: number;
  readonly bytes: Buffer;
};

export type E2eProgramAuthoringState = {
  readonly programs: number;
  readonly milestones: number;
  readonly documents: number;
  readonly applications: number;
  readonly teams: number;
  readonly repositoryJobs: number;
  readonly repositories: number;
  readonly notifications: number;
  readonly dryRunEnvelopes: number;
  readonly attachedFiles: number;
  readonly orphanRows: number;
  readonly orphanObjects: number;
  readonly mailContentHashes: readonly string[];
  readonly storageContentHashes: readonly string[];
};

export type DeadlinePreview = {
  readonly previewedAt: string;
  readonly previewVersion: string;
  readonly applicationCount: number;
  readonly milestoneCount: number;
  readonly recipientCount: number;
  readonly inactiveCount: number;
  readonly optedOutCount: number;
  readonly noEmailCount: number;
};

/**
 * `PROGRAM_AUTHORING_E2E.seoulNow`(또는 그 오프셋)를 `datetime-local` 입력 필드에
 * 그대로 채워 넣을 수 있는 `YYYY-MM-DDTHH:mm` 문자열로 변환한다. 브라우저 컨텍스트가
 * `timezoneId: 'Asia/Seoul'`로 고정되어 있으므로 값도 서울 로컬 시각으로 맞춰야 한다.
 */
export function seoulLocalInput(isoInstant: string, offsetMs = 0): string {
  const instant = new Date(new Date(isoInstant).getTime() + offsetMs);
  return formatSeoulDatetimeLocal(instant);
}

function toSeoulOffsetIso(date: Date): string {
  return `${formatSeoulDatetimeLocal(date)}:00+09:00`;
}

function formatSeoulDatetimeLocal(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  // 일부 ICU 구현은 hour12:false에서 자정을 "24"로 표기한다 — "00"으로 정규화한다.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

export async function expectApiStatus(
  response: APIResponse,
  status: number,
): Promise<void> {
  if (response.status() !== status) {
    throw new Error(`Expected HTTP ${status}, received ${response.status()}.`);
  }
}

export async function downloadedArtifact(
  page: Page,
  label: string | RegExp,
): Promise<DownloadedArtifact> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: label }).click();
  return artifactForDownload(await downloadPromise);
}

export async function artifactForResponse(
  response: APIResponse,
): Promise<DownloadedArtifact> {
  const bytes = Buffer.from(await response.body());
  const disposition = response.headers()['content-disposition'] ?? '';
  return artifact(bytes, suggestedFilename(disposition));
}

export function toStateCounts(value: unknown): E2eProgramAuthoringState {
  const record = recordValue(value, 'E2E state response');
  return {
    programs: count(record, 'programs'),
    milestones: count(record, 'milestones'),
    documents: count(record, 'documents'),
    applications: count(record, 'applications'),
    teams: count(record, 'teams'),
    repositoryJobs: count(record, 'repositoryJobs'),
    repositories: count(record, 'repositories'),
    notifications: count(record, 'notifications'),
    dryRunEnvelopes: count(record, 'dryRunEnvelopes'),
    attachedFiles: count(record, 'attachedFiles'),
    orphanRows: count(record, 'orphanRows'),
    orphanObjects: count(record, 'orphanObjects'),
    mailContentHashes: hashes(record, 'mailContentHashes'),
    storageContentHashes: hashes(record, 'storageContentHashes'),
  };
}

export function parseDeadlinePreview(value: unknown): DeadlinePreview {
  const record = recordValue(value, 'Deadline preview response');
  return {
    previewedAt: nonEmptyString(record, 'previewedAt'),
    previewVersion: sha256(record, 'previewVersion'),
    applicationCount: count(record, 'applicationCount'),
    milestoneCount: count(record, 'milestoneCount'),
    recipientCount: count(record, 'recipientCount'),
    inactiveCount: count(record, 'inactiveCount'),
    optedOutCount: count(record, 'optedOutCount'),
    noEmailCount: count(record, 'noEmailCount'),
  };
}

export function expectCleanState(
  state: E2eProgramAuthoringState,
  expectedApplications = 1,
  expectedMilestones = 1,
  // Application.teamId는 non-null이라 신청마다 팀이 하나씩 붙는다(개인형도 1인 팀,
  // D5) — 취소된 신청은 Application만 하드 삭제되고 Team은 onDelete: Restrict로
  // 남으므로, 시나리오에 취소가 섞이면 teams가 applications보다 커질 수 있다.
  expectedTeams = expectedApplications,
  // 수동 발송(`sendProgramFromPreview`)은 미제출 학생 리마인드와 교직원 요약을
  // 각각 한 통씩 보낸다 — 내용이 다르므로 봉투도 해시도 갈린다. 기본값 1은
  // 교직원이 수신 대상이 아닌(비활성·수신 거부·이메일 없음) 시나리오 기준이고,
  // 교직원이 실제로 받는 시나리오는 호출부에서 2를 넘긴다.
  expectedMailEnvelopes = 1,
  expectedDocuments = 1,
): void {
  if (
    state.programs !== 1 ||
    state.milestones !== expectedMilestones ||
    state.documents !== expectedDocuments
  ) {
    throw new Error(
      'Expected one deterministic program and the requested submission items ' +
        `(programs=${state.programs}, milestones=${state.milestones}, ` +
        `documents=${state.documents}).`,
    );
  }
  if (
    state.applications !== expectedApplications ||
    state.teams !== expectedTeams
  ) {
    throw new Error(
      'Expected the requested individual application graph ' +
        `(applications=${state.applications}, teams=${state.teams}).`,
    );
  }
  if (state.repositoryJobs !== 1 || state.repositories !== 1) {
    throw new Error(
      'Expected exactly one provisioned NEW repository ' +
        `(repositoryJobs=${state.repositoryJobs}, repositories=${state.repositories}).`,
    );
  }
  if (
    state.dryRunEnvelopes !== expectedMailEnvelopes ||
    state.mailContentHashes.length !== expectedMailEnvelopes
  ) {
    throw new Error(
      `Expected ${expectedMailEnvelopes} deduplicated sanitized mail ` +
        `envelope(s) (dryRunEnvelopes=${state.dryRunEnvelopes}, ` +
        `mailContentHashes=${state.mailContentHashes.length}).`,
    );
  }
  if (state.attachedFiles < 2 || state.storageContentHashes.length < 2) {
    throw new Error(
      'Expected persisted template and current file bytes ' +
        `(attachedFiles=${state.attachedFiles}, ` +
        `storageContentHashes=${state.storageContentHashes.length}).`,
    );
  }
  if (state.orphanRows !== 0 || state.orphanObjects !== 0) {
    throw new Error(
      'Expected no orphan upload rows or storage objects ' +
        `(orphanRows=${state.orphanRows}, orphanObjects=${state.orphanObjects}).`,
    );
  }
}

export async function writeArtifact(
  name: string,
  value: unknown,
): Promise<void> {
  const root = resolve(
    process.env.E2E_ARTIFACT_DIR ?? PROGRAM_AUTHORING_E2E.artifactRoot,
  );
  const target = resolve(root, name);
  if (relative(root, target).startsWith('..')) {
    throw new Error(
      'Artifact target must stay inside the E2E artifact directory.',
    );
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function artifactForDownload(
  download: Download,
): Promise<DownloadedArtifact> {
  const failure = await download.failure();
  if (failure !== null) throw new Error(`Download failed: ${failure}`);
  const path = await download.path();
  if (path === null)
    throw new Error('Playwright did not retain downloaded bytes.');
  return artifact(await readFile(path), download.suggestedFilename());
}

function artifact(bytes: Buffer, name: string): DownloadedArtifact {
  return {
    name,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
    bytes,
  };
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`E2E state field ${key} must be a non-negative integer.`);
  }
  return value;
}

function hashes(
  record: Record<string, unknown>,
  key: string,
): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => isSha256(item))) {
    throw new Error(`E2E state field ${key} must be SHA-256 hashes.`);
  }
  return value;
}

function nonEmptyString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Response field ${key} must be a non-empty string.`);
  }
  return value;
}

function sha256(record: Record<string, unknown>, key: string): string {
  const value = nonEmptyString(record, key);
  if (!isSha256(value))
    throw new Error(`Response field ${key} must be SHA-256.`);
  return value;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function suggestedFilename(disposition: string): string {
  const match = /filename="?([^";]+)"?/u.exec(disposition);
  return match?.[1] ?? 'download';
}
