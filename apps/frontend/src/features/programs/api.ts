import { ApiError, apiClient } from '@/lib/api-client';
import { PROGRAM_EDIT_ERROR_CODES } from './program-edit-error-codes';
import type { ProgramTrackType } from './program-templates';
import { parseStaffDashboardSummary } from './staff-dashboard-parser';
import type {
  ApplicationFormField,
  ApplicationFormFieldKey,
  ApplicationFormFieldType,
  ApplicationFormTemplate,
  ApplicationListItem,
  ApplicationListPage,
  ApplicationListParams,
  ProgramActivity,
  ProgramDetail,
  ProgramListPage,
  ProgramListParams,
  ProgramStatusCounts,
  RepositoryProvisioning,
  StaffProgramTeam,
  StaffTeamDetail,
  ProgramParticipation,
  StaffDashboardSummary,
  SubmissionType,
} from './types';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

interface ApplicationTemplateApiItem {
  readonly key: string;
  readonly version: number;
  readonly name: string;
  readonly participation: 'INDIVIDUAL' | 'TEAM' | ProgramParticipation;
  readonly fields: readonly {
    readonly key: ApplicationFormFieldKey;
    readonly type: ApplicationFormFieldType;
    readonly label: string;
    readonly required: boolean;
  }[];
}

interface ApplicationTemplateListApiResponse {
  readonly items: readonly ApplicationTemplateApiItem[];
}

function mapParticipation(
  value: ApplicationTemplateApiItem['participation'],
): ProgramParticipation {
  void value;
  return 'team';
}

function mapApplicationTemplate(
  item: ApplicationTemplateApiItem,
): ApplicationFormTemplate {
  const fields: ApplicationFormField[] = item.fields.map((field) => ({
    key: field.key,
    type: field.type,
    label: field.label,
    required: field.required,
  }));
  return {
    key: item.key,
    version: item.version,
    name: item.name,
    participation: mapParticipation(item.participation),
    fields,
  };
}

export function listApplicationTemplates(): Promise<
  readonly ApplicationFormTemplate[]
> {
  return apiClient<ApplicationTemplateListApiResponse>(
    'programs/application-templates',
  ).then((response) => response.items.map(mapApplicationTemplate));
}

export interface CreateProgramInput {
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly endAt: string;
  readonly teamMinSize: number | null;
  readonly teamMaxSize: number | null;
  readonly description: string;
}

export interface CreatedProgram {
  readonly id: string;
  readonly trackType: ProgramTrackType;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly detailUrl: string;
}

export interface EditableMilestone {
  readonly id: string;
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly submissionType: SubmissionType | null;
  readonly instructions: string | null;
}

export interface EditableMilestoneDocument {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly templateFileName: string | null;
}

export interface EditableMilestoneEditSnapshot {
  readonly milestone: EditableMilestone;
  readonly operation: {
    readonly startAt: string;
    readonly endAt: string;
  };
  readonly documents: readonly EditableMilestoneDocument[];
  readonly fileUpload: {
    readonly maxBytes: number;
    readonly maxLabel: string;
    readonly accept: string;
    readonly formatLabel: string;
  };
  readonly fingerprint: string;
}

export type UpdateEditableMilestoneDocumentInput = {
  readonly id: string | null;
  readonly name: string;
  readonly required: boolean;
  readonly templateUploadId?: string;
};

export type UpdateEditableMilestoneInput = {
  readonly expectedFingerprint: string;
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly instructions: string | null;
  readonly documents: readonly UpdateEditableMilestoneDocumentInput[];
};

export type EditableMilestoneSnapshotFailure =
  | { readonly kind: 'conflict' }
  | {
      readonly kind: 'known';
      readonly message: string;
      readonly fieldErrors: readonly {
        readonly field: string;
        readonly message: string;
        readonly code: string;
      }[];
    }
  | { readonly kind: 'unknown' };

export function editableMilestoneSnapshotFailure(
  error: unknown,
): EditableMilestoneSnapshotFailure {
  if (!(error instanceof ApiError)) return { kind: 'unknown' };
  if (
    error.problem.status === 409 &&
    error.problem.code === PROGRAM_EDIT_ERROR_CODES.MILESTONE_EDIT_CHANGED
  )
    return { kind: 'conflict' };
  if (
    error.problem.status >= 400 &&
    error.problem.status < 500 &&
    error.problem.code !== 'API_000'
  )
    return {
      kind: 'known',
      message: error.problem.detail,
      fieldErrors:
        error.problem.fieldErrors?.map(({ field, message, code }) => ({
          field,
          message,
          code,
        })) ?? [],
    };
  return { kind: 'unknown' };
}

export interface ProgramDeletionScopeCounts {
  readonly applications: number;
  readonly teams: number;
  readonly boardPosts: number;
  readonly submissions: number;
  readonly submissionEvents: number;
  readonly scopeFingerprint: string;
}

export interface EditableProgram {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType | null;
  readonly lifecycle: 'PUBLISHED' | 'ARCHIVED';
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly applicationCount: number;
  /** GET /programs/:id/edit가 전체 삭제 확인용으로 제공하는 현재 자식 범위. */
  readonly deletionScopeCounts?: ProgramDeletionScopeCounts;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  /** 이전 로컬 검토 fixture와의 호환을 위해 선택적이지만, 편집 API는 항상 준다. */
  readonly startAt?: string;
  readonly endAt: string | null;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
  readonly description: string;
  readonly teamMinSize: number | null;
  readonly teamMaxSize: number | null;
  readonly milestones: readonly EditableMilestone[];
}

export type UpdateProgramInput = Omit<CreateProgramInput, 'endAt'> & {
  readonly startAt: string;
  readonly endAt: string | null;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
};

export interface UpsertMilestoneInput {
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly instructions: string | null;
}

export function createProgram(
  input: CreateProgramInput,
): Promise<CreatedProgram> {
  return apiClient<CreatedProgram>('programs', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  });
}

export function listPrograms(
  params: ProgramListParams,
): Promise<ProgramListPage> {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    search: params.search,
    status: params.status,
  });
  if (params.sort) search.set('sort', params.sort);
  if (params.direction) search.set('direction', params.direction);
  return apiClient<ProgramListPage>('programs?' + search.toString());
}

/** 프로그램 섹션 사이드바 뱃지 — 공개, 인증 불필요. */
export function getProgramStatusCounts(): Promise<ProgramStatusCounts> {
  return apiClient<ProgramStatusCounts>('programs/status-counts');
}

export async function getProgramDetail(
  programId: string,
): Promise<ProgramDetail> {
  const encodedId = encodeURIComponent(programId);
  try {
    return await apiClient<ProgramDetail>(`programs/${encodedId}/viewer`);
  } catch (error: unknown) {
    if (!(error instanceof ApiError) || error.problem.status !== 401)
      throw error;
    return apiClient<ProgramDetail>(`programs/${encodedId}`);
  }
}

export function getProgramActivity(
  programId: string,
): Promise<readonly ProgramActivity[]> {
  return apiClient<readonly ProgramActivity[]>(
    `programs/${encodeURIComponent(programId)}/activity`,
  );
}

export function getEditableProgram(
  programId: string,
): Promise<EditableProgram> {
  return apiClient<EditableProgram>(
    `programs/${encodeURIComponent(programId)}/edit`,
  );
}

export function updateProgram(
  programId: string,
  input: UpdateProgramInput,
): Promise<EditableProgram> {
  return apiClient<EditableProgram>(
    `programs/${encodeURIComponent(programId)}`,
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
  );
}

export function getEditableMilestone(
  milestoneId: string,
): Promise<EditableMilestoneEditSnapshot> {
  return apiClient<EditableMilestoneEditSnapshot>(
    `milestones/${encodeURIComponent(milestoneId)}/edit`,
  );
}

export function updateEditableMilestone(
  milestoneId: string,
  input: UpdateEditableMilestoneInput,
): Promise<EditableMilestoneEditSnapshot> {
  return apiClient<EditableMilestoneEditSnapshot>(
    `milestones/${encodeURIComponent(milestoneId)}`,
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
  );
}

export function createMilestone(
  programId: string,
  input: UpsertMilestoneInput,
): Promise<EditableMilestone> {
  return apiClient<EditableMilestone>(
    `programs/${encodeURIComponent(programId)}/milestones`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
  );
}

export function deleteMilestone(
  milestoneId: string,
): Promise<{ readonly deleted: true }> {
  return apiClient<{ readonly deleted: true }>(
    `milestones/${encodeURIComponent(milestoneId)}`,
    { method: 'DELETE' },
  );
}

export type CreateApplicationRepositoryConnectionMode = 'new' | 'own';

/**
 * 신청 생성 요청 본문. 키는 backend `CreateApplicationRequestDto`가 whitelist 하는
 * 것과 정확히 같아야 한다 — 전역 `ValidationPipe`가 `forbidNonWhitelisted: true`라
 * 모르는 키가 하나라도 있으면 본문 전체가 400 SYS_003으로 거절된다.
 *
 * 팀은 여기서 보내지 않는다. #651 이후 backend가 신청자의 팀 멤버십으로 팀을 정한다
 * — 이미 이 프로그램의 팀에 속해 있으면 그 팀을 재사용하고, 아니면 1인 팀을 만든다
 * (`applications.service.ts`의 `findExistingTeamMembership`). 팀 id를 실어 보내면
 * 미허용 키가 되어 신청이 통째로 실패한다.
 */
export interface CreateApplicationInput {
  readonly answers: { readonly title?: string };
  readonly applicationTemplateVersion: number;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly repositoryConnectionMode: CreateApplicationRepositoryConnectionMode | null;
  readonly repositoryUrl: string;
}

export interface CreatedApplication {
  readonly id: string;
  readonly programId: string;
  readonly status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  readonly teamId: string | null;
  readonly submittedAt: string;
  readonly isRepositoryPublicationPlanned: boolean;
}

/** 폼 `new`/`own`/null → 신청 생성 API `NEW`/`OWN`/null. */
function mapRepositoryConnectionModeForApi(
  mode: CreateApplicationRepositoryConnectionMode | null,
): 'NEW' | 'OWN' | null {
  if (mode === null) return null;
  return mode === 'own' ? 'OWN' : 'NEW';
}

export function createApplication(
  programId: string,
  input: CreateApplicationInput,
): Promise<CreatedApplication> {
  const repositoryConnectionMode = mapRepositoryConnectionModeForApi(
    input.repositoryConnectionMode,
  );
  return apiClient<CreatedApplication>(
    `programs/${encodeURIComponent(programId)}/applications`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        answers: input.answers,
        applicationTemplateVersion: input.applicationTemplateVersion,
        isRepositoryPublicationPlanned: input.isRepositoryPublicationPlanned,
        repositoryConnectionMode,
        repositoryUrl:
          repositoryConnectionMode === 'OWN'
            ? input.repositoryUrl.trim()
            : null,
      }),
    },
  );
}

export interface TeamMember {
  readonly userId: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly isLeader: boolean;
}

/**
 * 내 팀 응답 계약. 능력 플래그는 **서버가 계산한 결과**이며(backend
 * `ProgramTeamResponseDto`), 화면이 팀장 여부·신청 이력으로 같은 규칙을 다시
 * 유추하지 않는다. 폐기된 `locked` 키는 더 이상 내려오지 않는다.
 *
 * - `hasApplication`: 이 팀 이름으로 제출된 신청이 있는가(사실 표기용).
 * - `canInvite`: 초대를 보낼 수 있는가(팀장만).
 * - `canRemoveMembers`: 다른 팀원을 제외할 수 있는가(팀장이고 팀원이 둘 이상).
 * - `canLeave`: 이 팀에서 나갈 수 있는가.
 */
export interface ProgramTeam {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly minMembers: number | null;
  readonly maxMembers: number;
  readonly hasApplication: boolean;
  readonly canInvite: boolean;
  readonly canRemoveMembers: boolean;
  readonly canLeave: boolean;
  readonly isLeader: boolean;
  readonly members: readonly TeamMember[];
}

export interface CreatedTeam {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
}

/**
 * 내 팀 응답이 계약을 벗어났다. 능력 플래그가 빠졌을 때 「권한 없음」이나
 * 「권한 있음」 어느 쪽으로도 기본값을 지어내지 않기 위해 끊는다 —
 * 없는 권한을 그렸다가 서버에서 거절당하면 학생은 이유를 알 수 없다.
 */
export class ProgramTeamResponseError extends Error {
  constructor() {
    super('팀 응답 형식이 올바르지 않습니다.');
    this.name = 'ProgramTeamResponseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isTeamMember(value: unknown): value is TeamMember {
  return (
    isRecord(value) &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.nickname) &&
    (value.name === null || typeof value.name === 'string') &&
    typeof value.isLeader === 'boolean'
  );
}

function parseProgramTeam(value: unknown): ProgramTeam {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    typeof value.name !== 'string' ||
    typeof value.memberCount !== 'number' ||
    !(value.minMembers === null || typeof value.minMembers === 'number') ||
    typeof value.maxMembers !== 'number' ||
    typeof value.hasApplication !== 'boolean' ||
    typeof value.canInvite !== 'boolean' ||
    typeof value.canRemoveMembers !== 'boolean' ||
    typeof value.canLeave !== 'boolean' ||
    typeof value.isLeader !== 'boolean' ||
    !Array.isArray(value.members) ||
    !value.members.every(isTeamMember)
  ) {
    throw new ProgramTeamResponseError();
  }
  return {
    id: value.id,
    name: value.name,
    memberCount: value.memberCount,
    minMembers: value.minMembers,
    maxMembers: value.maxMembers,
    hasApplication: value.hasApplication,
    canInvite: value.canInvite,
    canRemoveMembers: value.canRemoveMembers,
    canLeave: value.canLeave,
    isLeader: value.isLeader,
    members: value.members,
  };
}

export async function getMyTeam(programId: string): Promise<ProgramTeam> {
  return parseProgramTeam(
    await apiClient<unknown>(
      `programs/${encodeURIComponent(programId)}/teams/me`,
    ),
  );
}

export function leaveMyTeam(programId: string): Promise<void> {
  return apiClient<void>(`programs/${encodeURIComponent(programId)}/teams/me`, {
    method: 'DELETE',
  });
}

/**
 * 팀장의 팀원 제외(backend `DELETE /programs/:programId/teams/me/members/:userId`).
 * 본인 제외는 탈퇴(`leaveMyTeam`)가 팀장 승계까지 책임지므로 서버가 409로 돌려보낸다.
 */
export function removeMyTeamMember(
  programId: string,
  userId: string,
): Promise<void> {
  return apiClient<void>(
    `programs/${encodeURIComponent(programId)}/teams/me/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}

export function createTeam(
  programId: string,
  input: { readonly name: string },
): Promise<CreatedTeam> {
  return apiClient<CreatedTeam>(
    `programs/${encodeURIComponent(programId)}/teams`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
  );
}

export function listProgramApplications(
  programId: string,
  params: ApplicationListParams,
): Promise<ApplicationListPage> {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    search: params.search,
    status: params.status,
  });
  return apiClient<ApplicationListPage>(
    `programs/${encodeURIComponent(programId)}/applications?${search.toString()}`,
  );
}

/**
 * #722 교직원 신청 상세. 목록 항목과 **같은 모양**이 온다 — 백엔드가 두 조회에 같은
 * select 를 쓰므로 화면끼리 필드가 어긋나지 않는다.
 */
export function getApplicationDetail(
  applicationId: string,
): Promise<ApplicationListItem> {
  return apiClient<ApplicationListItem>(
    `applications/${encodeURIComponent(applicationId)}`,
  );
}

/**
 * 교직원 전용 팀 목록. 학생이 쓰는 공개 로스터(`overview/teams`)와 **다른 경로**다 —
 * 그쪽은 프로그램 참가자 전원에게 보이는 목록이라 실명을 주지 않는다. 이 경로는
 * staff 가드 뒤에 있어 실명을 포함한다.
 */
export function listStaffProgramTeams(
  programId: string,
): Promise<readonly StaffProgramTeam[]> {
  return apiClient<readonly StaffProgramTeam[]>(
    `programs/${encodeURIComponent(programId)}/teams`,
  );
}

export type ApplicationDecisionInput =
  | { readonly action: 'APPROVE' }
  | { readonly action: 'REJECT'; readonly reason: string }
  | { readonly action: 'REVERT' };

export type ApplicationDecisionResponse =
  | {
      readonly applicationId: string;
      readonly status: 'APPROVED';
      readonly repositoryProvisioning: RepositoryProvisioning;
    }
  | {
      readonly applicationId: string;
      readonly status: 'REJECTED';
      readonly rejectionReason: string;
    }
  | {
      readonly applicationId: string;
      readonly status: 'SUBMITTED';
    };

export function decideApplication(
  applicationId: string,
  input: ApplicationDecisionInput,
): Promise<ApplicationDecisionResponse> {
  return apiClient<ApplicationDecisionResponse>(
    `applications/${encodeURIComponent(applicationId)}`,
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
  );
}

/** #117 교직원 운영 대시보드 요약. */
export async function getStaffDashboardSummary(): Promise<StaffDashboardSummary> {
  return parseStaffDashboardSummary(
    await apiClient<unknown>('dashboard/staff/summary'),
  );
}

/**
 * 교직원·관리자의 영구 삭제(#1095가 #875의 「STAFF 403」을 뒤집었다). 자식 데이터가
 * 하나라도 있으면 백엔드가 409(PRG_012)로 막는 것은 그대로다 — 화면은 위험 영역
 * 섹션을 삭제 권한이 있는 사용자에게 보여준다.
 */
export function deleteProgram(
  programId: string,
): Promise<{ readonly id: string; readonly deleted: true }> {
  return apiClient<{ readonly id: string; readonly deleted: true }>(
    `programs/${encodeURIComponent(programId)}`,
    { method: 'DELETE' },
  );
}

/** 전체 삭제 응답 — backend `ProgramPurgeDeletedCounts` 계약 미러. */
export interface ProgramPurgeDeletedCounts {
  readonly applications: number;
  readonly teams: number;
  readonly teamMembers: number;
  readonly teamInvitations: number;
  readonly boardPosts: number;
  readonly boardComments: number;
  readonly submissions: number;
  readonly submissionRevisions: number;
  readonly reviews: number;
  readonly submissionFiles: number;
  readonly milestones: number;
  readonly milestoneDocuments: number;
  readonly milestoneDocumentSubmissions: number;
  readonly milestoneDocumentSubmissionHistories: number;
  readonly milestoneDocumentReviewHistories: number;
  readonly milestoneDocumentTemplateFiles: number;
  readonly programAuthoringUploads: number;
  readonly programCreateRequests: number;
  readonly repositoryProvisionJobs: number;
  readonly githubRepositoriesDetached: number;
  readonly publicShowcaseRepositories: number;
  readonly outboxEvents: number;
  readonly notifications: number;
  readonly programPurgeFileTombstones: number;
}

export interface ProgramPurgeResult {
  readonly id: string;
  readonly deleted: true;
  readonly deletedCounts: ProgramPurgeDeletedCounts;
}

/**
 * `expectedScope`는 누르는 사람이 확인 다이얼로그에서 마지막으로 본 삭제 범위이며 REQUIRED다(#F2) —
 * 백엔드가 같은 값을 purge 트랜잭션 안에서 다시 읽은 현재 범위와 비교해, 확인 이후 생긴 행이
 * 있으면 409(PRG_014)로 거부한다.
 */
export function purgeProgram(
  programId: string,
  expectedScope: ProgramDeletionScopeCounts,
): Promise<ProgramPurgeResult> {
  return apiClient<ProgramPurgeResult>(
    `programs/${encodeURIComponent(programId)}/purge`,
    {
      method: 'DELETE',
      headers: jsonHeaders,
      body: JSON.stringify({ expectedScope }),
    },
  );
}

/**
 * 교직원 전용 팀 상세(#874). `listStaffProgramTeams`(팀 목록)와 달리 신청
 * 상태·저장소 발급 상태까지 한 요청으로 받는다 — 팀 상세 화면이 신청 목록을
 * 따로 불러 클라이언트에서 잇지 않게 하려는 것이다.
 */
export function getStaffProgramTeamDetail(
  programId: string,
  teamId: string,
): Promise<StaffTeamDetail> {
  return apiClient<StaffTeamDetail>(
    `programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}`,
  );
}
