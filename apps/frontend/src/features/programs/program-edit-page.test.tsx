import { describe, expect, it } from 'vitest';
import type { EditableProgram } from './api';
import { buildProgramEditInput, toProgramEditForm } from './program-edit-flow';

const editableProgram: EditableProgram = {
  id: 'program-1',
  name: 'OSS',
  organizer: 'Center',
  category: 'OSS_CONTEST',
  applicationTemplateKey: 'oss-contest',
  applicationTemplateVersion: 1,
  applicationCount: 0,
  applicationStartAt: '2026-08-01T09:30:00.000Z',
  applicationEndAt: '2026-08-15T09:30:00.000Z',
  repositoryProvisioningEnabled: false,
  description: 'overview',
  teamMinSize: 2,
  teamMaxSize: 4,
  milestones: [],
};

describe('ProgramEditPage save payload', () => {
  it('preserves unchanged ISO timestamps when STAFF saves by canonical id', () => {
    // Given
    const form = toProgramEditForm(editableProgram);

    // When
    const input = buildProgramEditInput(form, true);

    // Then
    expect(input).toMatchObject({
      category: 'OSS_CONTEST',
      applicationStartAt: editableProgram.applicationStartAt,
      applicationEndAt: editableProgram.applicationEndAt,
      teamMinSize: 2,
      teamMaxSize: 4,
    });
  });
});
