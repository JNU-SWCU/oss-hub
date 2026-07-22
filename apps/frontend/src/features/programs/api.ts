import { apiClient } from '@/lib/api-client';
import type { ProgramCategory } from './program-templates';

export interface CreateProgramInput {
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
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

export function createProgram(
  input: CreateProgramInput,
): Promise<CreatedProgram> {
  return apiClient<CreatedProgram>('programs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
