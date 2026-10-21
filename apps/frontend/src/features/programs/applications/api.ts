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
import { apiClient } from '../../../lib/api-client';
import {
  serializeCreateApplication,
  serializeTeamManagementQuery,
} from './application-wire';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

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
    'programs/application-templates',
  ).then((response) => response.items.map(mapApplicationTemplate));
}

export function createApplication(
  programId: string,
  input: CreateApplicationInput,
): Promise<CreatedApplication> {
  return apiClient<CreatedApplication>(
    `programs/${encodeURIComponent(programId)}/applications`,
    {
      method: 'POST',
      headers: jsonHeaders,
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
    `programs/${encodeURIComponent(programId)}/applications?${search}`,
  );
}

export function getApplicationDetail(
  applicationId: string,
): Promise<ApplicationListItem> {
  return apiClient<ApplicationListItem>(
    `applications/${encodeURIComponent(applicationId)}`,
  );
}

export async function getApplicationDetailWithHistory(
  applicationId: string,
): Promise<ApplicationDetail> {
  const detail = await apiClient<ApplicationDetail>(
    `applications/${encodeURIComponent(applicationId)}`,
  );

  return Array.isArray(detail.reviewHistory)
    ? detail
    : { ...detail, reviewHistory: [] };
}

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
