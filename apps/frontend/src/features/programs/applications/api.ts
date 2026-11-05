import type {
  ApplicationTemplateApiItem,
  ApplicationFormTemplate,
  ApplicationFormField,
  ApplicationTemplateListApiResponse,
  CreateApplicationInput,
  CreatedApplication,
  ApplicationListParams,
  TeamManagementListPage,
  ApplicationListItem,
  ApplicationDetail,
  ApplicationDecisionInput,
  ApplicationDecisionResponse,
} from './dto';
import { apiClient } from '@/lib/api-client';
import {
  serializeCreateApplication,
  serializeTeamManagementQuery,
} from './application-wire';

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
    participation: 'team',
    fields,
  };
}

export function listApplicationTemplates(): Promise<
  readonly ApplicationFormTemplate[]
> {
  return apiClient<ApplicationTemplateListApiResponse>(
    'programs/team-templates',
  ).then((response) => response.items.map(mapApplicationTemplate));
}

export function createApplication(
  programId: string,
  input: CreateApplicationInput,
): Promise<CreatedApplication> {
  return apiClient<CreatedApplication>(
    `programs/${encodeURIComponent(programId)}/teams`,
    {
      method: 'POST',
      body: serializeCreateApplication(input),
    },
  );
}

export function listTeamManagementApplications(
  programId: string,
  params: ApplicationListParams,
): Promise<TeamManagementListPage> {
  const search = serializeTeamManagementQuery(params);
  return apiClient<TeamManagementListPage>(
    `programs/${encodeURIComponent(programId)}/teams?${search}`,
  );
}

export function getApplicationDetail(
  teamId: string,
): Promise<ApplicationListItem> {
  return apiClient<ApplicationListItem>(`teams/${encodeURIComponent(teamId)}`);
}

export async function getApplicationDetailWithHistory(
  teamId: string,
): Promise<ApplicationDetail> {
  const detail = await apiClient<ApplicationDetail>(
    `teams/${encodeURIComponent(teamId)}`,
  );

  return Array.isArray(detail.reviewHistory)
    ? detail
    : { ...detail, reviewHistory: [] };
}

export function decideApplication(
  teamId: string,
  input: ApplicationDecisionInput,
): Promise<ApplicationDecisionResponse> {
  return apiClient<ApplicationDecisionResponse>(
    `teams/${encodeURIComponent(teamId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}
