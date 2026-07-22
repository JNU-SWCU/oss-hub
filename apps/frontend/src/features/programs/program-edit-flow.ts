import type { EditableProgram, UpdateProgramInput } from './api';
import type { ProgramCategory } from './program-templates';

export interface ProgramEditForm {
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly repositoryProvisioningEnabled: boolean;
  readonly description: string;
  readonly teamMinSize: string;
  readonly teamMaxSize: string;
}

export function toProgramEditForm(program: EditableProgram): ProgramEditForm {
  return {
    name: program.name,
    organizer: program.organizer,
    category: program.category,
    applicationStartAt: toDateTimeLocal(program.applicationStartAt),
    applicationEndAt: toDateTimeLocal(program.applicationEndAt),
    repositoryProvisioningEnabled: program.repositoryProvisioningEnabled,
    description: program.description,
    teamMinSize: program.teamMinSize?.toString() ?? '',
    teamMaxSize: program.teamMaxSize?.toString() ?? '',
  };
}

export function buildProgramEditInput(
  form: ProgramEditForm,
  requiresTeam: boolean,
): UpdateProgramInput {
  return {
    name: form.name.trim(),
    organizer: form.organizer.trim(),
    category: form.category,
    applicationStartAt: new Date(form.applicationStartAt).toISOString(),
    applicationEndAt: new Date(form.applicationEndAt).toISOString(),
    repositoryProvisioningEnabled: form.repositoryProvisioningEnabled,
    description: form.description.trim(),
    teamMinSize: requiresTeam ? Number(form.teamMinSize) : null,
    teamMaxSize: requiresTeam ? Number(form.teamMaxSize) : null,
  };
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value);
  const year = String(date.getFullYear());
  const month = twoDigits(date.getMonth() + 1);
  const day = twoDigits(date.getDate());
  const hour = twoDigits(date.getHours());
  const minute = twoDigits(date.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}
