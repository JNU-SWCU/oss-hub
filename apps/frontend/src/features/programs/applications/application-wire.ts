import type { ApplicationListParams, CreateApplicationInput } from './dto';

export const TEAM_MANAGEMENT_PAGE_SIZE = 20;

export function serializeCreateApplication(
  input: CreateApplicationInput,
): string {
  return JSON.stringify({
    answers: input.answers,
    teamName: input.teamName,
    applicationTemplateVersion: input.applicationTemplateVersion,
    isRepositoryPublicationPlanned: input.isRepositoryPublicationPlanned,
  });
}

export function serializeTeamManagementQuery(
  params: ApplicationListParams,
): string {
  return new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    ...(params.search.trim() ? { search: params.search } : {}),
    status: params.status,
    view: 'team-management',
  }).toString();
}
