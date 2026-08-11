import { createHash } from 'node:crypto';
import type { ProgramAuthoringPlan } from './program-authoring.types';

export function canonicalProgramAuthoringPayload(plan: ProgramAuthoringPlan) {
  return {
    schemaVersion: 1,
    program: {
      name: plan.program.name,
      organizer: plan.program.organizer,
      category: plan.program.category,
      applicationTemplateKey: plan.program.applicationTemplateKey,
      applicationTemplateVersion: plan.program.applicationTemplateVersion,
      applicationStartAt: plan.program.applicationStartAt.toISOString(),
      applicationEndAt: plan.program.applicationEndAt.toISOString(),
      startAt: plan.program.startAt.toISOString(),
      endAt: plan.program.endAt.toISOString(),
      teamMinSize: plan.program.teamMinSize,
      teamMaxSize: plan.program.teamMaxSize,
      description: plan.program.description,
      repositoryProvisioningEnabled: plan.program.repositoryProvisioningEnabled,
      notifyOnDeadline: plan.program.notifyOnDeadline,
    },
    milestones: plan.milestones.map((milestone) => ({
      name: milestone.name,
      startAt: milestone.startAt.toISOString(),
      dueAt: milestone.dueAt.toISOString(),
      submissionType: milestone.submissionType,
      instructions: milestone.instructions,
      documents: milestone.documents.map((document) => ({
        name: document.name,
        required: document.required,
        sortOrder: document.sortOrder,
        submissionType: document.submissionType,
        templateUploadId: document.templateUploadId,
      })),
    })),
  } as const;
}

export function hashProgramAuthoringPayload(
  plan: ProgramAuthoringPlan,
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalProgramAuthoringPayload(plan)), 'utf8')
    .digest('hex');
}
