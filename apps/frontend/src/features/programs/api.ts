import { ApiError, apiClient } from '@/lib/api-client';
import type { ProgramCategory } from './program-templates';
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
  if (value === 'INDIVIDUAL' || value === 'individual') return 'individual';
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
  readonly category: ProgramCategory;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly endAt: string;
  readonly teamMinSize: number | null;
  readonly teamMaxSize: number | null;
  readonly description: string;
}

export interface CreatedProgram {
  readonly id: string;
  readonly category: ProgramCategory;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly detailUrl: string;
}

export interface EditableMilestone {
  readonly id: string;
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly submissionType: SubmissionType;
  readonly instructions: string | null;
}

export interface EditableProgram {
  readonly categoryLocked: {
    readonly locked: boolean;
    readonly byApplications: boolean;
    readonly byTeams: boolean;
    readonly applicationCount: number;
    readonly teamCount: number;
  };
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly lifecycle: 'PUBLISHED' | 'ARCHIVED';
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly applicationCount: number;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly endAt: string | null;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
  readonly description: string;
  readonly teamMinSize: number | null;
  readonly teamMaxSize: number | null;
  readonly milestones: readonly EditableMilestone[];
}

export type UpdateProgramInput = Omit<CreateProgramInput, 'endAt'> & {
  readonly endAt: string | null;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
};

export interface UpsertMilestoneInput {
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly submissionType: SubmissionType;
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
export function updateProgramLifecycle(
  programId: string,
  lifecycle: EditableProgram['lifecycle'],
): Promise<{
  readonly id: string;
  readonly lifecycle: EditableProgram['lifecycle'];
}> {
  return apiClient(`programs/${encodeURIComponent(programId)}/lifecycle`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ lifecycle }),
  });
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

export function updateMilestone(
  milestoneId: string,
  input: UpsertMilestoneInput,
): Promise<EditableMilestone> {
  return apiClient<EditableMilestone>(
    `milestones/${encodeURIComponent(milestoneId)}`,
    {
      method: 'PATCH',
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
  readonly answers: {
    readonly title: string;
    readonly summary: string;
  };
  readonly applicationTemplateVersion: number;
  readonly isRepositoryPublicationPlanned: boolean;
  /** 폼 값 — wire 전송 시 `NEW`/`OWN`, 발급 비활성은 null로 매핑한다. */
  readonly repositoryConnectionMode: CreateApplicationRepositoryConnectionMode | null;
  /**
   * 폼 값. `own`이면 trim 한 URL을 보내고, `new`이면 빈 문자열이어도 wire에는
   * `null`을 넣는다(백엔드가 빈 문자열을 400으로 거절한다).
   */
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

export interface ProgramTeam {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly minMembers: number | null;
  readonly maxMembers: number;
  readonly locked: boolean;
  readonly isLeader: boolean;
  readonly members: readonly TeamMember[];
}

export interface CreatedTeam {
  readonly id: string;
  readonly name: string;
  readonly joinCode: string;
  readonly memberCount: number;
}

export function getMyTeam(programId: string): Promise<ProgramTeam> {
  return apiClient<ProgramTeam>(
    `programs/${encodeURIComponent(programId)}/teams/me`,
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

export function joinTeam(
  programId: string,
  input: { readonly joinCode: string },
): Promise<ProgramTeam> {
  return apiClient<ProgramTeam>(
    `programs/${encodeURIComponent(programId)}/teams/join`,
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
 * ADMIN 전용 영구 삭제(#875). STAFF는 프로그램 생성자여도 백엔드가 403으로
 * 거절한다 — 화면은 위험 영역 섹션 자체를 ADMIN에게만 보여준다.
 */
export function deleteProgram(
  programId: string,
): Promise<{ readonly id: string; readonly deleted: true }> {
  return apiClient<{ readonly id: string; readonly deleted: true }>(
    `programs/${encodeURIComponent(programId)}`,
    { method: 'DELETE' },
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
