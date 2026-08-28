import { getProgramTemplate } from './program-template.registry';
import {
  ProgramAuthoringValidationError,
  type ProgramAuthoringDocumentPlan,
  type ProgramAuthoringMilestonePlan,
  type ProgramAuthoringPlan,
  type ProgramAuthoringRequest,
  type ProgramAuthoringValidationIssue,
} from './program-authoring.types';

const MAX_MILESTONES = 50;
const MAX_DOCUMENTS_PER_MILESTONE = 20;
const MAX_DOCUMENTS_PER_PROGRAM = 100;

export function buildProgramAuthoringPlan(
  request: ProgramAuthoringRequest,
): ProgramAuthoringPlan {
  const issues: ProgramAuthoringValidationIssue[] = [];
  const name = requiredString(request.name, 'name', issues);
  const organizer = requiredString(request.organizer, 'organizer', issues);
  const description = requiredString(
    request.description,
    'description',
    issues,
  );
  const applicationStartAt = isoDate(
    request.applicationStartAt,
    'applicationStartAt',
    issues,
  );
  const applicationEndAt = isoDate(
    request.applicationEndAt,
    'applicationEndAt',
    issues,
  );
  const startAt = isoDate(
    request.startAt ?? request.applicationEndAt,
    'startAt',
    issues,
  );
  const endAt = isoDate(request.endAt, 'endAt', issues);
  if (
    applicationStartAt === null ||
    applicationEndAt === null ||
    startAt === null ||
    endAt === null
  ) {
    throw new ProgramAuthoringValidationError(issues);
  }

  if (applicationStartAt > applicationEndAt) {
    issues.push({
      path: 'applicationEndAt',
      code: 'INVALID_APPLICATION_SCHEDULE',
    });
  }
  if (applicationEndAt > startAt || startAt >= endAt) {
    issues.push({ path: 'endAt', code: 'INVALID_PROGRAM_SCHEDULE' });
  }

  const template = getProgramTemplate(request.category);
  const teamMinSize = request.teamMinSize ?? template.teamSize.defaultMin;
  const teamMaxSize = request.teamMaxSize ?? template.teamSize.defaultMax;
  if (
    !Number.isInteger(teamMinSize) ||
    !Number.isInteger(teamMaxSize) ||
    teamMinSize < 1 ||
    teamMinSize > teamMaxSize
  ) {
    issues.push({ path: 'teamMinSize', code: 'INVALID_TEAM_RANGE' });
  }

  if (request.milestones.length > MAX_MILESTONES) {
    issues.push({ path: 'milestones', code: 'MILESTONE_LIMIT_EXCEEDED' });
  }
  if (
    request.repositoryProvisioningEnabled === true &&
    request.milestones.length === 0
  ) {
    issues.push({ path: 'milestones', code: 'MILESTONE_REQUIRED' });
  }

  const seenUploadIds = new Set<string>();
  const uploadTokenIds: string[] = [];
  let totalDocuments = 0;
  const milestones: ProgramAuthoringMilestonePlan[] = [];
  request.milestones.forEach((milestone, milestoneIndex) => {
    const path = `milestones.${milestoneIndex}`;
    const milestoneName = requiredString(
      milestone.name,
      `${path}.name`,
      issues,
    );
    const milestoneStartAt = isoDate(
      milestone.startAt ?? startAt.toISOString(),
      `${path}.startAt`,
      issues,
    );
    const dueAt = isoDate(milestone.dueAt, `${path}.dueAt`, issues);
    totalDocuments += milestone.documents.length;
    if (milestone.documents.length === 0) {
      issues.push({ path: `${path}.documents`, code: 'DOCUMENT_REQUIRED' });
    }
    if (milestone.documents.length > MAX_DOCUMENTS_PER_MILESTONE) {
      issues.push({
        path: `${path}.documents`,
        code: 'DOCUMENT_LIMIT_EXCEEDED',
      });
    }
    const documents = milestone.documents.map((document, documentIndex) =>
      documentPlan(
        document,
        `${path}.documents.${documentIndex}`,
        documentIndex + 1,
        issues,
        seenUploadIds,
        uploadTokenIds,
      ),
    );
    if (milestoneStartAt !== null && dueAt !== null) {
      if (
        milestoneStartAt < startAt ||
        milestoneStartAt >= dueAt ||
        dueAt >= endAt
      ) {
        issues.push({
          path: `${path}.dueAt`,
          code: 'INVALID_MILESTONE_SCHEDULE',
        });
      }
      milestones.push({
        name: milestoneName,
        startAt: milestoneStartAt,
        dueAt,
        submissionType: null,
        instructions: optionalString(milestone.instructions),
        documents,
      });
    }
  });
  if (totalDocuments > MAX_DOCUMENTS_PER_PROGRAM) {
    issues.push({ path: 'milestones', code: 'TOTAL_DOCUMENT_LIMIT_EXCEEDED' });
  }
  if (issues.length > 0) throw new ProgramAuthoringValidationError(issues);

  return {
    program: {
      name,
      organizer,
      category: request.category,
      applicationTemplateKey: template.key,
      applicationTemplateVersion: template.version,
      applicationStartAt,
      applicationEndAt,
      startAt,
      endAt,
      teamMinSize,
      teamMaxSize,
      description,
      repositoryProvisioningEnabled:
        request.repositoryProvisioningEnabled ?? false,
      // 요청이 값을 생략하면 켜진 프로그램으로 만든다 — 마감 알림을 끄는 것은
      // 교직원의 명시적 선택이어야 하고, 생략이 그 선택을 대신할 수는 없다.
      // HTTP 경로는 DTO 가 boolean 을 요구하므로(program-authoring-request.dto)
      // 이 기본값은 서비스를 직접 부르는 호출자에게만 적용된다.
      notifyOnDeadline: request.notifyOnDeadline ?? true,
    },
    milestones,
    uploadTokenIds: uploadTokenIds.sort(),
  };
}

function documentPlan(
  document: ProgramAuthoringRequest['milestones'][number]['documents'][number],
  path: string,
  sortOrder: number,
  issues: ProgramAuthoringValidationIssue[],
  seenUploadIds: Set<string>,
  uploadTokenIds: string[],
): ProgramAuthoringDocumentPlan {
  const templateUploadId = optionalString(document.templateUploadId);
  if (templateUploadId !== null) {
    if (seenUploadIds.has(templateUploadId)) {
      issues.push({
        path: `${path}.templateUploadId`,
        code: 'DUPLICATE_UPLOAD_TOKEN',
      });
    } else {
      seenUploadIds.add(templateUploadId);
      uploadTokenIds.push(templateUploadId);
    }
  }
  return {
    name: requiredString(document.name, `${path}.name`, issues),
    required: document.required,
    sortOrder,
    submissionType: 'FILE',
    templateUploadId,
  };
}

function requiredString(
  value: string,
  path: string,
  issues: ProgramAuthoringValidationIssue[],
): string {
  const normalized = value.trim();
  if (normalized.length === 0) issues.push({ path, code: 'REQUIRED' });
  return normalized;
}

function optionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function isoDate(
  value: string,
  path: string,
  issues: ProgramAuthoringValidationIssue[],
): Date | null {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    issues.push({ path, code: 'INVALID_DATE' });
    return null;
  }
  return parsed;
}
